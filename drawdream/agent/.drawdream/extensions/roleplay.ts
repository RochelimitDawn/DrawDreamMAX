/**
 * DrawDream 剧情接线层（产品扩展）。
 * - 装载角色卡 / 世界书 / 预设进 system prompt
 * - 每轮末端注入世界状态与触发设定
 * - 注册剧情工具与 /rprefresh 热更新命令
 * - 会话打开时写入 rp-card 标记与开场白
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
	defineTool,
	type ExtensionAPI,
	type ExtensionContext,
} from "@drawdream/agent-runtime";
import { Type } from "typebox";

import { loadCardFile } from "../../src/card.ts";
import {
	buildGreeting,
	buildSystemPrompt,
	buildTurnInjection,
	countVisibleNarrativeChars,
	detectsLanguageMismatch,
	looksLikeOpeningMenu,
	narrativeLengthBounds,
	needsOpeningChoice,
	parseOpeningOptions,
	userSeeksDirection,
} from "../../src/director.ts";
import { getSearchTurnPolicy } from "../../src/search-turn-context.ts";
import { formatSummariesForInject, loadSummaries } from "../../src/turn-summary.ts";
import { activateTavernWorldInfo } from "../../src/tavern-prompt.ts";
import { loadBranchStateIndex, recordBranchState, restoreBranchState, saveBranchStateIndex } from "../../src/branch-state.ts";
import {
	appendOverlayEntry,
	applyDisabledLore,
	constantEntries,
	loadLorebookFile,
	mergeEntries,
	mountedLorebookPaths,
	overlayPathFor,
	searchEntries,
} from "../../src/lorebook.ts";
import {
	appendDrawer,
	formatWakeContext,
	listRooms,
	searchDrawers,
	sessionWing,
} from "../../src/palace.ts";
import {
	activePanels,
	closePanel,
	formatPanelIndex,
	loadPanels,
	savePanels,
	writePanel,
	PANEL_KINDS,
} from "../../src/panels.ts";
import { dir, resolveConfigPath, resolvePresetPath } from "../../src/paths.ts";
import { enabledBlocks, normalizeRpPreset } from "../../src/preset.ts";
import { formatSearchPlain, runSmartSearch } from "../../src/smart-search.ts";
import { applyPatch, formatState, loadState, saveState } from "../../src/state.ts";
import { listSkills } from "../../src/skills.ts";
import {
	fetchWorldTime,
	formatTimePanelTag,
	formatWorldTimePlain,
} from "../../src/world-time.ts";
import { DEFAULT_CONFIG, type CharacterCard, type LorebookEntry, type RpConfig } from "../../src/types.ts";

function text(s: string, isError = false) {
	return {
		content: [{ type: "text" as const, text: s }],
		details: undefined,
		...(isError ? { isError: true } : {}),
	};
}

/** 终止型工具结果：本轮立即收尾（不再让模型续问），且 toolResult 正常配对历史。 */
function terminateText(s: string) {
	return {
		content: [{ type: "text" as const, text: s }],
		details: undefined,
		terminate: true,
	};
}

function loadConfig(cwd: string): RpConfig {
	const p = resolveConfigPath(cwd);
	if (!existsSync(p)) return { ...DEFAULT_CONFIG };
	try {
		const raw = { ...DEFAULT_CONFIG, ...(JSON.parse(readFileSync(p, "utf8")) as Partial<RpConfig>) };
		return raw;
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

function loadCard(cwd: string, config: RpConfig): CharacterCard | null {
	const rel = (config.card ?? "").trim();
	if (!rel) return null;
	const abs = isAbsolute(rel) ? rel : join(cwd, rel);
	if (!existsSync(abs)) return null;
	try {
		return loadCardFile(abs);
	} catch {
		return null;
	}
}

function loadAllLore(cwd: string, config: RpConfig, card: CharacterCard | null): LorebookEntry[] {
	const groups: LorebookEntry[][] = [];
	if (card?.book?.length) groups.push(card.book);
	for (const rel of mountedLorebookPaths(config)) {
		const abs = isAbsolute(rel) ? rel : join(cwd, rel);
		if (existsSync(abs)) {
			try {
				groups.push(loadLorebookFile(abs));
			} catch {
				/* skip bad book */
			}
		}
	}
	if (card) {
		const ov = overlayPathFor(cwd, card.name);
		if (existsSync(ov)) {
			try {
				groups.push(loadLorebookFile(ov));
			} catch {
				/* skip */
			}
		}
	}
	return applyDisabledLore(mergeEntries(...groups), config.disabledLore);
}

function stateFile(cwd: string, sessionId: string): string {
	return join(dir(cwd, "state"), `${sessionId}.json`);
}

function branchStateFile(cwd: string, sessionId: string): string {
	return join(dir(cwd, "state"), `${sessionId}.branches.json`);
}

function panelsFile(cwd: string, sessionId: string): string {
	return join(dir(cwd, "artifacts"), `${sessionId}.json`);
}

function branchUserWindow(ctx: ExtensionContext, depth: number): string {
	const branch = ctx.sessionManager.getBranch() as Array<Record<string, unknown>>;
	const chunks: string[] = [];
	for (let i = branch.length - 1; i >= 0 && chunks.length < depth * 2; i--) {
		const e = branch[i];
		if (e?.type !== "message") continue;
		const msg = e.message as { role?: string; content?: unknown } | undefined;
		if (!msg || (msg.role !== "user" && msg.role !== "assistant")) continue;
		const c = msg.content;
		let t = "";
		if (typeof c === "string") t = c;
		else if (Array.isArray(c)) {
			t = c
				.map((p) =>
					p && typeof p === "object" && (p as { type?: string }).type === "text"
						? String((p as { text?: string }).text ?? "")
						: "",
				)
				.filter(Boolean)
				.join("\n");
		}
		if (t.trim()) chunks.push(t);
	}
	return chunks.reverse().join("\n");
}

function lastUserText(messages: unknown[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i] as { role?: unknown; content?: unknown };
		if (m?.role !== "user") continue;
		const c = m.content;
		if (typeof c === "string") return c;
		if (Array.isArray(c)) {
			return c
				.map((p) =>
					p && typeof p === "object" && (p as { type?: unknown }).type === "text"
						? String((p as { text?: unknown }).text ?? "")
						: "",
				)
				.filter(Boolean)
				.join("\n");
		}
	}
	return "";
}

function contentToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((p) =>
				p && typeof p === "object" && (p as { type?: unknown }).type === "text"
					? String((p as { text?: unknown }).text ?? "")
					: "",
			)
			.filter(Boolean)
			.join("\n");
	}
	return "";
}

/** 从分支取出最新 rp-greeting 正文（【开场】说明书） */
function branchGreetingText(ctx: ExtensionContext): string {
	const branch = ctx.sessionManager.getBranch() as Array<Record<string, unknown>>;
	for (let i = branch.length - 1; i >= 0; i--) {
		const e = branch[i];
		const t = String(e?.type ?? "");
		// session 树：custom_message；部分路径可能写 custom
		if ((t === "custom_message" || t === "custom") && e.customType === "rp-greeting") {
			return contentToText(e.content);
		}
		if (t === "message") {
			const msg = e.message as { role?: string; customType?: string; content?: unknown } | undefined;
			if (msg?.customType === "rp-greeting" || (msg?.role === "custom" && msg?.customType === "rp-greeting")) {
				return contentToText(msg.content);
			}
		}
	}
	return "";
}

/**
 * 是否已有 ask_director 选定结果（工具回传「用户选择：」）。
 * 覆盖 event.messages 与 session 分支（含 toolResult）。
 */
function hasDirectorUserPick(messages: unknown[], ctx: ExtensionContext): boolean {
	const hit = (text: string) => /用户选择\s*[:：]/.test(text);
	for (const raw of messages) {
		const m = raw as { role?: string; content?: unknown; toolName?: string };
		const t = contentToText(m?.content);
		if (t && hit(t)) return true;
	}
	const branch = ctx.sessionManager.getBranch() as Array<Record<string, unknown>>;
	for (const e of branch) {
		if (e?.type !== "message") continue;
		const msg = e.message as { role?: string; content?: unknown; toolName?: string } | undefined;
		if (!msg) continue;
		const t = contentToText(msg.content);
		if (t && hit(t)) return true;
	}
	return false;
}

export default function roleplayExtension(pi: ExtensionAPI) {
	let systemCache = "";
	let lastCardPath = "";
	let lastCardName = "";

	const rebuild = (cwd: string) => {
		const config = loadConfig(cwd);
		const card = loadCard(cwd, config);
		if (!card) {
			systemCache = `# DrawDream\n未装载角色卡。请到「角色卡」库导入或点「开始对话」选用一张卡后再聊。`;
			lastCardPath = "";
			lastCardName = "";
			return { config, card: null as CharacterCard | null, lore: [] as LorebookEntry[] };
		}
		const lore = loadAllLore(cwd, config, card);
		const constantLore = constantEntries(lore);
		let presetSystemBlocks: ReturnType<typeof enabledBlocks> | undefined;
		try {
			const presetPath = resolvePresetPath(cwd, config.preset);
			if (existsSync(presetPath)) {
				const raw = JSON.parse(readFileSync(presetPath, "utf8"));
				const p = normalizeRpPreset(raw);
				presetSystemBlocks = enabledBlocks(p, "system");
			}
		} catch {
			/* ignore preset */
		}
		const skills = listSkills(cwd);
		systemCache = buildSystemPrompt({
			card,
			config,
			constantLore,
			presetSystemBlocks,
			skills,
		});
		lastCardPath = (config.card ?? "").trim();
		lastCardName = card.name;
		return { config, card, lore };
	};

	const ensureCardTag = (ctx: ExtensionContext, config: RpConfig, card: CharacterCard) => {
		const path = (config.card ?? "").trim();
		if (!path) return;
		const branch = ctx.sessionManager.getBranch() as Array<Record<string, unknown>>;
		// 会话已有 rp-card 时禁止用全局 config 覆盖（跨卡历史 resume 会把 B 会话污染成 A 卡）
		const hasRpCard = branch.some((e) => {
			const t = String(e.type ?? "");
			if ((t === "custom" || t === "custom_message") && e.customType === "rp-card") return true;
			if (t === "message") {
				const msg = e.message as { customType?: string } | undefined;
				return msg?.customType === "rp-card";
			}
			return e.customType === "rp-card";
		});
		if (!hasRpCard) {
			pi.appendEntry("rp-card", { card: path, name: card.name });
		}
		if (config.greeting === false) return;
		const hasGreeting = branch.some((e) => {
			const t = String(e.type ?? "");
			if ((t === "custom_message" || t === "custom") && e.customType === "rp-greeting") return true;
			if (t === "message") {
				const msg = e.message as { role?: string; customType?: string } | undefined;
				return msg?.customType === "rp-greeting";
			}
			return false;
		});
		const hasUser = branch.some((e) => {
			if (e.type !== "message") return false;
			const msg = e.message as { role?: string } | undefined;
			return msg?.role === "user";
		});
		// 仅无开场白且无用户消息时补注入；resume 已有历史时绝不重写
		if (!hasGreeting && !hasUser) {
			const body = buildGreeting(card, config);
			if (body.trim()) {
				pi.sendMessage({
					customType: "rp-greeting",
					content: body,
					display: true,
					streaming: false,
					details: {
						rpGreeting: {
							index: config.greetingIndex ?? 0,
							total: 1 + (card.alternateGreetings?.length ?? 0),
							fullIndex: config.greetingIndex ?? 0,
						},
					},
				});
			}
		}
	};

	/** 上一轮可见正文字数（按会话）；下一轮注入纠正，避免模型自计字不准 */
	const lengthFeedbackBySession = new Map<string, { chars: number; min: number; max: number }>();

	pi.on("session_start", async (_ev, ctx) => {
		const cwd = ctx.cwd;
		mkdirSync(dir(cwd, "state"), { recursive: true });
		mkdirSync(dir(cwd, "artifacts"), { recursive: true });
		const { config, card } = rebuild(cwd);
		if (card) ensureCardTag(ctx, config, card);
	});

	pi.on("before_agent_start", async (_ev, ctx) => {
		const cfg = loadConfig(ctx.cwd);
		const curPath = (cfg.card ?? "").trim();
		// 换卡或首次：必须重建，避免旧卡 system / 空卡提示残留
		if (!systemCache || curPath !== lastCardPath) rebuild(ctx.cwd);
		const policy = getSearchTurnPolicy(ctx.cwd, ctx.sessionManager.getSessionId());
		return {
			systemPrompt:
				policy === "force"
					? systemCache
					: `${systemCache}\n\n【本轮工具策略】联网搜索关闭；smart_search 已从本轮工具列表移除。`,
		};
	});

	pi.on("context", async (event, ctx) => {
		const cwd = ctx.cwd;
		const { config, card, lore } = rebuild(cwd);
		if (!card) return;
		const sid = ctx.sessionManager.getSessionId();
		const stateIndex = loadBranchStateIndex(branchStateFile(cwd, sid));
		const state = restoreBranchState(stateIndex, (ctx.sessionManager.getBranch() as Array<Record<string, unknown>>).map((entry) => String(entry.id)), loadState(stateFile(cwd, sid)));
		const windowText = branchUserWindow(ctx, config.scanDepth ?? 4);
		const activated = activateTavernWorldInfo({
			entries: lore,
			recentMessages: windowText ? [windowText] : [],
			scanDepth: config.scanDepth ?? 4,
			maxEntries: config.maxLoreInjections ?? 3,
		}).entries;
		const lastUser = lastUserText(event.messages as unknown[]);
		const panelMap = loadPanels(panelsFile(cwd, sid));
		const panelIndex = formatPanelIndex(panelMap) ?? undefined;
		const wing = sessionWing(sid);
		const palaceWake =
			formatWakeContext(cwd, { wing, query: lastUser || undefined, limit: 4 }) || undefined;
		const languageMismatch = lastUser
			? detectsLanguageMismatch(lastUser, config.language ?? "zh")
			: false;
		const forceAsk = (config.creationMode ?? "ask") === "ask" && userSeeksDirection(lastUser);
		void forceAsk;
		const greetingText = branchGreetingText(ctx);
		const openingPending =
			(config.creationMode ?? "ask") === "ask" &&
			needsOpeningChoice({
			greetingText,
			hasUserPick: hasDirectorUserPick(event.messages as unknown[], ctx),
			});
		const openingOptions = openingPending && looksLikeOpeningMenu(greetingText)
			? parseOpeningOptions(greetingText)
			: [];
		const turnSummaries = formatSummariesForInject(
			loadSummaries(cwd, sid),
			config.pipeline?.maxSummaries ?? 24,
		);
		// 预设 post-history（ST 语义末端指令；与 system 块分流）
		let presetPostHistoryBlocks: ReturnType<typeof enabledBlocks> | undefined;
		try {
			const presetPath = resolvePresetPath(cwd, config.preset);
			if (existsSync(presetPath)) {
				const raw = JSON.parse(readFileSync(presetPath, "utf8"));
				const p = normalizeRpPreset(raw);
				const blocks = enabledBlocks(p, "postHistory");
				if (blocks.length) presetPostHistoryBlocks = blocks;
			}
		} catch {
			/* ignore preset */
		}
		const lengthFeedback = lengthFeedbackBySession.get(sid);
		const inject = buildTurnInjection({
			state,
			activatedLore: activated,
			card,
			config,
			languageMismatch,
			panelIndex,
			palaceWake,
			userText: lastUser,
			webSearchEnabled: getSearchTurnPolicy(cwd, sid) === "force",
			turnSummaries: turnSummaries || undefined,
			forceOpeningChoice: openingPending,
			openingOptions: openingOptions.length >= 2 ? openingOptions : undefined,
			presetPostHistoryBlocks,
			lengthFeedback,
		});
		// 注入后清除，避免连续多轮误用旧反馈
		if (lengthFeedback) lengthFeedbackBySession.delete(sid);
		const messages = [...(event.messages as unknown[])];
		messages.push({
			role: "custom",
			customType: "rp-inject",
			content: inject,
			display: false,
			timestamp: Date.now(),
		});
		return { messages: messages as never };
	});

	pi.on("agent_end", async (event, ctx) => {
		try {
			const cwd = ctx.cwd;
			const config = loadConfig(cwd);
			const bounds = narrativeLengthBounds(config);
			if (!bounds.hardCap) return;
			const sid = ctx.sessionManager.getSessionId();
			const msgs = (event.messages ?? []) as Array<{
				role?: string;
				content?: unknown;
			}>;
			let lastText = "";
			for (let i = msgs.length - 1; i >= 0; i--) {
				const m = msgs[i];
				if (m?.role !== "assistant") continue;
				const c = m.content;
				if (typeof c === "string") {
					lastText = c;
					break;
				}
				if (Array.isArray(c)) {
					lastText = c
						.map((p) => {
							if (typeof p === "string") return p;
							if (p && typeof p === "object" && "type" in p && (p as { type?: string }).type === "text") {
								return String((p as { text?: string }).text ?? "");
							}
							return "";
						})
						.join("");
					if (lastText) break;
				}
			}
			const chars = countVisibleNarrativeChars(lastText);
			if (chars <= 0) return;
			if (chars > bounds.max * 1.15 || chars < bounds.min * 0.7) {
				lengthFeedbackBySession.set(sid, { chars, min: bounds.min, max: bounds.max });
			}
		} catch {
			/* ignore length feedback errors */
		}
	});

	pi.registerCommand("rprefresh", {
		description: "热更新角色卡/世界书/预设到 system prompt（不重开会话）",
		handler: async (_args, ctx) => {
			rebuild(ctx.cwd);
			const { config, card } = rebuild(ctx.cwd);
			if (card) {
				pi.appendEntry("rp-card", { card: (config.card ?? "").trim(), name: card.name });
			}
			ctx.ui.notify(
				card ? `已刷新剧情素材「${card.name}」` : "已刷新（当前无角色卡）",
				"info",
			);
		},
	});

	// ---- 剧情工具 ----

	pi.registerTool(
		defineTool({
			name: "lorebook_search",
			label: "查阅设定",
			description: "Search world lore / character book entries by keyword.",
			parameters: Type.Object({
				query: Type.String({ description: "检索词（与世界书原文语言一致）" }),
				limit: Type.Optional(Type.Number({ description: "命中上限，默认 3" })),
			}),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const config = loadConfig(ctx.cwd);
				const card = loadCard(ctx.cwd, config);
				const lore = loadAllLore(ctx.cwd, config, card);
				const hits = searchEntries(lore, params.query, params.limit ?? 3);
				if (!hits.length) return text(`未命中设定：${params.query}`);
				return text(
					hits
						.map(
							(h, i) =>
								`${i + 1}. ${h.entry.comment || "(无标题)"} [score=${h.score}]\n${h.entry.content}`,
						)
						.join("\n\n"),
				);
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "lorebook_write",
			label: "记下设定",
			description: "Append a new lore entry to the agent overlay book for this card.",
			parameters: Type.Object({
				title: Type.String({ description: "条目标题" }),
				content: Type.String({ description: "条目正文" }),
				keys: Type.Optional(Type.String({ description: "关键词，逗号分隔" })),
			}),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const config = loadConfig(ctx.cwd);
				const card = loadCard(ctx.cwd, config);
				if (!card) return text("未装载角色卡，无法写入设定", true);
				const keys = (params.keys ?? params.title)
					.split(/[,，;；]/)
					.map((s) => s.trim())
					.filter(Boolean);
				const path = overlayPathFor(ctx.cwd, card.name);
				const entry = appendOverlayEntry(path, {
					title: params.title,
					content: params.content,
					keys,
				});
				if (!entry) return text("写入失败（可能与已有条目重复）", true);
				return text(`已写入补充设定「${params.title}」`);
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "world_state_get",
			label: "核对账本",
			description: "Read the persistent world state ledger for this session.",
			parameters: Type.Object({}),
			async execute(_id, _params, _signal, _onUpdate, ctx) {
				const sid = ctx.sessionManager.getSessionId();
				const state = loadState(stateFile(ctx.cwd, sid));
				return text(formatState(state) || "（账本为空）");
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "world_state_update",
			label: "更新账本",
			description:
				"Merge a JSON patch into the world state ledger. Include chapter when the act/chapter title changes (sticky chapter bar reads it).",
			parameters: Type.Object({
				patch: Type.String({
					description:
						'JSON object string, e.g. {"location":"听雨轩","time":"子时","chapter":"第一章 · 听雨"}',
				}),
			}),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				let patch: Record<string, unknown>;
				try {
					patch = JSON.parse(params.patch) as Record<string, unknown>;
				} catch {
					return text("patch 不是合法 JSON 对象", true);
				}
				const sid = ctx.sessionManager.getSessionId();
				const file = stateFile(ctx.cwd, sid);
				const branchFile = branchStateFile(ctx.cwd, sid);
				const prev = loadState(file);
				const r = applyPatch(prev, patch);
				saveState(file, r.state);
				const leafId = ctx.sessionManager.getLeafId();
				const index = recordBranchState(loadBranchStateIndex(branchFile), leafId, r.state);
				saveBranchStateIndex(branchFile, index);
				return text(
					`已更新账本。\n${r.applied.join("\n") || "(无字段变更)"}${
						r.warnings.length ? `\n警告：${r.warnings.join("; ")}` : ""
					}`,
				);
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "memory_search",
			label: "回想往事",
			description: "Search this session's memory palace drawers.",
			parameters: Type.Object({
				query: Type.String({ description: "检索词" }),
				limit: Type.Optional(Type.Number()),
			}),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const wing = sessionWing(ctx.sessionManager.getSessionId());
				const hits = searchDrawers(ctx.cwd, params.query, {
					wing,
					limit: params.limit ?? 6,
					followTunnels: true,
				});
				if (!hits.length) return text(`记忆中未找到：${params.query}`);
				return text(
					hits.map((h, i) => `${i + 1}. [${h.drawer.hall}] ${h.drawer.text}`).join("\n\n"),
				);
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "memory_store",
			label: "收存记忆",
			description: "Store a lasting fact/preference/promise into the memory palace.",
			parameters: Type.Object({
				text: Type.String({ description: "要记住的原文" }),
				hall: Type.Optional(
					Type.String({ description: "facts|events|discoveries|preferences|promises" }),
				),
			}),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const wing = sessionWing(ctx.sessionManager.getSessionId());
				const hall =
					params.hall === "facts" ||
					params.hall === "events" ||
					params.hall === "discoveries" ||
					params.hall === "preferences" ||
					params.hall === "promises"
						? params.hall
						: "facts";
				const d = appendDrawer(ctx.cwd, {
					wing,
					hall,
					text: params.text,
					source: "manual",
					tags: [],
				});
				if (!d) return text("未写入（过短或与已有记忆重复）", true);
				return text(`已收存到记忆宫 · ${hall}`);
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "memory_rooms",
			label: "浏览记忆厅",
			description: "List memory palace room index for this session.",
			parameters: Type.Object({}),
			async execute(_id, _params, _signal, _onUpdate, ctx) {
				const wing = sessionWing(ctx.sessionManager.getSessionId());
				const rooms = listRooms(ctx.cwd, wing);
				if (!rooms.length) return text("本会话记忆宫尚空");
				return text(rooms.map((r) => `- ${r.room}/${r.hall}: ${r.count} 条`).join("\n"));
			},
		}),
	);

	/** 消息流内嵌 HTML 上限（字符），防止异常大载荷 */
	const SHOW_HTML_MAX = 300_000;

	pi.registerTool(
		defineTool({
			name: "show_html",
			label: "嵌入界面",
			description:
				"Embed an HTML fragment in the story chat (phone UI, form, status widget). For interactive UI set scripts=true (sandboxed iframe + DrawDream.send bridge). Side-panel meta use panel_write instead.",
			parameters: Type.Object({
				html: Type.String({ description: "HTML fragment or full document" }),
				title: Type.Optional(Type.String({ description: "Optional caption / a11y title" })),
				scripts: Type.Optional(
					Type.Boolean({
						description: "Allow scripts in sandbox iframe (default false). Use for forms/buttons that call DrawDream.send().",
					}),
				),
			}),
			async execute(_id, params) {
				const html = String(params.html ?? "");
				if (!html.trim()) return text("html 不能为空", true);
				if (html.length > SHOW_HTML_MAX) {
					return text(`html 过长（>${SHOW_HTML_MAX} 字符）`, true);
				}
				const title = typeof params.title === "string" ? params.title.trim() : "";
				const scripts = params.scripts === true;
				return {
					content: [
						{
							type: "text" as const,
							text: title ? `已嵌入界面：${title}` : "已嵌入 HTML 界面",
						},
					],
					details: {
						rpHtml: {
							html,
							...(title ? { title } : {}),
							scripts,
						},
					},
				};
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "panel_write",
			label: "更新侧栏",
			description: "Write/update a side panel (markdown|svg|html).",
			parameters: Type.Object({
				name: Type.String(),
				kind: Type.String({ description: "markdown|svg|html" }),
				content: Type.String(),
			}),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				if (!(PANEL_KINDS as readonly string[]).includes(params.kind)) {
					return text(`kind 须为 ${PANEL_KINDS.join("|")}`, true);
				}
				const sid = ctx.sessionManager.getSessionId();
				const file = panelsFile(ctx.cwd, sid);
				const panels = loadPanels(file);
				const r = writePanel(panels, {
					name: params.name,
					kind: params.kind,
					content: params.content,
				});
				if (!r.ok) return text(r.error, true);
				savePanels(file, r.panels);
				return text(`已更新面板「${params.name}」`);
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "panel_read",
			label: "查看侧栏",
			description: "List or read side panels.",
			parameters: Type.Object({
				name: Type.Optional(Type.String()),
			}),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const sid = ctx.sessionManager.getSessionId();
				const map = loadPanels(panelsFile(ctx.cwd, sid));
				const panels = activePanels(map);
				if (params.name) {
					const p = panels.find((x) => x.name === params.name);
					if (!p) return text(`无面板：${params.name}`, true);
					return text(`# ${p.name} (${p.kind})\n${p.content}`);
				}
				const idx = formatPanelIndex(map);
				return text(idx || "（无活跃面板）");
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "panel_close",
			label: "收起侧栏",
			description: "Close/archive a side panel by name.",
			parameters: Type.Object({ name: Type.String() }),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const sid = ctx.sessionManager.getSessionId();
				const file = panelsFile(ctx.cwd, sid);
				const panels = loadPanels(file);
				const r = closePanel(panels, params.name);
				if (!r.ok) return text(r.error, true);
				savePanels(file, r.panels);
				return text(`已收起面板「${params.name}」`);
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "ask_director",
			label: "请你定夺",
			description:
				"Present in-story choices and wait for the user. Ask mode: call every turn after narrative (3–4 options). Silent mode: never call—tool rejects all calls. Parser accepts any option count ≥2.",
			parameters: Type.Object({
				question: Type.String({ description: "抉择题干（场景内口吻；多开局可用「请选定要进入的开局」）" }),
				options: Type.String({
					description: "选项正文，【甲】…【乙】… 或换行/| 分隔；默认 3~4 条，解析器无上限",
				}),
			}),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const config = loadConfig(ctx.cwd);
				const mode = config.creationMode ?? "ask";
				if (mode === "silent") {
					// 静默档是硬门禁：任何模型误调用都不能产生选择卡。
					return text(
						"当前为静默档（silent）：不弹出选择卡。请继续自行推进叙事；用户求方向时用正文简短承接即可。",
						true,
					);
				}
				const raw = String(params.options ?? "");
				let opts = raw
					.split(/【/)
					.map((s) => s.trim())
					.filter(Boolean)
					.map((s) => (s.startsWith("【") ? s : `【${s}`).replace(/】】+$/, "】"));
				if (opts.length < 2) {
					opts = raw
						.split(/\n+/)
						.map((s) => s.trim())
						.filter(Boolean);
				}
				// A. / A、 / 1. 列表：兼容同一行编号，并统一移除展示编号。
				if (opts.length < 2) {
					const lettered = [
						...raw.matchAll(/(?:^|\n|\s{2,})([A-Za-z]|[1-9]\d*)[.、．)\]]\s*([\s\S]*?)(?=(?:\s{2,}|\n)(?:[A-Za-z]|[1-9]\d*)[.、．)\]]\s+|$)/g),
					].map((m) =>
						m[2].trim(),
					);
					if (lettered.length >= 2) opts = lettered;
				}
				// | 分隔
				if (opts.length < 2 && raw.includes("|")) {
					opts = raw
						.split("|")
						.map((s) => s.trim())
						.filter(Boolean);
				}
				opts = opts
					.map((s) => s.replace(/^(?:选项\s*)?(?:[A-Za-z]|[1-9]\d*)[.、．)\]]\s*/i, "").trim())
					.filter(Boolean);
				if (opts.length < 2) return text("至少需要 2 个选项", true);
				const picked = await ctx.ui.select(params.question, opts);
				if (picked == null) return terminateText("用户取消了抉择");
				const pickedValue = picked.value;
				// LLM 标记驱动：区分「点击选项」与「自由输入」，避免自由输入被当作选项选择误判走向
				const pickedLabel = picked.via === "free" ? "用户自由发言" : "用户选择";
				return text(`${pickedLabel}：${pickedValue}`);
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "world_time",
			label: "世界时间",
			description: "Fetch real-world current time for direct time/date/timezone questions. smart_search manages its own cached time anchor.",
			parameters: Type.Object({
				city: Type.Optional(Type.String({ description: "IANA timezone, default Asia/Shanghai" })),
			}),
			async execute(_id, params, signal, _onUpdate, _ctx) {
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
	);

	pi.registerTool(
		defineTool({
			name: "smart_search",
			label: "联网搜索",
			description:
				"Tavily web search with cached time anchoring, bilingual query expansion, deduplication, and single/multi-route ranking. Needs API key in Settings → Advanced.",
			parameters: Type.Object({
				query: Type.String(),
				topic: Type.Optional(
					Type.Union([Type.Literal("general"), Type.Literal("news"), Type.Literal("finance")]),
				),
				time_range: Type.Optional(Type.String()),
				limit: Type.Optional(Type.Number()),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				try {
					const config = loadConfig(ctx.cwd);
					const data = await runSmartSearch(
						config.smartSearch,
						{
							query: params.query,
							...(params.topic ? { topic: params.topic } : {}),
							...(params.time_range ? { time_range: params.time_range } : {}),
							...(params.limit ? { limit: params.limit } : {}),
						},
						signal,
					);
					return text(formatSearchPlain(data));
				} catch (err) {
					return text(err instanceof Error ? err.message : String(err), true);
				}
			},
		}),
	);

	// 避免未使用变量告警（调试可看 lastCard*）
	void lastCardPath;
	void lastCardName;
}
