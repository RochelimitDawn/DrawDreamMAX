/**
 * REST 宿主工厂：RestHost 实现（pi 类型止步于此文件的 deps 侧）。
 */

import { appendFileSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { getAgentDir, SessionManager } from "@drawdream/agent-runtime/web";

import {
	closePanel as closePanelInMap,
	loadPanels,
	savePanels,
	writePanel,
} from "../src/panels.ts";
import { applyPatch, loadState, saveState } from "../src/state.ts";
import {
	buildAncestryIndex,
	buildWorldlineView,
	extractSaves,
	loadWorldlineMeta,
	metaPath,
	renameWorldline as renameWorldlineMeta,
	saveWorldlineMeta,
	softDeleteSave,
	type TreeEntryLite,
} from "../src/worldline.ts";
import {
	loadTtsConfig,
	saveAudioBuffer,
	synthesizeSpeech,
	ttsConfigHint,
} from "../src/tts.ts";

import type { CurrentModelInfo, RestHost, SessionInfoLite, SessionSearchHit } from "./rest/types.ts";
import { entryMsgText, isSameSessionPath, type CardCache, type PreviewCache } from "./session-files.ts";
import type { ServerFrame } from "./wire.ts";
import { loadConfig } from "./rest/config.ts";
import { loadAgentConfig } from "../src/agent-config.ts";
import { probeThinkingLevels, fallbackThinkingLevels } from "../src/thinking-probe.ts";

/** 角色卡路径归一：反斜杠、前导 ./ */

/** 思考档位主动探测缓存：key = `${provider}::${modelId}` → 探测成功的可用档位。
 * 成功缓存会话期内持久（同一模型不重复探测）；探测失败不写缓存 → 下次选中会重探。 */
const thinkingProbeCache = new Map<string, string[]>();
const probingSet = new Set<string>();

function probeCacheKey(provider: string, id: string): string {
	return `${provider}::${id}`;
}

/** 收集所有渠道里标记为向量模型（kind=embedding/embed/embeddings）的 key 集合，用于从对话模型列表排除。 */
export function collectEmbeddingModelKeys(cwd: string): Set<string> {
	const keys = new Set<string>();
	try {
		const { config } = loadAgentConfig(cwd);
		for (const [p, provider] of Object.entries(config.providers ?? {})) {
			for (const mdl of provider.models ?? []) {
				const kind = typeof mdl.kind === "string" ? mdl.kind.toLowerCase() : "";
				if (kind === "embedding" || kind === "embed" || kind === "embeddings") {
					if (mdl.id) keys.add(`${p}::${mdl.id}`);
				}
			}
		}
	} catch {
		/* 配置不可读时返回空集合（不误过滤） */
	}
	return keys;
}

/**
 * 从 Agent 配置渠道拿 baseUrl/api/apiKey（apiKey 必须为实值，非占位/引用）。
 * 找不到或不可用返回 null（跳过探测，用内置目录兜底）。
 */
function probeTargetFromConfig(
	cwd: string,
	provider: string,
	modelId: string,
): { baseUrl: string; api: string; apiKey: string } | null {
	try {
		const { config } = loadAgentConfig(cwd);
		const p = config.providers?.[provider];
		if (!p) return null;
		const baseUrl = typeof p.baseUrl === "string" ? p.baseUrl.trim().replace(/\/+$/, "") : "";
		const key = typeof p.apiKey === "string" ? p.apiKey.trim() : "";
		if (!baseUrl || !key || key === "placeholder" || key.startsWith("$") || key.startsWith("!")) {
			return null;
		}
		const api = typeof p.api === "string" && p.api ? p.api : "openai-completions";
		return { baseUrl, api, apiKey: key };
	} catch {
		return null;
	}
}

/** 读取模型的内置思考能力数据（若渠道模型条目自带 thinkingLevelMap / reasoning） */
function builtinThinkingMap(sessionModel: { thinkingLevelMap?: unknown; reasoning?: unknown } | null) {
	if (!sessionModel) return null;
	const tlm = sessionModel.thinkingLevelMap;
	if (tlm && typeof tlm === "object" && Object.keys(tlm as Record<string, unknown>).length) {
		return tlm as Record<string, string | null>;
	}
	return null;
}
function normalizeCardRel(p: string): string {
	return p.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

/** 两张卡路径是否指向同一文件 */
function cardsMatch(a: string, b: string): boolean {
	const na = normalizeCardRel(a);
	const nb = normalizeCardRel(b);
	if (!na || !nb) return false;
	if (na === nb) return true;
	// 仅当完整相对路径后缀一致时认为相同（避免不同目录同名误判）
	return na.endsWith(`/${nb}`) || nb.endsWith(`/${na}`);
}

export type RestHostSession = {
	isStreaming: boolean;
	model: {
		provider: string;
		id: string;
		name?: string;
		contextWindow?: number;
		maxTokens?: number;
		input?: string[];
		reasoning?: boolean;
	} | null;
	thinkingLevel: string;
	getAvailableThinkingLevels: () => string[];
	modelRegistry: {
		getAvailable: () => Array<{
			provider: string;
			id: string;
			name?: string;
			reasoning?: boolean;
			input?: string[];
			contextWindow?: number;
			maxTokens?: number;
		}>;
		getAll: () => Array<{
			provider: string;
			id: string;
			name?: string;
			reasoning?: boolean;
			contextWindow?: number;
			maxTokens?: number;
			baseUrl?: string;
			api?: string;
		}>;
		getProviderDisplayName: (provider: string) => string;
		getProviderAuthStatus: (provider: string) => {
			configured: boolean;
			source?: string;
			label?: string;
		};
		authStorage: {
			hasAuth: (provider: string) => boolean;
			set: (provider: string, value: { type: "api_key"; key: string }) => void;
			remove: (provider: string) => void;
		};
		find: (provider: string, id: string) => unknown;
		refresh: () => void;
	};
	setModel: (m: unknown) => Promise<void>;
	setThinkingLevel: (level: never) => void;
	reload: () => Promise<void>;
	prompt: (text: string, opts?: { streamingBehavior?: string }) => Promise<unknown>;
	sessionFile: string | undefined;
	sessionId: string;
	sessionManager: {
		appendSessionInfo: (name: string) => void;
		getBranch: () => Array<{
			type: string;
			customType?: string;
			data?: { mounted?: unknown };
		}>;
		getEntries: () => Array<{
			id: string;
			parentId: string | null;
			type: string;
			customType?: string;
			data?: unknown;
			timestamp?: string;
		}>;
		getLeafId: () => string | null;
		appendMessage: (msg: unknown) => void;
	};
};

export type RestHostDeps = {
	getCwd: () => string;
	getSession: () => RestHostSession;
	/** 切会话 / 新建 */
	switchSession: (path: string) => Promise<unknown>;
	newSession: () => Promise<unknown>;
	broadcast: (frame: ServerFrame) => void;
	resyncAll: () => void;
	refreshNamesFromConfig: () => void;
	/** 换卡/新会话后同步注入开场白（可选） */
	ensureSessionCardAndGreeting?: () => Promise<void>;
	handlePrompt: (text: string) => Promise<void>;
	listSessionsFrame: () => Promise<ServerFrame>;
	sessionInfos: () => Promise<SessionInfoLite[]>;
	assertListedSession: (path: string) => Promise<unknown>;
	cardCache: CardCache;
	previewCache: PreviewCache;
	/** 读会话卡绑定（带缓存） */
	sessionCard: (path: string, mtimeMs: number) => { card: string; name: string } | null;
	stateDir: string;
	artifactsDir: string;
};

export function createRestHost(deps: RestHostDeps): RestHost {
	const currentModelInfo = (): CurrentModelInfo | null => {
		const session = deps.getSession();
		const m = session.model;
		// Agent 内核默认 unknown 占位：对 UI 视为「未选模型」
		if (!m || m.provider === "unknown" || m.id === "unknown") return null;
		const sessionLevels = session.getAvailableThinkingLevels();
		const cached = thinkingProbeCache.get(probeCacheKey(m.provider, m.id));
		const availableLevels =
			cached && cached.length
				? cached
				: sessionLevels.length
					? sessionLevels
					: fallbackThinkingLevels({ reasoning: m.reasoning, thinkingLevelMap: builtinThinkingMap(m) });
		return {
			provider: m.provider,
			id: m.id,
			name: m.name || m.id,
			thinkingLevel: session.thinkingLevel,
			availableLevels,
			contextWindow: m.contextWindow ?? 0,
			maxTokens: typeof m.maxTokens === "number" && m.maxTokens > 0 ? m.maxTokens : undefined,
		};
	};

	/**
	 * 对指定模型执行思考档位探测（同步等待真实探测完成）：
	 * - 命中缓存直接返回（成功缓存会话期内持久）
	 * - 渠道无实值 Key → reason "no-config"
	 * - 探测失败 → reason "probe-fail"
	 * 成功后写入缓存并返回可用档位；调用方决定是否应用最低档。
	 */
	const runThinkingProbe = async (provider: string, id: string): Promise<{ levels: string[]; reason: string }> => {
		const session = deps.getSession();
		const m = session.modelRegistry.find(provider, id) as
			| { reasoning?: boolean; thinkingLevelMap?: unknown }
			| null;
		if (!m) return { levels: [], reason: "no-model" };
		const cacheKey = probeCacheKey(provider, id);
		const cached = thinkingProbeCache.get(cacheKey);
		if (cached && cached.length) return { levels: cached, reason: "cache" };
		const target = probeTargetFromConfig(deps.getCwd(), provider, id);
		if (!target) return { levels: [], reason: "no-config" };
		const map = builtinThinkingMap(m);
		const levels = map ? Object.keys(map) : (["off", "low", "medium", "high"] as const);
		const r = await probeThinkingLevels({ ...target, modelId: id }, levels);
		if (r.reason === "probe" && r.accepted.length) {
			thinkingProbeCache.set(cacheKey, r.accepted);
			// 把探测结果写回模型对象能力：内核 session.setThinkingLevel 的档位 clamp
			// 依据 getSupportedThinkingLevels(model)（model.reasoning + thinkingLevelMap），
			// 不写回的话未标记 reasoning 的自定义渠道（如 tokenrhythm）会把档位 clamp 回 off。
			const modelEntry = session.modelRegistry.find(provider, id) as
				| { reasoning?: boolean; thinkingLevelMap?: Record<string, string | null> }
				| null;
			if (modelEntry) {
				modelEntry.reasoning = true;
				// getSupportedThinkingLevels 过滤规则：
				// - 非 xhigh 档位 mapped === null 才排除（因此不支持的档位必须显式设 null）
				// - xhigh 档位 mapped !== undefined 才保留（因此不支持时不要设置该键）
				const map: Record<string, string | null> = {};
				for (const lvl of ["off", "minimal", "low", "medium", "high"]) {
					map[lvl] = r.accepted.includes(lvl) ? (lvl === "off" ? "none" : lvl) : null;
				}
				modelEntry.thinkingLevelMap = map;
			}
			return { levels: r.accepted, reason: "probe" };
		}
		return { levels: [], reason: "probe-fail" };
	};

	/** 应用最低可用档位（排除 off；无则第一档），仅当目标仍是当前模型时生效 */
	const applyLowestThinkingLevel = (provider: string, id: string, levels: string[]): void => {
		const best = levels.find((l) => l !== "off") ?? levels[0];
		if (!best) return;
		try {
			const s = deps.getSession();
			const cur = s.model;
			if (cur && cur.provider === provider && cur.id === id) {
				s.setThinkingLevel(best as never);
			}
		} catch {
			/* 档位不适配时保持当前 */
		}
	};

	return {
		get cwd() {
			return deps.getCwd();
		},
		isStreaming: () => deps.getSession().isStreaming,
		listModels: () => {
			const session = deps.getSession();
			// 收集 kind=embedding 的向量模型 key（provider::id），从对话模型列表排除
			const embeddingKeys = collectEmbeddingModelKeys(deps.getCwd());
			return {
				current: currentModelInfo(),
				models: session.modelRegistry
					.getAvailable()
					.filter((m) => !embeddingKeys.has(`${m.provider}::${m.id}`))
					.map((m) => ({
						provider: m.provider,
						providerName: session.modelRegistry.getProviderDisplayName(m.provider),
						id: m.id,
						name: m.name || m.id,
						reasoning: m.reasoning === true,
						vision: Array.isArray(m.input) && m.input.includes("image"),
						contextWindow: m.contextWindow ?? 0,
						maxTokens: typeof m.maxTokens === "number" && m.maxTokens > 0 ? m.maxTokens : undefined,
					})),
			};
		},
		async selectModel(provider, id) {
			const session = deps.getSession();
			const m = session.modelRegistry.find(provider, id);
			if (!m) throw new Error(`模型不存在：${provider}/${id}`);
			await session.setModel(m);
			// 主动探测该模型真实支持的思考档位（缓存 + 防并发重入）。
			// 不依赖 reasoning 标志：未标记的模型也尝试探测，由真实端点决定（命中缓存/无 Key 时零成本）。
			const cacheKey = probeCacheKey(provider, id);
			const cached = thinkingProbeCache.get(cacheKey);
			if (!cached && !probingSet.has(cacheKey)) {
				probingSet.add(cacheKey);
				void (async () => {
					try {
						const r = await runThinkingProbe(provider, id);
						if (r.reason === "probe" && r.levels.length) {
							// 探测成功即自动应用「最低可用档位」（排除 off），减少 token 消耗，用户仍可手动调高。
							applyLowestThinkingLevel(provider, id, r.levels);
						}
					} finally {
						probingSet.delete(cacheKey);
					}
				})();
			}
			const current = currentModelInfo();
			if (!current) throw new Error("模型切换后状态异常");
			return current;
		},
		async probeThinking(provider, id) {
			const session = deps.getSession();
			const cur = session.model;
			const prov = provider ?? cur?.provider;
			const mid = id ?? cur?.id;
			if (!prov || !mid || prov === "unknown" || mid === "unknown") {
				throw new Error("尚未选择默认模型");
			}
			const m = session.modelRegistry.find(prov, mid) as
				| { reasoning?: boolean; thinkingLevelMap?: unknown }
				| null;
			if (!m) throw new Error(`模型不存在：${prov}/${mid}`);
			// 显式探测：不设 reasoning 前置门槛，对任何模型真实发起探测，
			// 由端点响应的档位接受情况决定是否支持思考。
			const r = await runThinkingProbe(prov, mid);
			if (r.levels.length) {
				applyLowestThinkingLevel(prov, mid, r.levels);
			}
			const current = currentModelInfo();
			if (!current) throw new Error("模型状态异常");
			return { current, levels: r.levels, reason: r.reason };
		},
		setThinkingLevel(level) {
			const session = deps.getSession();
			const lv = level.trim();
			if (!lv) throw new Error("思考档位不能为空");
			session.setThinkingLevel(lv as never);
			const current = currentModelInfo();
			if (!current) throw new Error("会话未就绪");
			return current;
		},
		authProviders() {
			const session = deps.getSession();
			const counts = new Map<string, number>();
			for (const m of session.modelRegistry.getAll()) {
				counts.set(m.provider, (counts.get(m.provider) ?? 0) + 1);
			}
			const currentProvider = session.model?.provider;
			return [...counts.entries()]
				.map(([provider, modelCount]) => {
					const status = session.modelRegistry.getProviderAuthStatus(provider);
					const ready = session.modelRegistry.authStorage.hasAuth(provider);
					return {
						provider,
						displayName: session.modelRegistry.getProviderDisplayName(provider),
						configured: status.configured,
						ready,
						...(ready || status.configured
							? {
									source: status.configured ? status.source : "environment",
									...(status.label ? { label: status.label } : {}),
								}
							: status.source === "environment" && status.label
								? { label: status.label }
								: {}),
						modelCount,
					};
				})
				.sort((a, b) => {
					if (currentProvider) {
						if (a.provider === currentProvider && b.provider !== currentProvider) return -1;
						if (b.provider === currentProvider && a.provider !== currentProvider) return 1;
					}
					return Number(b.ready) - Number(a.ready) || Number(b.configured) - Number(a.configured) || a.displayName.localeCompare(b.displayName);
				});
		},
		setAuthKey(provider, key) {
			deps.getSession().modelRegistry.authStorage.set(provider, { type: "api_key", key });
		},
		removeAuth(provider) {
			deps.getSession().modelRegistry.authStorage.remove(provider);
		},
		agentDir: () => getAgentDir(),
		providerSnapshot(provider) {
			const session = deps.getSession();
			const all = session.modelRegistry.getAll().filter((m) => m.provider === provider);
			if (all.length === 0) return null;
			const sample = all[0];
			const status = session.modelRegistry.getProviderAuthStatus(provider);
			const envKey =
				status.source === "environment" && status.label
					? status.label
					: provider === "deepseek"
						? "DEEPSEEK_API_KEY"
						: undefined;
			return {
				provider,
				baseUrl: typeof sample.baseUrl === "string" ? sample.baseUrl : undefined,
				api: typeof sample.api === "string" ? sample.api : undefined,
				envKey,
				models: all.map((m) => ({
					id: m.id,
					name: m.name || m.id,
					reasoning: m.reasoning === true,
					contextWindow: m.contextWindow ?? undefined,
					maxTokens: m.maxTokens,
				})),
			};
		},
		refreshModels: () => deps.getSession().modelRegistry.refresh(),
		async reloadSession() {
			await deps.getSession().reload();
			deps.refreshNamesFromConfig();
			deps.resyncAll();
		},
		async softRefreshConfig() {
			// 热更新：走 session.reload（重放 session_start / before_agent_start），
			// 禁止 prompt("/rprefresh")——扩展未注册时会被当成用户消息发给模型，触发「Refresh」循环生成。
			const session = deps.getSession();
			const run = async () => {
				await session.reload();
				deps.refreshNamesFromConfig();
				if (typeof deps.ensureSessionCardAndGreeting === "function") {
					await deps.ensureSessionCardAndGreeting();
				} else {
					deps.resyncAll();
				}
			};
			if (session.isStreaming) {
				void session.agent
					.waitForIdle()
					.then(run)
					.catch((err: unknown) => {
						deps.broadcast({
							type: "notify",
							level: "error",
							text: err instanceof Error ? err.message : String(err),
						});
					});
				return;
			}
			await run();
		},
		async switchToCard() {
			// 换卡：必须打开「当前 config.card」绑定的会话，禁止误开任意非当前会话
			// （旧实现 list.find(!current) 会把顶栏刷成新卡、正文仍是旧卡历史）
			deps.refreshNamesFromConfig();
			const cwd = deps.getCwd();
			let wantCard = "";
			try {
				wantCard = (loadConfig(cwd).card ?? "").trim();
			} catch {
				wantCard = "";
			}
			const want = normalizeCardRel(wantCard);
			const list = await deps.sessionInfos();

			const resolveBoundPath = (s: SessionInfoLite): string => {
				const direct = (s.cardPath ?? "").trim();
				if (direct) return normalizeCardRel(direct);
				if (!s.path) return "";
				try {
					const info = deps.sessionCard(s.path, s.modified || 0);
					return info?.card ? normalizeCardRel(info.card) : "";
				} catch {
					return "";
				}
			};

			// list 已按 modified 倒序：取该卡最近一条
			let target: SessionInfoLite | undefined;
			if (want) {
				target = list.find((s) => {
					const bound = resolveBoundPath(s);
					return !!bound && cardsMatch(bound, want);
				});
			}

			let result: "switched" | "created" = "created";
			if (target?.path) {
				const curFile = deps.getSession().sessionFile || "";
				if (target.current || isSameSessionPath(target.path, curFile)) {
					// 已在该卡会话：不切路径，仍 reload + 补开场
					result = "switched";
				} else {
					await deps.switchSession(target.path);
					result = "switched";
				}
			} else {
				// 该卡无历史会话 → 新建（ensure 会写 rp-card + 开场白）
				await deps.newSession();
				result = "created";
			}

			// 换卡后必须 reload 扩展，否则 system prompt / rp-card 仍可能是旧卡或空卡
			try {
				await deps.getSession().reload();
				deps.refreshNamesFromConfig();
			} catch {
				/* reload 失败不挡切卡结果 */
			}
			// 同步注入开场白后再 resync（扩展 sendMessage 异步会抢跑空历史）
			if (typeof deps.ensureSessionCardAndGreeting === "function") {
				await deps.ensureSessionCardAndGreeting();
			} else {
				deps.resyncAll();
			}
			return result;
		},
		promptCommand: (text) => deps.handlePrompt(text),
		async importStChat(content, tag) {
			const { adaptSillyTavernChat } = await import("../src/compat/data-adapter.ts");
			const { buildImportBlock } = await import("../src/chatlog.ts");
			const adapted = adaptSillyTavernChat(content, tag ? { extractTag: tag } : undefined);
			const { meta, messages: cleaned } = adapted;
			if (cleaned.length === 0) throw new Error("聊天记录没有可导入的正文消息");
			const importText = buildImportBlock({
				summary: "",
				recentTurns: cleaned.slice(-40),
				charName: meta.charName,
				userName: meta.userName,
			});
			deps.getSession().sessionManager.appendMessage({
				role: "custom",
				customType: "rp-import",
				content: importText,
				display: true,
				details: {
					rpImport: {
						source: "sillytavern-chat-jsonl",
						userName: meta.userName,
						charName: meta.charName,
						createDate: meta.createDate,
						messageCount: adapted.messages.length,
						cleanedCount: cleaned.length,
						sourceMessages: cleaned.map((message) => message.source).filter(Boolean),
					},
				},
				timestamp: Date.now(),
			} as never);
			deps.resyncAll();
			deps.broadcast({ type: "notify", level: "info", text: `已导入酒馆聊天记录（${cleaned.length} 条正文）` });
			return {
				messages: cleaned.length,
				warnings: adapted.messages.length === cleaned.length ? [] : ["部分消息清洗后为空，未写入正文"],
			};
		},
		queueCommand(text) {
			const queued = deps.getSession().isStreaming;
			void deps.handlePrompt(text).catch((err) => {
				deps.broadcast({ type: "error", text: err instanceof Error ? err.message : String(err) });
			});
			return queued;
		},
		importPanels(list) {
			const session = deps.getSession();
			const file = join(deps.artifactsDir, `${session.sessionId}.json`);
			let panels = loadPanels(file);
			let imported = 0;
			const names: string[] = [];
			const errors: string[] = [];
			for (const item of list) {
				const name = String(item?.name ?? "");
				const r = writePanel(panels, {
					name,
					kind: String(item?.kind ?? ""),
					content: String(item?.content ?? ""),
				});
				if (r.ok) {
					panels = r.panels;
					imported++;
					names.push(name.trim());
				} else {
					errors.push(`「${name || "?"}」：${r.error}`);
				}
			}
			if (imported > 0) {
				savePanels(file, panels);
				void deps.handlePrompt("/panelsync").catch((err) => {
					deps.broadcast({ type: "error", text: err instanceof Error ? err.message : String(err) });
				});
			}
			return { imported, names, errors };
		},
		closePanel(name) {
			const session = deps.getSession();
			const file = join(deps.artifactsDir, `${session.sessionId}.json`);
			const panels = loadPanels(file);
			const r = closePanelInMap(panels, name);
			if (!r.ok) throw new Error(r.error);
			savePanels(file, r.panels);
			void deps.handlePrompt("/panelsync").catch((err) => {
				deps.broadcast({ type: "error", text: err instanceof Error ? err.message : String(err) });
			});
		},
		mountedCodexes() {
			try {
				const branch = deps.getSession().sessionManager.getBranch();
				for (let i = branch.length - 1; i >= 0; i--) {
					const e = branch[i];
					if (e.type === "custom" && e.customType === "rp-codex") {
						const mounted = e.data?.mounted;
						return Array.isArray(mounted) ? mounted.filter((n): n is string => typeof n === "string") : [];
					}
				}
			} catch {
				// 树读取失败按无挂载处理
			}
			return [];
		},
		applyStatePatch(patch) {
			const session = deps.getSession();
			const file = join(deps.stateDir, `${session.sessionId}.json`);
			const r = applyPatch(loadState(file), patch);
			saveState(file, r.state);
			void deps.handlePrompt("/statesync").catch((err) => {
				deps.broadcast({ type: "error", text: err instanceof Error ? err.message : String(err) });
			});
			return { applied: r.applied, warnings: r.warnings };
		},
		worldlineView() {
			const session = deps.getSession();
			const sm = session.sessionManager;
			const sid = session.sessionId;
			const cwd = deps.getCwd();
			const meta = loadWorldlineMeta(metaPath(cwd, sid));
			const entries: TreeEntryLite[] = sm.getEntries().map((e) => ({
				id: e.id,
				parentId: e.parentId,
				type: e.type,
				...(typeof e.customType === "string" ? { customType: e.customType } : {}),
				...(e.data !== undefined ? { data: e.data } : {}),
				...(typeof e.timestamp === "string" ? { timestamp: e.timestamp } : {}),
			}));
			const saves = extractSaves(entries, meta);
			const leafId = sm.getLeafId();
			const { branchIdsFromLeaf } = buildAncestryIndex(entries);
			return buildWorldlineView(saves, meta, branchIdsFromLeaf(leafId), leafId);
		},
		deleteWorldlineSave(saveId) {
			const session = deps.getSession();
			const file = metaPath(deps.getCwd(), session.sessionId);
			const meta = softDeleteSave(loadWorldlineMeta(file), saveId);
			saveWorldlineMeta(file, meta);
		},
		renameWorldline(worldlineId, name) {
			const session = deps.getSession();
			const file = metaPath(deps.getCwd(), session.sessionId);
			const meta = renameWorldlineMeta(loadWorldlineMeta(file), worldlineId, name);
			saveWorldlineMeta(file, meta);
			deps.broadcast({ type: "notify", level: "info", text: `世界线已改名「${name.trim()}」` });
		},
		sessions: () => deps.sessionInfos(),
		async renameSession(path, name) {
			await deps.assertListedSession(path);
			const session = deps.getSession();
			const clean = name.replace(/[\r\n]+/g, " ").trim();
			if (!clean) throw new Error("名字不能为空");
			if (session.sessionFile === path) {
				session.sessionManager.appendSessionInfo(clean);
				return;
			}
			const lines = readFileSync(path, "utf8").split(/\r?\n/);
			let parentId: string | null = null;
			for (let i = lines.length - 1; i >= 0; i--) {
				const line = lines[i].trim();
				if (!line) continue;
				try {
					const e = JSON.parse(line) as { id?: unknown };
					if (typeof e.id === "string") {
						parentId = e.id;
						break;
					}
				} catch {
					// 半行跳过
				}
			}
			const entry = {
				type: "session_info",
				id: randomBytes(4).toString("hex"),
				parentId,
				timestamp: new Date().toISOString(),
				name: clean,
			};
			appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
		},
		async deleteSession(path) {
			await deps.assertListedSession(path);
			const session = deps.getSession();
			if (session.sessionFile === path) throw new Error("不能删除当前打开的会话（先切到其他会话再删）");
			unlinkSync(path);
			deps.cardCache.delete(path);
			deps.previewCache.delete(path);
		},
		async deleteCardSessions(cardRel) {
			const session = deps.getSession();
			const cwd = deps.getCwd();
			const all = await SessionManager.list(cwd);
			let n = 0;
			for (const s of all) {
				if (isSameSessionPath(s.path, session.sessionFile)) continue;
				const mtime = s.modified instanceof Date ? s.modified.getTime() : Number(s.modified) || 0;
				const info = deps.sessionCard(s.path, mtime);
				if (!info || info.card !== cardRel) continue;
				try {
					unlinkSync(s.path);
					deps.cardCache.delete(s.path);
					deps.previewCache.delete(s.path);
					n += 1;
				} catch {
					// 单个文件删不掉不挡整体
				}
			}
			if (n > 0) deps.broadcast(await deps.listSessionsFrame());
			return n;
		},
		async readSessionFile(path) {
			await deps.assertListedSession(path);
			return readFileSync(path, "utf8");
		},
		async searchSessions(q) {
			const needle = q.trim().toLowerCase();
			if (!needle) return [];
			const out: SessionSearchHit[] = [];
			for (const s of await deps.sessionInfos()) {
				try {
					if (statSync(s.path).size > 20 * 1024 * 1024) continue;
					let snippet = "";
					for (const line of readFileSync(s.path, "utf8").split(/\r?\n/)) {
						if (!line.toLowerCase().includes(needle)) continue;
						try {
							const t = entryMsgText(JSON.parse(line));
							if (!t) continue;
							const flat = t.replace(/\s+/g, " ");
							const idx = flat.toLowerCase().indexOf(needle);
							if (idx < 0) continue;
							const start = Math.max(0, idx - 40);
							snippet = `${start > 0 ? "…" : ""}${flat.slice(start, idx + needle.length + 60)}…`;
							break;
						} catch {
							// 非 JSON 行跳过
						}
					}
					if (snippet) {
						out.push({
							path: s.path,
							...(s.name ? { name: s.name } : {}),
							firstMessage: s.firstMessage,
							modified: s.modified,
							messageCount: s.messageCount,
							snippet,
							current: s.current,
						});
					}
					if (out.length >= 20) break;
				} catch {
					// 单个会话读取失败不影响其余
				}
			}
			return out;
		},
		notify: (level, text) => deps.broadcast({ type: "notify", level, text }),
		broadcastFrame: (frame) => deps.broadcast(frame),
		async ttsSpeak(text, caption) {
			const session = deps.getSession();
			const cwd = deps.getCwd();
			const cfg = loadTtsConfig();
			if (!cfg) throw new Error(ttsConfigHint());
			const { buffer, ext } = await synthesizeSpeech(cfg, text);
			const saved = saveAudioBuffer(cwd, buffer, ext);
			const cap = (caption ?? text).trim().slice(0, 80);
			session.sessionManager.appendMessage({
				role: "custom",
				customType: "rp-audio",
				content: cap ? `〔配音〕${cap}` : "〔配音〕",
				display: true,
				details: { rpAudio: { src: saved.src, ...(cap ? { caption: cap } : {}) } },
				timestamp: Date.now(),
			} as never);
			const wireMsg = {
				channel: "audio" as const,
				text: cap,
				src: saved.src,
			};
			deps.broadcast({ type: "message", message: wireMsg });
			return { src: saved.src, bytes: saved.bytes };
		},
	};
}
