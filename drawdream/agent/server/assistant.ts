/**
 * DrawDream 助手会话：同进程第二个 agent 会话，处理系统侧事务。
 * - 会话树：.drawdream-assistant/（不进剧情列表 / 世界线 / swipe）
 * - 扩展：不加载 roleplay 剧情工具；本文件注入 system prompt 与剧情快照
 * - 模型：assistantModel 或跟随叙事模型（手动绑模型，避免改写全局默认）
 * - 经 StoryBridge 读剧情、白名单写配置/命令/账本；不写主对话叙事正文
 */

import { isAbsolute, join } from "node:path";
import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	defineTool,
	getAgentDir,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type ExtensionFactory,
	type ToolDefinition,
} from "@drawdream/agent-runtime/web";
import { Type } from "typebox";

import {
	loadAgentConfig,
	normalizeAgentConfig,
	syncAgentConfigToRuntime,
} from "../src/agent-config.ts";
import { loadCardFile } from "../src/card.ts";
import {
	appendCodexEntry,
	createCodex,
	findCodex,
	listCodexes,
	validateCodexName,
} from "../src/codex.ts";
import { appendOverlayEntry, overlayPathFor, searchEntries } from "../src/lorebook.ts";
import { PANEL_KINDS } from "../src/panels.ts";
import { dir } from "../src/paths.ts";
import { formatSearchPlain, runSmartSearch } from "../src/smart-search.ts";
import {
	fetchWorldTime,
	formatTimePanelTag,
	formatWorldTimePlain,
} from "../src/world-time.ts";
import { listSkills, saveSkill } from "../src/skills.ts";
import {
	buildStagehandInjection,
	buildStagehandPrompt,
	formatStoryRead,
	formatStorySearch,
	STORY_COMMANDS,
	type StorySnapshot,
} from "../src/stagehand.ts";
import { formatState } from "../src/state.ts";
import type { RpConfig, WorldState } from "../src/types.ts";
import {
	applyConfigPatch,
	configPath,
	loadConfig,
	loadEffectivePreset,
	loadMergedLore,
	mergePresetPatches,
	presetOverridePath,
	writeJsonWithBackup,
} from "./rest.ts";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";

/** 剧情会话桥：main.ts 提供，助手工具经此只读剧情面 / 提交白名单写操作 */
export interface StoryBridge {
	/** 剧情会话消息（当前分支，内存态；toWireHistory 同源输入） */
	storyMessages(): unknown[];
	/** 剧情快照（助手每轮末端注入；不含助手自身字段） */
	snapshot(): Omit<StorySnapshot, "assistantModel" | "assistantFollows">;
	/** 剧情命令（流式中自动排队到本轮结束）；返回是否排队 */
	queueStoryCommand(text: string): boolean;
	/** 世界状态（当前剧情会话的账本） */
	worldState(): WorldState;
	/** 账本补丁（用户主权 applyPatch 通路，与 PUT /api/state 同源） */
	applyStatePatch(patch: Record<string, unknown>): { applied: string[]; warnings: string[] };
	/** 配置/预设变更后热载剧情会话（流式中自动排队） */
	softRefreshConfig(): Promise<void>;
	/** 可用模型清单 + 当前剧情模型（/api/models 同源） */
	listModels(): {
		current: { provider: string; id: string; name: string } | null;
		models: Array<{ provider: string; providerName: string; id: string; name: string; contextWindow: number }>;
	};
	// ---- 作者权限：写文件 + 收编进剧情会话（内存/树/前端）——与剧情 agent 落点一致 ----
	/** 当前角色卡名（补充设定集按卡分文件、卡库落点用） */
	cardName(): string;
	/** 写面板（drawdream-panels 通路，落 .drawdream-artifacts + /panelsync 收编 + fs.watch 推前端） */
	writePanels(list: Array<{ name: string; kind: string; content: string }>): {
		imported: number;
		names: string[];
		errors: string[];
	};
	/** 把本机图片/音频/视频交付到助手自己的对话（复制进 .drawdream-media，返回可访问 src） */
	deliverMedia(absPath: string): { ok: true; src: string; kind: "image" | "audio" | "video" } | { ok: false; error: string };
	/** 收编世界书补充设定集改动进剧情会话（写文件后调，触发 /rprefresh 重载 lore） */
	refreshStoryMaterials(): Promise<void>;
	/** 收编知识库挂载变化（写文件后调，/codexmount 命令桥） */
	mountCodex(name: string, on: boolean): void;
}

export interface AssistantModelSel {
	provider: string;
	id: string;
}

export interface AssistantHost {
	/** 发话（剧情/助手各自独立排队） */
	prompt(text: string, webSearch?: boolean): Promise<void>;
	abort(): Promise<void>;
	/** 开新对话（旧会话文件保留在 .drawdream-assistant/，不再续接） */
	newConversation(): Promise<void>;
	/** 选模型：null=回到跟随剧情模型；写入 config.assistantModel */
	setModel(sel: AssistantModelSel | null): Promise<void>;
	modelInfo(): { provider: string; id: string; name: string } | null;
	/** true=未单独指定模型（跟随剧情模型） */
	follows(): boolean;
	/** 会话历史（wire 层转 AssistantMsg） */
	messages(): unknown[];
	isStreaming(): boolean;
	dispose(): Promise<void>;
}

export interface CreateAssistantHostOptions {
	cwd: string;
	bridge: StoryBridge;
	/** 会话事件透传（main.ts 翻成 assistant_* wire 帧）；换新对话后自动续接 */
	onEvent(event: unknown): void;
	/** 扩展错误上报 */
	onError(text: string): void;
	/** headless UI 上下文（与剧情会话共用 main.ts 的实现即可） */
	uiContext: unknown;
}

/** 文本工具结果 */
const text = (t: string, isError = false) => ({
	content: [{ type: "text" as const, text: t }],
	...(isError ? { isError: true } : {}),
});

/** 宽容解析 JSON 对象参数（模型传字符串最稳，不吃 provider 的嵌套 schema 兼容性） */
const parseJsonObject = (raw: string): Record<string, unknown> | null => {
	try {
		const v = JSON.parse(raw) as unknown;
		return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
	} catch {
		return null;
	}
};

// ---------- 助手工具面（白名单写 + 只读剧情面） ----------

function createStagehandTools(cwd: string, bridge: StoryBridge): ToolDefinition[] {
	const tools: ToolDefinition[] = [];

	tools.push(
		defineTool({
			name: "story_info",
			label: "剧情档案",
			description:
				"Read the full dossier of the current roleplay: character card, story model, config, preset block list, world state ledger, context stats. Call this before diagnosing or changing anything.",
			parameters: Type.Object({}),
			async execute() {
				const config = loadConfig(cwd);
				const snap = bridge.snapshot();
				const models = bridge.listModels();
				const preset = loadEffectivePreset(cwd);
				const lines: string[] = [];
				lines.push(
					`剧情会话 ${snap.sessionId}｜角色卡「${snap.cardName}」｜消息 ${snap.messageCount} 条｜${snap.streaming ? "正在生成" : "空闲"}`,
				);
				lines.push(
					`剧情模型：${models.current ? `${models.current.provider}/${models.current.id}` : "（未就绪）"}${snap.thinkingLevel ? `（思考档 ${snap.thinkingLevel}）` : ""}｜上下文已用 ${snap.contextPercent !== null ? `${Math.round(snap.contextPercent)}%` : "未知"}`,
				);
				const { assistantModel: _am, ...rest } = config;
				lines.push(`\n【配置 drawdream.config.json】\n${JSON.stringify(rest, null, 2)}`);
				if (preset.preset) {
					const p = preset.preset;
					const blocks = p.blocks
						.map(
							(b) =>
								`- [${b.enabled ? "开" : "关"}] ${b.id}「${b.name}」 ${b.channel} · ${b.content.length} 字`,
						)
						.join("\n");
					lines.push(
						`\n【预设「${p.name}」${preset.fromOverride ? "（含未保存草稿）" : ""}】采样参数 ${JSON.stringify(p.samplers)}\n${blocks}`,
					);
				} else {
					lines.push(`\n【预设】未配置${preset.path ? `（文件缺失：${preset.path}）` : ""}`);
				}
				lines.push(`\n【世界状态】\n${formatState(bridge.worldState())}`);
				return text(lines.join("\n"));
			},
		}),
		defineTool({
			name: "story_read",
			label: "读剧情记录",
			description:
				"Read the story transcript by floor number (same numbering the user sees in the UI). Default: last 8 floors, user-visible text. Use view='raw' to inspect the model's raw output (scaffolding, status blocks, thinking) when diagnosing format problems.",
			parameters: Type.Object({
				last: Type.Optional(Type.Number({ description: "取最近 N 层（默认 8，上限 60）" })),
				from: Type.Optional(Type.Number({ description: "起始楼层（含）" })),
				to: Type.Optional(Type.Number({ description: "结束楼层（含）" })),
				view: Type.Optional(Type.String({ description: "display（默认，用户可见正文）| raw（原始输出含思维链）" })),
				max_chars: Type.Optional(Type.Number({ description: "单层截断上限（默认 4000）" })),
			}),
			async execute(_id, params) {
				return text(
					formatStoryRead(bridge.storyMessages(), {
						last: params.last,
						from: params.from,
						to: params.to,
						view: params.view === "raw" ? "raw" : "display",
						maxChars: params.max_chars,
					}),
				);
			},
		}),
		defineTool({
			name: "story_search",
			label: "搜剧情记录",
			description: "Keyword-search the story transcript; returns matching floors with excerpts.",
			parameters: Type.Object({
				query: Type.String({ description: "检索词" }),
				limit: Type.Optional(Type.Number({ description: "命中上限（默认 8）" })),
			}),
			async execute(_id, params) {
				return text(formatStorySearch(bridge.storyMessages(), params.query, params.limit ?? 8));
			},
		}),
		defineTool({
			name: "world_time",
			label: "世界时间",
			description:
				"Fetch real-world current time via UAPI GET /misc/worldtime for direct time/date/timezone questions. smart_search automatically obtains or reuses a 60-second time anchor.",
			parameters: Type.Object({
				city: Type.Optional(
					Type.String({ description: "IANA timezone, e.g. Asia/Shanghai (default)" }),
				),
			}),
			async execute(_id, params, signal) {
				try {
					const info = await fetchWorldTime(
						undefined,
						params.city ? { city: String(params.city) } : undefined,
						signal,
					);
					return text(`${formatWorldTimePlain(info)}\n\n${formatTimePanelTag(info)}`);
				} catch (err) {
					return text(err instanceof Error ? err.message : String(err), true);
				}
			},
		}),
		defineTool({
			name: "smart_search",
			label: "智能搜索",
			description:
				"Real-time Tavily search. Automatically reuses a 60-second world-time anchor, expands Chinese and English query perspectives, and ranks deduplicated single/multi-route evidence. Use when this turn's web-search switch is enabled. Query must contain the user's concrete entities and intent. Returns original/executed queries plus evidence snippets. Requires Tavily API key in settings.",
			parameters: Type.Object({
				query: Type.String({ description: "Search keywords or a natural question (Chinese or English)" }),
				topic: Type.Optional(
					Type.Union([Type.Literal("general"), Type.Literal("news"), Type.Literal("finance")], {
						description: "Tavily topic category (default general)",
					}),
				),
				time_range: Type.Optional(Type.String({ description: "Freshness: day | week | month | year" })),
				include_domains: Type.Optional(
					Type.String({ description: "Comma-separated domains to include (e.g. espn.com,bbc.com)" }),
				),
				exclude_domains: Type.Optional(Type.String({ description: "Comma-separated domains to exclude" })),
				search_depth: Type.Optional(
					Type.Union(
						[Type.Literal("basic"), Type.Literal("advanced"), Type.Literal("fast"), Type.Literal("ultra-fast")],
						{ description: "Tavily search_depth (default from settings / basic)" },
					),
				),
				mode: Type.Optional(
					Type.Union([Type.Literal("simple"), Type.Literal("multi")], {
						description: "simple = one Tavily call; multi = plan sub-queries + RRF",
					}),
				),
				limit: Type.Optional(Type.Number({ description: "Max results (1–20, default 8)" })),
			}),
			async execute(_id, params, signal) {
				try {
					const config = loadConfig(cwd);
					const data = await runSmartSearch(
						config.smartSearch,
						{
							query: params.query,
							...(params.topic === "general" || params.topic === "news" || params.topic === "finance"
								? { topic: params.topic }
								: {}),
							...(params.time_range ? { time_range: params.time_range } : {}),
							...(params.include_domains ? { include_domains: params.include_domains } : {}),
							...(params.exclude_domains ? { exclude_domains: params.exclude_domains } : {}),
							...(params.search_depth === "basic" ||
							params.search_depth === "advanced" ||
							params.search_depth === "fast" ||
							params.search_depth === "ultra-fast"
								? { search_depth: params.search_depth }
								: {}),
							...(params.mode === "simple" || params.mode === "multi" ? { mode: params.mode } : {}),
							...(typeof params.limit === "number" ? { limit: params.limit } : {}),
						},
						signal,
					);
					// 普通文本输出（不再附 searchpanel 卡片）
					return text(formatSearchPlain(data));
				} catch (err) {
					return text(err instanceof Error ? err.message : String(err), true);
				}
			},
		}),
		defineTool({
			name: "story_command",
			label: "剧情命令",
			description: `Run a whitelisted command against the story session: ${STORY_COMMANDS.map((c) => `/${c}`).join(" ")}. E.g. "/reroll" to regenerate the last reply, "/rewind 2" to step back 2 turns, "/compact" to compress context. Queued automatically if the story is streaming. Confirm with the user before destructive ones.`,
			parameters: Type.Object({
				command: Type.String({ description: "完整命令，如 /rewind 2" }),
			}),
			async execute(_id, params) {
				const cmd = params.command.trim();
				const name = cmd.replace(/^\//, "").split(/\s+/)[0]?.toLowerCase() ?? "";
				if (!(STORY_COMMANDS as readonly string[]).includes(name)) {
					return text(`命令不在白名单内：${cmd}（可用：${STORY_COMMANDS.map((c) => `/${c}`).join(" ")}）`, true);
				}
				const queued = bridge.queueStoryCommand(cmd.startsWith("/") ? cmd : `/${cmd}`);
				return text(queued ? `已提交 ${cmd}：剧情正在生成，将在本轮结束后执行。` : `已提交 ${cmd}。`);
			},
		}),
		defineTool({
			name: "config_read",
			label: "读配置",
			description: "Read the project config (drawdream.config.json, normalized).",
			parameters: Type.Object({}),
			async execute() {
				return text(JSON.stringify(loadConfig(cwd), null, 2));
			},
		}),
		defineTool({
			name: "config_write",
			label: "改配置",
			description:
				'Patch the project config (whitelisted fields only: userName/userPersona/displayName/language/scanDepth/maxLoreInjections/greeting/greetingIndex/lorebooks/preset/disabledLore/creationMode…). Pass a JSON object string, e.g. {"scanDepth":6}. Takes effect from the next story turn. Confirm with the user first.',
			parameters: Type.Object({
				patch: Type.String({ description: 'JSON 对象字符串，如 {"language":"中文"}' }),
			}),
			async execute(_id, params) {
				const patch = parseJsonObject(params.patch);
				if (!patch) return text("patch 不是合法的 JSON 对象", true);
				const before = loadConfig(cwd);
				const next = applyConfigPatch(before, patch);
				writeJsonWithBackup(configPath(cwd), next);
				await bridge.softRefreshConfig();
				const changed = Object.keys(patch).filter(
					(k) =>
						JSON.stringify((next as unknown as Record<string, unknown>)[k]) !==
						JSON.stringify((before as unknown as Record<string, unknown>)[k]),
				);
				return text(
					changed.length
						? `配置已写入并热载。变更字段：${changed.join("、")}`
						: "配置已写入，但没有字段实际变化（不在白名单、值相同、或非法值被丢弃）。",
				);
			},
		}),
		defineTool({
			name: "preset_read",
			label: "读预设",
			description:
				"Read the active preset: block list (id/name/channel/enabled/size) and samplers. Pass id to get one block's full content.",
			parameters: Type.Object({
				id: Type.Optional(Type.String({ description: "块 id（给出则返回该块全文）" })),
			}),
			async execute(_id, params) {
				const { preset, path, fromOverride } = loadEffectivePreset(cwd);
				if (!preset) return text(path ? `预设文件不存在：${path}` : "当前未配置预设文件", true);
				if (params.id) {
					const b = preset.blocks.find((x) => x.id === params.id);
					if (!b) return text(`找不到预设块：${params.id}`, true);
					return text(
						`「${b.name}」（id=${b.id}，${b.channel}，${b.enabled ? "启用" : "停用"}，role=${b.role}）\n\n${b.content}`,
					);
				}
				const blocks = preset.blocks
					.map((b) => `- [${b.enabled ? "开" : "关"}] ${b.id}「${b.name}」 ${b.channel} · ${b.content.length} 字`)
					.join("\n");
				return text(
					`预设「${preset.name}」${fromOverride ? "（含未保存草稿）" : ""}\n采样参数：${JSON.stringify(preset.samplers)}\n${blocks}`,
				);
			},
		}),
		defineTool({
			name: "preset_toggle",
			label: "开关预设块",
			description:
				"Enable/disable one preset block (writes the runtime draft, effective from the next story turn; the user can persist it later in the preset panel). Confirm with the user first.",
			parameters: Type.Object({
				id: Type.String({ description: "块 id" }),
				enabled: Type.Boolean({ description: "true=启用 false=停用" }),
			}),
			async execute(_id, params) {
				const { preset, path } = loadEffectivePreset(cwd);
				if (!preset) return text(path ? `预设文件不存在：${path}` : "当前未配置预设文件", true);
				if (!preset.blocks.some((b) => b.id === params.id)) return text(`找不到预设块：${params.id}`, true);
				const next = mergePresetPatches(preset, { blocks: [{ id: params.id, enabled: params.enabled }] });
				const ovr = presetOverridePath(cwd);
				mkdirSync(join(cwd, ".drawdream"), { recursive: true });
				writeFileSync(ovr, `${JSON.stringify(next, null, "\t")}\n`, "utf8");
				await bridge.softRefreshConfig();
				return text(
					`预设块 ${params.id} 已${params.enabled ? "启用" : "停用"}（运行时草稿，下一轮生效；持久保存需在预设面板点「保存」）。`,
				);
			},
		}),
		defineTool({
			name: "world_read",
			label: "读世界状态",
			description: "Read the structured world state ledger (time, location, characters, inventory, flags, plot threads).",
			parameters: Type.Object({}),
			async execute() {
				const state = bridge.worldState();
				return text(`${formatState(state)}\n\nRAW:\n${JSON.stringify(state)}`);
			},
		}),
		defineTool({
			name: "world_write",
			label: "修世界状态",
			description:
				'Patch the world state ledger (applyPatch semantics: time/location replace, characters merge by name, inventory/plot_threads replace whole list, flags merge). Pass a JSON object string, e.g. {"time":"次日清晨"}. Confirm with the user first.',
			parameters: Type.Object({
				patch: Type.String({ description: "JSON 对象字符串（applyPatch 语义）" }),
			}),
			async execute(_id, params) {
				const patch = parseJsonObject(params.patch);
				if (!patch) return text("patch 不是合法的 JSON 对象", true);
				const r = bridge.applyStatePatch(patch);
				return text(
					`账本已更新：${r.applied.join("；") || "（无变更）"}${r.warnings.length ? `\n警告：${r.warnings.join("；")}` : ""}`,
				);
			},
		}),
		defineTool({
			name: "lorebook_search",
			label: "检索世界书",
			description: "Search the mounted lorebooks + supplementary canon for setting details.",
			parameters: Type.Object({
				query: Type.String({ description: "检索词（用世界书原文语言）" }),
				limit: Type.Optional(Type.Number({ description: "命中上限（默认 5）" })),
			}),
			async execute(_id, params) {
				const entries = loadMergedLore(cwd, loadConfig(cwd));
				const hits = searchEntries(entries, params.query, Math.max(1, Math.min(20, params.limit ?? 5)));
				if (hits.length === 0) return text(`（世界书共 ${entries.length} 条，未命中「${params.query}」）`);
				return text(
					hits
						.map((h) => `### ${h.entry.comment || h.entry.keys[0] || "entry"}（keys: ${h.entry.keys.join(", ")}）\n${h.entry.content}`)
						.join("\n\n"),
				);
			},
		}),
		defineTool({
			name: "models_list",
			label: "列可用模型",
			description: "List available models and the current story model. Useful when diagnosing model-specific quirks or advising a model switch.",
			parameters: Type.Object({}),
			async execute() {
				const { current, models } = bridge.listModels();
				const lines = models.map(
					(m) => `- ${m.provider}/${m.id}（${m.providerName}${m.contextWindow ? `，窗口 ${m.contextWindow}` : ""}）`,
				);
				return text(
					`当前剧情模型：${current ? `${current.provider}/${current.id}` : "（未就绪）"}\n可用（${models.length}）：\n${lines.join("\n")}`,
				);
			},
		}),
		defineTool({
			name: "skill_save",
			label: "沉淀技能",
			description:
				"Save a service how-to note into the shared skill library (.drawdream-skills/) after you have verified it works: endpoint, auth, request format, one tested example, gotchas. Same name overwrites.",
			parameters: Type.Object({
				name: Type.String({ description: "技能名（如 comfyui-生图）" }),
				description: Type.String({ description: "一句话描述（进技能索引）" }),
				content: Type.String({ description: "Markdown 正文：endpoint、认证、请求格式、验证过的示例、注意事项" }),
			}),
			async execute(_id, params) {
				const r = saveSkill(cwd, {
					name: params.name,
					description: params.description,
					content: params.content,
				});
				return text(`${r.updated ? "已更新" : "已保存"}技能：${r.file}（你和剧情模型下次都能照笔记直接用）`);
			},
		}),
	);

	// ---- 作者权限（2026-07-14 定调「助手是超集，唯一不能做的是替剧情模型在剧情流里演戏」）----
	// 面板/世界书/知识库/卡都是剧情资产（文件），不是「剧情正文」，助手可写。
	// 落点与剧情 agent 完全一致，写完经 bridge 收编进剧情会话（内存/树/前端 fs.watch）。
	tools.push(
		defineTool({
			name: "panel_write",
			label: "写入面板",
			description:
						"Create or update a side panel in the STORY UI (map, inventory, clue board, relationship chart, diagnostic card…). Same name overwrites. Prefer kind='markdown' with plain Markdown (headings, lists, tables). Spatial maps: kind='svg' with viewBox. Full documents only: kind='html'. Not delivered into the story transcript. kind: markdown | svg | html.",
			parameters: Type.Object({
				name: Type.String({ description: "面板名（页签标题，同名覆盖）" }),
				kind: Type.String({
					description: `${PANEL_KINDS.join(" | ")}（结构化信息用 markdown 纯文本；地图用 svg+viewBox；完整页面才用 html）`,
				}),
				content: Type.String({
					description:
						"Panel body. markdown: plain Markdown only. svg: full SVG. html: full document for iframe.",
				}),
			}),
			async execute(_id, params) {
				if (!PANEL_KINDS.includes(params.kind as (typeof PANEL_KINDS)[number])) {
					return text(`kind 必须是 ${PANEL_KINDS.join(" / ")} 之一，收到「${params.kind}」`, true);
				}
				const r = bridge.writePanels([{ name: params.name, kind: params.kind, content: params.content }]);
				if (r.imported === 0) {
					return text(`面板写入失败：${r.errors.join("；") || "未知错误"}`, true);
				}
				return text(`面板「${params.name}」已写入剧情侧面板（${params.kind}），已在剧情界面显示。`);
			},
		}),
		defineTool({
			name: "show_media",
			label: "展示素材",
			description:
				"Deliver a LOCAL media file (image/audio/video you just generated) into THIS assistant conversation so the user can see/play it here. Use for one-off media the user asked the assistant to make. Note: this shows in the assistant panel, NOT in the story chat — putting media into the story transcript is the story agent's job (show_image). source = a local file path.",
			parameters: Type.Object({
				source: Type.String({ description: "本机媒体文件路径（.png/.jpg/.webp/.gif 或 .mp3/.wav 或 .mp4/.webm 等）" }),
				caption: Type.Optional(Type.String({ description: "简短说明" })),
			}),
			async execute(_id, params) {
				if (/^https?:\/\//i.test(params.source)) {
					return text("show_media 只接本机文件路径；http(s) 链接直接在回复里给出即可。", true);
				}
				const abs = isAbsolute(params.source) ? params.source : join(cwd, params.source);
				const r = bridge.deliverMedia(abs);
				if (!r.ok) return text(r.error, true);
				return {
					content: [{ type: "text" as const, text: `已交付到助手对话（${r.kind}）：${params.caption ?? params.source}` }],
					details: { asstMedia: { src: r.src, kind: r.kind, ...(params.caption ? { caption: params.caption } : {}) } },
				};
			},
		}),
		defineTool({
			name: "lorebook_write",
			label: "写入世界书",
			description:
				"Record a NEW piece of world canon into the supplementary lorebook (persists across sessions, becomes searchable by the story agent). Worldbuilding facts only — plot progress belongs to world_write. Confirm with the user before writing canon.",
			parameters: Type.Object({
				title: Type.String({ description: "条目标题，如「北境骨誓风俗」" }),
				keys: Type.Array(Type.String(), { description: "检索关键词（中文与任何原文名都放进来）" }),
				content: Type.String({ description: "正典正文（简洁、陈述性、用剧情语言）" }),
				constant: Type.Optional(Type.Boolean({ description: "true = 常驻注入（仅全局关键事实）" })),
			}),
			async execute(_id, params) {
				const overlay = overlayPathFor(cwd, bridge.cardName());
				const entry = appendOverlayEntry(overlay, {
					title: params.title,
					keys: params.keys,
					content: params.content,
					constant: params.constant,
				});
				if (!entry) return text("内容与已有条目重复，未写入。");
				await bridge.refreshStoryMaterials();
				return text(
					`已固化为正典：【${entry.comment}】关键词 ${entry.keys.join("、") || "（无）"}${entry.constant ? "（常驻）" : ""}。剧情侧检索即可命中。`,
				);
			},
		}),
		defineTool({
			name: "codex_create",
			label: "建知识库",
			description:
				"Create a new named knowledge codex (a lore database independent of the character card, mountable to any conversation). Then use codex_write to add entries and codex_mount to attach it to the story.",
			parameters: Type.Object({
				name: Type.String({ description: "库名（≤40 字）" }),
				description: Type.Optional(Type.String({ description: "一句话说明这个库收集什么" })),
			}),
			async execute(_id, params) {
				const err = validateCodexName(params.name);
				if (err) return text(err, true);
				const r = createCodex(cwd, params.name, params.description ?? "");
				if (!r.ok) return text(r.error, true);
				return text(`知识库「${r.meta.name}」已创建。可用 codex_write 写条目、codex_mount 挂到剧情。`);
			},
		}),
		defineTool({
			name: "codex_write",
			label: "写知识库",
			description:
				"Add an entry to a named knowledge codex (dedup by content). The codex must already exist (codex_create). Entries become searchable once the codex is mounted to the story.",
			parameters: Type.Object({
				codex: Type.String({ description: "目标库名" }),
				title: Type.String({ description: "条目标题" }),
				keys: Type.Optional(Type.Array(Type.String(), { description: "检索关键词（省略则从标题派生）" })),
				content: Type.String({ description: "条目正文" }),
			}),
			async execute(_id, params) {
				if (!findCodex(cwd, params.codex)) {
					const all = listCodexes(cwd).map((c) => c.name).join("、");
					return text(`没有名为「${params.codex}」的知识库${all ? `（现有：${all}）` : "，先用 codex_create 建库"}。`, true);
				}
				const r = appendCodexEntry(cwd, params.codex, {
					title: params.title,
					keys: params.keys ?? [],
					content: params.content,
				});
				if (!r.ok) return text(r.error, true);
				if (r.entry === null) return text("内容与库中已有条目重复，未写入。");
				return text(`已写入知识库「${params.codex}」：【${params.title}】。挂载到剧情后即可被检索命中。`);
			},
		}),
		defineTool({
			name: "codex_mount",
			label: "挂/卸知识库",
			description:
				"Mount or unmount a knowledge codex onto the story conversation (mounted codex entries join the story's lorebook search). Call with on=false to unmount.",
			parameters: Type.Object({
				name: Type.String({ description: "库名" }),
				on: Type.Optional(Type.Boolean({ description: "true=挂载（默认）false=卸载" })),
			}),
			async execute(_id, params) {
				const meta = findCodex(cwd, params.name);
				if (!meta) return text(`没有名为「${params.name}」的知识库。`, true);
				const on = params.on !== false;
				bridge.mountCodex(meta.name, on);
				return text(`知识库「${meta.name}」已${on ? "挂载到" : "从"}剧情对话${on ? "" : "卸载"}（${meta.entryCount} 条）。`);
			},
		}),
		defineTool({
			name: "card_create",
			label: "创建角色卡",
			description:
				"Create a new character card as a JSON file in assets/cards/ (chara_card_v3). Use when the user asks you to make/build a character card. Does NOT switch the story to it — tell the user to open it from the card library. Confirm the character details with the user first.",
			parameters: Type.Object({
				name: Type.String({ description: "角色名（也用作文件名）" }),
				description: Type.String({ description: "角色描述（外貌、背景、身份）" }),
				personality: Type.Optional(Type.String({ description: "性格" })),
				scenario: Type.Optional(Type.String({ description: "开场场景设定" })),
				first_mes: Type.String({ description: "开场白（第一条消息）" }),
				mes_example: Type.Optional(Type.String({ description: "对白示例（文风参考）" })),
				alternate_greetings: Type.Optional(Type.Array(Type.String(), { description: "备选开场白" })),
			}),
			async execute(_id, params) {
				const safe = params.name.trim().replace(/[\\/:*?"<>|]/g, "-");
				if (!safe) return text("角色名不能为空。", true);
				const cardsDir = join(cwd, "assets", "cards");
				mkdirSync(cardsDir, { recursive: true });
				const dest = join(cardsDir, `${safe}.json`);
				if (existsSync(dest)) return text(`同名卡已存在：${safe}.json（换个名字，或让用户先删旧卡）。`, true);
				const data = {
					spec: "chara_card_v3",
					spec_version: "3.0",
					data: {
						name: params.name.trim(),
						description: params.description,
						personality: params.personality ?? "",
						scenario: params.scenario ?? "",
						first_mes: params.first_mes,
						mes_example: params.mes_example ?? "",
						alternate_greetings: params.alternate_greetings ?? [],
						creator_notes: "由助手创建",
						tags: [],
						character_book: undefined,
					},
				};
				writeFileSync(dest, `${JSON.stringify(data, null, "\t")}\n`, "utf8");
				try {
					const card = loadCardFile(dest);
					if (!card.name.trim()) throw new Error("卡名解析为空");
				} catch (e) {
					try {
						if (existsSync(dest)) unlinkSync(dest);
					} catch {
						// 清理失败不影响报错返回
					}
					return text(`生成的卡无法解析（已删除）：${e instanceof Error ? e.message : String(e)}`, true);
				}
				return text(`角色卡「${params.name}」已创建：assets/cards/${safe}.json。让用户到角色卡库里打开它开始扮演。`);
			},
		}),
	);

	return tools;
}

// ---------- 内联扩展工厂：system prompt 覆盖 + 每轮剧情快照注入 ----------

function stagehandExtension(
	cwd: string,
	bridge: StoryBridge,
	getSelf: () => { model: { provider: string; id: string } | null; follow: boolean },
	isWebSearchEnabled: () => boolean,
): ExtensionFactory {
	return (pi) => {
		let cache = "";
		const rebuild = () => {
			cache = buildStagehandPrompt({ config: loadConfig(cwd), skills: listSkills(cwd) });
		};
		pi.on("session_start", async () => {
			rebuild();
		});
		pi.on("before_agent_start", async () => {
			if (!cache) rebuild();
			return {
				systemPrompt: isWebSearchEnabled()
					? cache
					: `${cache}\n\n【本轮工具策略】联网搜索关闭；smart_search 已从本轮工具列表移除。`,
			};
		});
		// 每轮末端注入剧情快照（动态内容不进 system prompt）
		pi.on("context", async (event) => {
			const self = getSelf();
			const messages = [...(event.messages as unknown[])];
			// 取最近一条用户原文，用于联网检索意图强制
			let lastUser = "";
			for (let i = messages.length - 1; i >= 0; i--) {
				const m = messages[i] as { role?: unknown; content?: unknown };
				if (m?.role === "user") {
					const c = m.content;
					if (typeof c === "string") lastUser = c;
					else if (Array.isArray(c)) {
						lastUser = c
							.map((p) =>
								p && typeof p === "object" && (p as { type?: unknown }).type === "text"
									? String((p as { text?: unknown }).text ?? "")
									: "",
							)
							.filter(Boolean)
							.join("\n");
					}
					break;
				}
			}
			messages.push({
				role: "custom",
				customType: "stagehand-inject",
				content: buildStagehandInjection(
					{
						...bridge.snapshot(),
						assistantModel: self.model,
						assistantFollows: self.follow,
					},
					lastUser,
					isWebSearchEnabled(),
				),
				display: false,
				timestamp: Date.now(),
			});
			return { messages: messages as never };
		});
	};
}

// ---------- 会话托管 ----------

export async function createAssistantHost(opts: CreateAssistantHostOptions): Promise<AssistantHost> {
	const { cwd, bridge, onEvent, onError, uiContext } = opts;
	const sessionDir = dir(cwd, "assistant");
	mkdirSync(sessionDir, { recursive: true });

	let session: AgentSession;
	let unsubscribe: (() => void) | undefined;
	let webSearchEnabled = false;
	let assistantToolNames: string[] | null = null;

	const selfInfo = () => ({ model: modelInfo(), follow: follows() });

	const build = async (fresh: boolean): Promise<AgentSession> => {
		const agentDir = getAgentDir();
		const settingsManager = SettingsManager.create(cwd, agentDir);
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			// 不吃 roleplay.ts（剧情工具）也不吃 coding 语境（AGENTS.md/主题/模板）；
			// DrawDream 技能库走自家提示词索引，pi skills 机制关闭。
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			extensionFactories: [stagehandExtension(cwd, bridge, selfInfo, () => webSearchEnabled)],
		});
		await loader.reload();

		const config = loadConfig(cwd);
		const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
		const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"), {
			skipBuiltInModels: true,
		});
		// 与剧情会话对齐：从 drawdream.agent.json 灌入明文 Key（AuthStorage 文件可能滞后）
		try {
			const loaded = loadAgentConfig(cwd);
			if (loaded.exists && Object.keys(loaded.config.providers).length > 0) {
				const cfg = normalizeAgentConfig(loaded.config);
				syncAgentConfigToRuntime(cwd, agentDir, cfg);
				modelRegistry.refresh();
				for (const [name, p] of Object.entries(cfg.providers)) {
					const key = typeof p.apiKey === "string" ? p.apiKey.trim() : "";
					if (key && key !== "placeholder" && !key.startsWith("$") && !key.startsWith("!")) {
						try {
							authStorage.set(name, { type: "api_key", key });
						} catch {
							/* ignore */
						}
					}
				}
			}
		} catch {
			/* 无 agent 配置时跳过 */
		}

		const { session: s } = await createAgentSession({
			cwd,
			agentDir,
			authStorage,
			modelRegistry,
			customTools: createStagehandTools(cwd, bridge),
			// backendControl 关 = 分发模式：助手也不给本机工具（read/bash/edit/write），只留领域工具
			...(config.backendControl === false ? { noTools: "builtin" as const } : {}),
			resourceLoader: loader,
			settingsManager,
			sessionManager: fresh
				? SessionManager.create(cwd, sessionDir)
				: SessionManager.continueRecent(cwd, sessionDir),
		});

		await s.bindExtensions({
			uiContext: uiContext as never,
			mode: "rpc",
			onError: (err: { extensionPath: string; event: string; error: string }) => {
				onError(`助手扩展错误（${err.event}）：${err.error}`);
			},
		} as never);

		// 显式助手模型：创建后手动应用（避免 setModel 改写共享默认模型设置）
		if (config.assistantModel) {
			applyModelTo(s, config.assistantModel, true);
		} else {
			// 跟随模式：优先对齐剧情当前模型，避免 unknown 占位
			const story = bridge.snapshot().model;
			if (story?.provider && story?.id) {
				applyModelTo(s, story, true);
			} else {
				const first = s.modelRegistry.getAvailable()[0];
				if (first) {
					applyModelTo(s, { provider: first.provider, id: first.id }, true);
				}
			}
		}
		return s;
	};

	/** 手动应用模型：auth 校验 + 状态 + 会话树记录 + 思考档重夹（绕开 settings 副作用） */
	const applyModelTo = (s: AgentSession, sel: AssistantModelSel, quiet = false): boolean => {
		const m = s.modelRegistry.find(sel.provider, sel.id);
		if (!m) {
			if (!quiet) throw new Error(`模型不存在：${sel.provider}/${sel.id}`);
			onError(`助手模型 ${sel.provider}/${sel.id} 不在可用清单，暂用默认模型`);
			return false;
		}
		if (!s.modelRegistry.hasConfiguredAuth(m)) {
			if (!quiet) throw new Error(`模型 ${sel.provider}/${sel.id} 没有可用的 API key`);
			onError(`助手模型 ${sel.provider}/${sel.id} 缺少 API key，暂用默认模型`);
			return false;
		}
		const cur = s.model;
		if (cur && cur.provider === m.provider && cur.id === m.id) return true;
		s.agent.state.model = m;
		try {
			s.sessionManager.appendModelChange(m.provider, m.id);
		} catch {
			// 会话极早期不可写：状态已生效，记录缺一条无碍
		}
		try {
			s.setThinkingLevel(s.thinkingLevel as never);
		} catch {
			// 档位不适配新模型时保持默认
		}
		return true;
	};

	const subscribe = () => {
		unsubscribe?.();
		unsubscribe = session.subscribe((event) => onEvent(event));
	};

	const follows = () => !loadConfig(cwd).assistantModel;

	const modelInfo = () => {
		const m = session?.model;
		return m ? { provider: m.provider, id: m.id, name: m.name || m.id } : null;
	};

	/** 发话前再同步一次明文 Key（设置页刚改过渠道时助手侧内存可能旧） */
	const refreshAuthKeys = () => {
		try {
			const agentDir = getAgentDir();
			const loaded = loadAgentConfig(cwd);
			if (!loaded.exists) return;
			const cfg = normalizeAgentConfig(loaded.config);
			syncAgentConfigToRuntime(cwd, agentDir, cfg);
			session.modelRegistry.refresh();
			for (const [name, p] of Object.entries(cfg.providers)) {
				const key = typeof p.apiKey === "string" ? p.apiKey.trim() : "";
				if (key && key !== "placeholder" && !key.startsWith("$") && !key.startsWith("!")) {
					try {
						session.modelRegistry.authStorage.set(name, { type: "api_key", key });
					} catch {
						/* ignore */
					}
				}
			}
		} catch {
			/* ignore */
		}
	};

	/** 跟随模式：发话前把助手模型对齐到剧情模型（provider+id 相同则空转） */
	const syncFollowModel = () => {
		if (!follows()) return;
		const story = bridge.snapshot().model;
		const cur = session.model;
		if (story?.provider && story?.id) {
			if (cur && cur.provider === story.provider && cur.id === story.id) return;
			if (applyModelTo(session, story, true)) return;
		}
		// 剧情无模型或对齐失败：落到第一个可用
		if (!cur || cur.provider === "unknown") {
			const first = session.modelRegistry.getAvailable()[0];
			if (first) applyModelTo(session, { provider: first.provider, id: first.id }, true);
		}
	};

	session = await build(false);
	assistantToolNames = session.getActiveToolNames();
	subscribe();

	return {
		async prompt(t: string, webSearch = false) {
			refreshAuthKeys();
			syncFollowModel();
			const config = loadConfig(cwd);
			webSearchEnabled = webSearch && config.smartSearch?.enabled !== false;
			assistantToolNames ??= session.getActiveToolNames();
			session.setActiveToolsByName(
				webSearchEnabled
					? assistantToolNames
					: assistantToolNames.filter((name) => name !== "smart_search"),
			);
			await session.prompt(t, session.isStreaming ? { streamingBehavior: "followUp" } : undefined);
		},
		async abort() {
			await session.abort();
		},
		async newConversation() {
			try {
				await session.abort();
			} catch {
				// 空闲时 abort 无事发生
			}
			unsubscribe?.();
			session.dispose();
			session = await build(true);
			assistantToolNames = session.getActiveToolNames();
			subscribe();
		},
		async setModel(sel) {
			const config = loadConfig(cwd);
			if (!sel) {
				if (config.assistantModel) {
					const { assistantModel: _drop, ...rest } = config;
					writeJsonWithBackup(configPath(cwd), rest);
				}
				syncFollowModel();
				return;
			}
			applyModelTo(session, sel); // 非法则抛错，不写配置
			writeJsonWithBackup(configPath(cwd), { ...loadConfig(cwd), assistantModel: { ...sel } });
		},
		modelInfo,
		follows,
		messages: () => session.messages as unknown[],
		isStreaming: () => session.isStreaming,
		async dispose() {
			unsubscribe?.();
			try {
				await session.abort();
			} catch {
				// ignore
			}
			session.dispose();
		},
	};
}
