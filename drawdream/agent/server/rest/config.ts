/**
 * DrawDream REST 配置/预设/世界书/卡库 领域读写（无 HTTP 路由）。
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
	agentConfigPath,
	loadAgentConfig,
	materializeEnvKeysInConfig,
	migrateActiveConfigIntoProfiles,
	normalizeAgentConfig,
	saveAgentConfig,
	seedProviderFromRuntime,
	syncAgentConfigToRuntime,
	type DrawdreamAgentConfig,
} from "../../src/agent-config.ts";
import { loadCardFile } from "../../src/card.ts";
import { resolveConfigPath } from "../../src/paths.ts";
import {
	applyDisabledLore,
	loadLorebookFile,
	mergeEntries,
	mountedLorebookPaths,
	normalizeEntries,
	overlayPathFor,
	setMountedLorebooks,
} from "../../src/lorebook.ts";
import type { Persona } from "../../src/personas.ts";
import { normalizeRpPreset, type RpPreset } from "../../src/preset.ts";
import { DEFAULT_CONFIG, type LorebookEntry, type RpConfig } from "../../src/types.ts";
import { readJsonFile } from "../../src/jsonio.ts";
import type { RestHost } from "./types.ts";
import { resolvePath } from "./http.ts";

export function sanitizeSamplers(input: Record<string, number> | undefined): Record<string, number> | undefined {
	if (!input || typeof input !== "object") return undefined;
	const out: Record<string, number> = {};
	for (const [key, value] of Object.entries(input)) {
		if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
	}
	return out;
}

export function writeJsonWithBackup(path: string, data: unknown): void {
	if (existsSync(path)) copyFileSync(path, `${path}.bak`);
	writeFileSync(path, JSON.stringify(data, null, "\t") + "\n", "utf8");
}

// ---------- 配置读写 ----------

export const configPath = (cwd: string) => resolveConfigPath(cwd);

export function loadConfig(cwd: string): RpConfig {
	const p = configPath(cwd);
	if (!existsSync(p)) return { ...DEFAULT_CONFIG };
	const raw = { ...DEFAULT_CONFIG, ...(JSON.parse(readFileSync(p, "utf8")) as Partial<RpConfig>) };
	// 子拓展：读时合并默认值（避免只配 enabled 时丢 maxConcurrent）
	if (raw.subagents === undefined) {
		raw.subagents = { ...DEFAULT_CONFIG.subagents };
	} else if (raw.subagents && typeof raw.subagents === "object") {
		raw.subagents = {
			enabled: raw.subagents.enabled !== false,
			maxConcurrent: clampInt(raw.subagents.maxConcurrent, 1, 8, 2),
		};
	}
	// 规范化：旧 lorebook 单本 → lorebooks 数组
	return setMountedLorebooks(raw, mountedLorebookPaths(raw));
}

/** config PUT 白名单（card 不在内：换卡必须走 /api/card/switch 的完整流程） */
const CONFIG_EDITABLE = new Set([
	"userName",
	"userPersona",
	"displayName",
	"language",
	"scanDepth",
	"maxLoreInjections",
	"greeting",
	"greetingIndex",
	"importStripTags",
	"lorebook",
	"lorebooks",
	"preset",
	"disabledLore",
	"backendControl",
	"creationMode",
	"narrativeLength",
	"assistantModel",
	"pipeline",
	"smartSearch",
	"subagents",
]);

export function applyConfigPatch(config: RpConfig, patch: Record<string, unknown>): RpConfig {
	const next = { ...config } as Record<string, unknown>;
	for (const [k, v] of Object.entries(patch)) {
		if (!CONFIG_EDITABLE.has(k)) continue;
		if (v === null || v === undefined || v === "") {
			delete next[k]; // 空值 = 删除可选键（displayName/lorebook/preset 等）
		} else {
			next[k] = v;
		}
	}
	// 必填字段兜底
	if (typeof next.userName !== "string" || !next.userName) next.userName = DEFAULT_CONFIG.userName;
	if (typeof next.language !== "string" || !next.language) next.language = DEFAULT_CONFIG.language;
	next.scanDepth = clampInt(next.scanDepth, 1, 50, DEFAULT_CONFIG.scanDepth);
	next.maxLoreInjections = clampInt(next.maxLoreInjections, 0, 20, DEFAULT_CONFIG.maxLoreInjections);
	next.greeting = next.greeting === true;
	// 决策门禁档位：只认 ask / silent；非法值回落默认 ask
	if (next.creationMode !== "ask" && next.creationMode !== "silent") {
		next.creationMode = DEFAULT_CONFIG.creationMode ?? "ask";
	}
	// 叙事字数目标：{ min?, max?, hardCap? }
	if (next.narrativeLength !== undefined) {
		const nl = next.narrativeLength as { min?: unknown; max?: unknown; hardCap?: unknown } | null;
		if (!nl || typeof nl !== "object") {
			delete next.narrativeLength;
		} else {
			const min = clampInt(nl.min, 50, 5000, DEFAULT_CONFIG.narrativeLength?.min ?? 400);
			const max = clampInt(nl.max, min, 8000, Math.max(min, DEFAULT_CONFIG.narrativeLength?.max ?? 900));
			const hardCap = nl.hardCap !== false;
			next.narrativeLength = { min, max, hardCap };
		}
	}
	// 助手模型：只认 { provider, id } 形；非法值删除（缺省=跟随剧情模型）
	if (next.assistantModel !== undefined) {
		const am = next.assistantModel as { provider?: unknown; id?: unknown } | null;
		if (
			!am ||
			typeof am !== "object" ||
			typeof am.provider !== "string" ||
			!am.provider ||
			typeof am.id !== "string" ||
			!am.id
		) {
			delete next.assistantModel;
		} else {
			next.assistantModel = { provider: am.provider, id: am.id };
		}
	}
	// 叙事流水线：只认 { mode?, maxSummaries? }
	if (next.pipeline !== undefined) {
		const p = next.pipeline as { mode?: unknown; maxSummaries?: unknown } | null;
		if (!p || typeof p !== "object") {
			delete next.pipeline;
		} else {
			const mode = p.mode === "off" || p.mode === "merged" || p.mode === "full" ? p.mode : "merged";
			const maxSummaries = clampInt(p.maxSummaries, 5, 200, 40);
			next.pipeline = { mode, maxSummaries };
		}
	}
	// 智能搜索（Tavily）：{ enabled?, apiKey?, baseUrl?, searchDepth?, topic?, mode?, maxQueries? }
	// 简报/配图已永久关闭，不再读写 includeAnswer / includeImages
	// 未传 apiKey 时保留磁盘上已有密钥，避免「仅改开关/深度」或导入备份时把 Key 清掉
	if (next.smartSearch !== undefined) {
		const s = next.smartSearch as {
			enabled?: unknown;
			apiKey?: unknown;
			baseUrl?: unknown;
			searchDepth?: unknown;
			topic?: unknown;
			mode?: unknown;
			maxQueries?: unknown;
		} | null;
		const prev =
			config.smartSearch && typeof config.smartSearch === "object"
				? config.smartSearch
				: undefined;
		if (!s || typeof s !== "object") {
			delete next.smartSearch;
		} else {
			const enabled = s.enabled !== false;
			const apiKeyFromPatch = typeof s.apiKey === "string" ? s.apiKey.trim() : "";
			const apiKey = apiKeyFromPatch || (typeof prev?.apiKey === "string" ? prev.apiKey.trim() : "");
			const baseUrlFromPatch = typeof s.baseUrl === "string" ? s.baseUrl.trim() : "";
			const baseUrl =
				baseUrlFromPatch ||
				(typeof prev?.baseUrl === "string" ? prev.baseUrl.trim() : "");
			const sd = s.searchDepth ?? prev?.searchDepth;
			const searchDepth =
				sd === "advanced" || sd === "fast" || sd === "ultra-fast" || sd === "basic" ? sd : "basic";
			const topicRaw = s.topic ?? prev?.topic;
			const topic = topicRaw === "news" || topicRaw === "finance" ? topicRaw : "general";
			const mode = (s.mode ?? prev?.mode) === "multi" ? "multi" : "simple";
			const maxQueries = clampInt(
				s.maxQueries ?? prev?.maxQueries,
				1,
				4,
				3,
			);
			const out: {
				enabled: boolean;
				apiKey?: string;
				baseUrl?: string;
				searchDepth: "basic" | "advanced" | "fast" | "ultra-fast";
				topic: "general" | "news" | "finance";
				mode: "simple" | "multi";
				maxQueries: number;
			} = { enabled, searchDepth, topic, mode, maxQueries };
			if (apiKey) out.apiKey = apiKey;
			if (baseUrl) out.baseUrl = baseUrl;
			next.smartSearch = out;
		}
	}
	// 子拓展：{ enabled?, maxConcurrent? }；非法值回落默认
	if (next.subagents !== undefined) {
		const s = next.subagents as { enabled?: unknown; maxConcurrent?: unknown } | null;
		if (!s || typeof s !== "object") {
			delete next.subagents;
		} else {
			const enabled = s.enabled !== false;
			const maxConcurrent = clampInt(s.maxConcurrent, 1, 8, 2);
			next.subagents = { enabled, maxConcurrent };
		}
	}
	// 挂载书：lorebooks 数组优先；兼容旧单本 lorebook
	const paths = mountedLorebookPaths(next as RpConfig);
	Object.assign(next, setMountedLorebooks(next as RpConfig, paths));
	return next as unknown as RpConfig;
}

export function clampInt(v: unknown, min: number, max: number, dflt: number): number {
	const n = typeof v === "number" ? Math.round(v) : Number.parseInt(String(v), 10);
	if (!Number.isFinite(n)) return dflt;
	return Math.min(max, Math.max(min, n));
}

// ---------- 世界书（服务端只读副本，与扩展同一装配路径） ----------

export type LoreSource = "card" | "file" | "agent";

/**
 * 世界书装配：已挂载独立书（0..N 本）+ agent 补充设定集。
 * 卡内 character_book **不**自动进上下文——须导入为独立书并挂载（config.lorebooks）。
 * 角色卡与世界书解耦：换卡不改挂载列表。
 * source：file=挂载书 / agent=补充设定。
 */
export function loadMergedLoreWithSource(
	cwd: string,
	config: RpConfig,
): {
	entries: LorebookEntry[];
	sourceOf: (e: LorebookEntry) => LoreSource;
	cardName: string;
	paths: string[];
} {
	const card = loadCardFile(resolvePath(cwd, config.card));
	const paths = mountedLorebookPaths(config);
	const fileGroups: LorebookEntry[][] = [];
	for (const rel of paths) {
		const abs = resolvePath(cwd, rel);
		if (existsSync(abs)) fileGroups.push(loadLorebookFile(abs));
	}
	const fileEntries = mergeEntries(...fileGroups);
	const overlayPath = overlayPathFor(cwd, card.name);
	const overlayEntries = existsSync(overlayPath) ? loadLorebookFile(overlayPath) : [];
	const fileSet = new Set(fileEntries.map((e) => e.content.trim()));
	const entries = applyDisabledLore(mergeEntries(fileEntries, overlayEntries), config.disabledLore);
	const sourceOf = (e: LorebookEntry): LoreSource => (fileSet.has(e.content.trim()) ? "file" : "agent");
	return { entries, sourceOf, cardName: card.name, paths };
}

export function loadMergedLore(cwd: string, config: RpConfig): LorebookEntry[] {
	return loadMergedLoreWithSource(cwd, config).entries;
}

/**
 * 导出用活跃世界书：挂载书 + 补充设定 + 卡原内嵌（指纹去重）+ 用户停用清单。
 * 即「改过角色卡/世界书之后」的创作态，便于分享回 ST / 再导入 DrawDream。
 */
export function collectActiveLoreForExport(cwd: string, config: RpConfig): LorebookEntry[] {
	const card = loadCardFile(resolvePath(cwd, config.card));
	const { entries: active } = loadMergedLoreWithSource(cwd, config);
	return applyDisabledLore(mergeEntries(active, card.book), config.disabledLore);
}

export const previewText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

// ---------- 卡库（PLAN-PANELS §2.7）：扫描候选目录，卡头信息按 mtime 缓存 ----------

const cardMetaCache = new Map<string, { mtimeMs: number; meta: { name: string; tags: string[] } | null }>();

/** 删除/覆盖卡文件后失效 mtime 缓存；不传 path 则清空全部 */
export function invalidateCardMetaCache(absPath?: string): void {
	if (absPath) cardMetaCache.delete(absPath);
	else cardMetaCache.clear();
}

/** 卡库扫描目录：assets/cards + 当前卡所在目录（用户素材常在项目外） */
export function cardDirSpecs(cwd: string, config: RpConfig): Array<{ abs: string; relBase: string }> {
	const specs = [{ abs: join(cwd, "assets", "cards"), relBase: "assets/cards" }];
	const cardRel = config.card.replace(/\\/g, "/");
	const base = cardRel.includes("/") ? cardRel.slice(0, cardRel.lastIndexOf("/")) : ".";
	const abs = resolvePath(cwd, base);
	if (!specs.some((s) => s.abs === abs)) specs.push({ abs, relBase: base });
	return specs;
}

export interface CardLibItem {
	path: string;
	name: string;
	tags: string[];
	isPng: boolean;
	mtimeMs: number;
}

export function listCardLibrary(cwd: string, config: RpConfig): CardLibItem[] {
	const out: CardLibItem[] = [];
	for (const spec of cardDirSpecs(cwd, config)) {
		if (!existsSync(spec.abs)) continue;
		for (const f of readdirSync(spec.abs)) {
			if (!/\.(png|json)$/i.test(f)) continue;
			const abs = join(spec.abs, f);
			let mtimeMs = 0;
			try {
				mtimeMs = statSync(abs).mtimeMs;
			} catch {
				continue;
			}
			const cached = cardMetaCache.get(abs);
			let meta = cached && cached.mtimeMs === mtimeMs ? cached.meta : undefined;
			if (meta === undefined) {
				try {
					const c = loadCardFile(abs);
					const derivedName = (() => {
						const raw = (c.name ?? '').trim();
						if (raw) return raw;
						return f.replace(/\.(png|json)$/i, '').replace(/[-_]+/g, ' ').trim();
					})();
					meta = derivedName ? { name: derivedName, tags: c.tags } : null;
				} catch {
					meta = null;
				}
				cardMetaCache.set(abs, { mtimeMs, meta });
			}
			if (!meta) continue;
			out.push({ path: `${spec.relBase}/${f}`, name: meta.name, tags: meta.tags, isPng: /\.png$/i.test(f), mtimeMs });
		}
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}

/** 校验 query 里的卡路径确属卡库（一切卡文件读操作的门），返回绝对路径 */
export function assertLibraryCard(cwd: string, config: RpConfig, relPath: string): string {
	const norm = (relPath || "").replace(/\\/g, "/").trim().replace(/^\.\//, "");
	if (!norm) throw new Error("缺少角色卡路径");
	const lib = listCardLibrary(cwd, config);
	const item =
		lib.find((c) => c.path === norm) ||
		lib.find((c) => c.path.replace(/\\/g, "/") === norm) ||
		lib.find((c) => c.path.endsWith("/" + norm.split("/").pop())) ||
		// 仅文件名
		(norm.includes("/") ? null : lib.find((c) => c.path.endsWith("/" + norm) || c.path === `assets/cards/${norm}`));
	if (!item) {
		// 仍允许库内真实文件（列表缓存 miss / 刚导入）
		const abs = resolvePath(cwd, norm.startsWith("assets/") ? norm : `assets/cards/${basename(norm)}`);
		if (existsSync(abs) && /\.(png|json)$/i.test(abs)) {
			try {
				const c = loadCardFile(abs);
				if (c.name.trim()) return abs;
			} catch {
				/* fallthrough */
			}
		}
		throw new Error(`不是卡库中的角色卡（path=${norm}）`);
	}
	return resolvePath(cwd, item.path);
}

// 卡收藏（借鉴 ST favorites）：独立小文件，不动 drawdream.config（免会话重载）
const favsPath = (cwd: string) => join(cwd, ".drawdream-cache", "card-favs.json");

export function loadFavs(cwd: string): string[] {
	try {
		const j = JSON.parse(readFileSync(favsPath(cwd), "utf8")) as unknown;
		return Array.isArray(j) ? j.filter((x): x is string => typeof x === "string") : [];
	} catch {
		return [];
	}
}

export function saveFavs(cwd: string, favs: string[]): void {
	mkdirSync(join(cwd, ".drawdream-cache"), { recursive: true });
	writeFileSync(favsPath(cwd), `${JSON.stringify(favs, null, "\t")}\n`, "utf8");
}

// ---------- DrawDream Agent 配置（drawdream.agent.json 真源；同步 runtime 为实现细节） ----------

/** 读配置；若 providers 为空且会话有当前模型，自动收编一条渠道并落盘（标准化测试遗留） */
export function loadProjectAgentExtras(cwd: string): {
	shellPath?: string;
	skills?: string[];
	enableSkillCommands?: boolean;
} {
	try {
		const ps = JSON.parse(readFileSync(join(cwd, ".drawdream", "settings.json"), "utf8")) as Record<string, unknown>;
		return {
			shellPath: typeof ps.shellPath === "string" ? ps.shellPath : undefined,
			skills: Array.isArray(ps.skills) ? ps.skills.filter((x): x is string => typeof x === "string") : undefined,
			enableSkillCommands: typeof ps.enableSkillCommands === "boolean" ? ps.enableSkillCommands : undefined,
		};
	} catch {
		return {};
	}
}

/** 按 cwd 缓存最近一次成功 sync 的 agent.json mtime，避免面板轮询反复 sync+refresh */
const agentConfigSyncCache = new Map<string, number>();

function agentJsonMtimeMs(cwd: string): number {
	try {
		return statSync(agentConfigPath(cwd)).mtimeMs;
	} catch {
		return 0;
	}
}

/** 强制下次 loadOrSeed 走完整 sync（写盘后调用） */
export function invalidateAgentConfigSync(cwd: string): void {
	agentConfigSyncCache.delete(cwd);
}

/** 调用方已自行 sync/refresh 后，把当前 mtime 记入缓存 */
export function markAgentConfigSynced(cwd: string): void {
	const m = agentJsonMtimeMs(cwd);
	if (m > 0) agentConfigSyncCache.set(cwd, m);
}

export function loadOrSeedAgentConfig(host: RestHost): { path: string; exists: boolean; config: DrawdreamAgentConfig; seeded: boolean } {
	// 仓库为空时，把当前启用配置拆进仓库（迁移）
	const mig = migrateActiveConfigIntoProfiles(host.cwd);
	if (mig.migrated) {
		host.notify("info", `已建立配置仓库：${mig.ids.join("、")}`);
		invalidateAgentConfigSync(host.cwd);
	}

	const loaded = loadAgentConfig(host.cwd);
	const mtime = agentJsonMtimeMs(host.cwd);

	// 已有配置：把残留 $ENV 收成配置文件明文（Agent 只读自己的配置文件）
	// 仅在 agent.json 变更（或首次）时 sync → models.json + refresh，避免 GET /api/models 热路径全量刷新
	if (Object.keys(loaded.config.providers).length > 0) {
		const cfg = loaded.config;
		const cached = agentConfigSyncCache.get(host.cwd);
		if (cached === mtime && mtime > 0) {
			return { path: loaded.path, exists: true, config: cfg, seeded: false };
		}
		if (materializeEnvKeysInConfig(cfg)) {
			saveAgentConfig(host.cwd, cfg);
		}
		syncAgentConfigToRuntime(host.cwd, host.agentDir(), cfg);
		host.refreshModels();
		agentConfigSyncCache.set(host.cwd, agentJsonMtimeMs(host.cwd));
		return { path: loaded.path, exists: true, config: cfg, seeded: false };
	}

	const { current } = host.listModels();
	if (!current) return { ...loaded, seeded: false };
	const snap = host.providerSnapshot(current.provider);
	if (!snap || snap.models.length === 0) return { ...loaded, seeded: false };

	const extras = loadProjectAgentExtras(host.cwd);
	// key 写入配置文件本身：一次性从环境取实值写入，之后不再依赖环境变量
	const apiKey =
		(snap.envKey && process.env[snap.envKey]?.trim()) ||
		(current.provider === "deepseek" ? process.env.DEEPSEEK_API_KEY?.trim() : undefined) ||
		undefined;

	const provider = seedProviderFromRuntime({
		provider: snap.provider,
		baseUrl: snap.baseUrl,
		api: snap.api,
		apiKey,
		models: snap.models,
	});
	const config: DrawdreamAgentConfig = {
		version: 1,
		defaultProvider: current.provider,
		defaultModel: current.id,
		defaultThinkingLevel: current.thinkingLevel,
		...extras,
		providers: { [snap.provider]: provider },
	};
	saveAgentConfig(host.cwd, config);
	syncAgentConfigToRuntime(host.cwd, host.agentDir(), config);
	host.refreshModels();
	agentConfigSyncCache.set(host.cwd, agentJsonMtimeMs(host.cwd));
	return { path: loaded.path, exists: true, config, seeded: true };
}

export function persistAgentConfig(host: RestHost, config: DrawdreamAgentConfig): DrawdreamAgentConfig {
	const normalized = normalizeAgentConfig(config);
	saveAgentConfig(host.cwd, normalized);
	syncAgentConfigToRuntime(host.cwd, host.agentDir(), normalized);
	host.refreshModels();
	// 明文 Key 写入 auth.json 后，把内存 AuthStorage 也灌一遍（refresh 不重读 auth 文件）
	for (const [name, p] of Object.entries(normalized.providers)) {
		const key = typeof p.apiKey === "string" ? p.apiKey.trim() : "";
		if (key && key !== "placeholder" && !key.startsWith("$") && !key.startsWith("!")) {
			try {
				host.setAuthKey(name, key);
			} catch {
				/* ignore */
			}
		}
	}
	agentConfigSyncCache.set(host.cwd, agentJsonMtimeMs(host.cwd));
	return normalized;
}

/** 从 Agent 配置解析某模型的思考档：模型条目 > defaultThinkingLevel */
export function thinkingLevelFromConfig(
	config: DrawdreamAgentConfig,
	provider: string,
	modelId: string,
): string | undefined {
	const p = config.providers?.[provider];
	const list = Array.isArray(p?.models) ? p.models : [];
	const m = list.find((x) => String(x.id) === modelId);
	const per = typeof m?.thinkingLevel === "string" ? m.thinkingLevel.trim() : "";
	if (per) return per;
	const def = typeof config.defaultThinkingLevel === "string" ? config.defaultThinkingLevel.trim() : "";
	return def || undefined;
}

/**
 * models.json 刷新后：重绑当前模型（contextWindow / maxTokens）
 * 并把配置里的思考档写回会话（配置 → 当前生效，双向里「从配置上来」这一侧）
 */
export async function rebindCurrentModel(host: RestHost, config?: DrawdreamAgentConfig): Promise<void> {
	const cfg = config ?? loadAgentConfig(host.cwd).config;
	// 优先绑定配置中的默认渠道/模型，避免运行时 current 与 agent.json 分叉后「选了又被拉回」
	const preferProvider = cfg.defaultProvider?.trim();
	const preferModel = cfg.defaultModel?.trim();
	let bound = false;
	if (preferProvider && preferModel) {
		try {
			await host.selectModel(preferProvider, preferModel);
			bound = true;
		} catch {
			/* 默认模型暂不可用时回退 */
		}
	}
	if (!bound) {
		const cur = host.listModels().current;
		// unknown 占位模型必须换掉
		if (cur && cur.provider !== "unknown") {
			try {
				await host.selectModel(cur.provider, cur.id);
				bound = true;
			} catch {
				/* 模型可能暂不可用 */
			}
		}
	}
	if (!bound) {
		const first = host.listModels().models[0];
		if (first) {
			try {
				await host.selectModel(first.provider, first.id);
			} catch {
				/* ignore */
			}
		}
	}
	const after = host.listModels().current;
	if (!after || after.provider === "unknown") return;
	const think = thinkingLevelFromConfig(cfg, after.provider, after.id);
	if (think) {
		try {
			host.setThinkingLevel(think);
		} catch {
			/* 模型不认该档位名时忽略 */
		}
	}
}

export function resolveProbeKey(apiKey?: string): string | undefined {
	if (!apiKey || apiKey === "placeholder") return undefined;
	if (apiKey.startsWith("$")) {
		const name = apiKey.slice(1).replace(/^\{|\}$/g, "");
		const v = process.env[name];
		return v || undefined;
	}
	if (apiKey.startsWith("!")) return undefined; // 命令取 key：探测跳过
	return apiKey;
}

/**
 * 将用户粘贴的 OpenAI 兼容 Base URL 归一为 API 根路径（…/v1），
 * 去掉误带的 /responses、/chat/completions 等资源后缀，便于再拼 /models。
 */
export function normalizeOpenAiCompatibleBaseUrl(baseUrl: string): string {
  let u = baseUrl.trim().replace(/\/+$/, "");
  // 文档里常见整段端点；SDK 会自己追加资源路径
  u = u.replace(/\/(responses|chat\/completions|completions|embeddings)$/i, "");
  return u.replace(/\/+$/, "");
}

/** 按 API 类型归一 baseUrl（Anthropic/Google 需保留/补充版本路径） */
export function normalizeBaseUrlForApi(baseUrl: string, api: string): string {
  const u0 = baseUrl.trim().replace(/\/+$/, "");
  const apiLower = (api || "").toLowerCase();
  if (apiLower === "anthropic-messages") {
    // Anthropic 官方根为 https://api.anthropic.com ，探测用 /v1/models
    return u0.replace(/\/v1$/i, "");
  }
  if (apiLower === "google-generative-ai") {
    // 官方带 /v1beta；若用户只填根，补上
    if (/generativelanguage\.googleapis\.com$/i.test(u0) || /generativelanguage\.googleapis\.com\/v1$/i.test(u0)) {
      return u0.replace(/\/v1$/i, "") + "/v1beta";
    }
    return u0;
  }
  // 默认走 OpenAI 兼容归一
  return normalizeOpenAiCompatibleBaseUrl(u0);
}

function extractModelIds(json: unknown): string[] {
	if (!json || typeof json !== "object") return [];
	const obj = json as Record<string, unknown>;
	const raw = Array.isArray(obj.data)
		? obj.data
		: Array.isArray(obj.models)
			? obj.models
			: Array.isArray(json)
				? (json as unknown[])
				: [];
	const ids: string[] = [];
	for (const m of raw) {
		if (typeof m === "string") {
			const id = m.trim();
			if (id) ids.push(id);
			continue;
		}
		if (!m || typeof m !== "object") continue;
		const rec = m as Record<string, unknown>;
		const id = String(rec.id ?? rec.name ?? rec.model ?? "").trim();
		if (id) ids.push(id);
	}
	return ids;
}

/**
 * 探测 / 拉取模型清单。按 api 类型选择路径与鉴权头：
 * - openai-*：GET {base}/models + Bearer
 * - anthropic-messages：GET {root}/v1/models + x-api-key + anthropic-version
 * - google-generative-ai：GET {base}/models?key=…（或 Bearer）
 */
export async function probeModelsEndpoint(
	baseUrl: string,
	apiKey?: string,
	api?: string,
): Promise<{ ok: boolean; status: number; detail: string; ids: string[]; latencyMs: number }> {
	const apiLower = (api || "openai-completions").toLowerCase();
	const root = normalizeBaseUrlForApi(baseUrl, apiLower);
	const resolved = resolveProbeKey(apiKey);
	const headers: Record<string, string> = {
		"User-Agent":
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		Accept: "application/json",
	};

	let url: string;
	if (apiLower === "anthropic-messages") {
		url = `${root}/v1/models`;
		if (resolved) {
			headers["x-api-key"] = resolved;
			headers["anthropic-version"] = "2023-06-01";
		}
	} else if (apiLower === "google-generative-ai") {
		// Google ListModels：/v1beta/models ；key 可 query 或 header
		url = `${root}/models`;
		if (resolved) {
			url += `${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(resolved)}`;
		}
	} else {
		// openai-completions / openai-responses / 其它兼容
		url = `${root}/models`;
		if (resolved) headers.authorization = `Bearer ${resolved}`;
	}

	const t0 = Date.now();
	try {
		const r = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
		const latencyMs = Date.now() - t0;
		if (!r.ok) {
			return {
				ok: false,
				status: r.status,
				detail: (await r.text()).slice(0, 300) || `HTTP ${r.status}`,
				ids: [],
				latencyMs,
			};
		}
		const json = (await r.json()) as unknown;
		let ids = extractModelIds(json);
		// Google 返回 models/gemini-… 前缀时剥掉
		if (apiLower === "google-generative-ai") {
			ids = ids.map((id) => id.replace(/^models\//i, "")).filter(Boolean);
		}
		return {
			ok: true,
			status: r.status,
			detail: ids.length
				? `连通（HTTP ${r.status}，${ids.length} 个模型，${latencyMs} ms）`
				: `连通（HTTP ${r.status}，模型清单为空，${latencyMs} ms）`,
			ids,
			latencyMs,
		};
	} catch (e) {
		return {
			ok: false,
			status: 0,
			detail: e instanceof Error ? e.message : String(e),
			ids: [],
			latencyMs: Date.now() - t0,
		};
	}
}

// ---------- 多预设管理（PLAN-PANELS-V2 §2.6：assets/presets/ 存多份，config.preset 指向当前） ----------

export const PRESETS_DIR = "assets/presets";
/** 面板未点「保存」时的运行时草稿（立即进 system；切换预设时丢弃） */
const PRESET_OVERRIDE_REL = ".drawdream/preset-override.json";
export function resolvePresetOverrideRel(_cwd: string): string {
	return PRESET_OVERRIDE_REL;
}


export const presetSlug = (name: string) => name.trim().replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "preset";

/** 预设路径白名单：历史单文件 drawdream-preset.json 或 assets/presets/ 顶层 .json */
export function validatePresetPath(p: string): string {
	const norm = p.replace(/\\/g, "/");
	if (norm === "drawdream-preset.json") return norm;
	const base = norm.startsWith(`${PRESETS_DIR}/`) ? norm.slice(PRESETS_DIR.length + 1) : "";
	if (!base || base.includes("/") || base.includes("..") || !base.endsWith(".json")) throw new Error("非法预设路径");
	return norm;
}

export function presetOverridePath(cwd: string): string {
	return join(cwd, resolvePresetOverrideRel(cwd));
}

export function clearPresetOverride(cwd: string): void {
	const p = presetOverridePath(cwd);
	if (existsSync(p)) {
		try {
			unlinkSync(p);
		} catch {
			/* ignore */
		}
	}
}

/** 磁盘上的已保存预设（不含草稿） */
export function loadDiskPreset(cwd: string): { path: string; preset: RpPreset } | null {
	const config = loadConfig(cwd);
	if (!config.preset) return null;
	const p = resolvePath(cwd, config.preset);
	if (!existsSync(p)) return null;
	return { path: config.preset, preset: normalizeRpPreset(JSON.parse(readFileSync(p, "utf8"))) };
}

/** 运行时生效：草稿优先，否则磁盘 */
export function loadEffectivePreset(cwd: string): { path: string | null; preset: RpPreset | null; fromOverride: boolean } {
	const config = loadConfig(cwd);
	if (!config.preset) return { path: null, preset: null, fromOverride: false };
	const ovr = presetOverridePath(cwd);
	if (existsSync(ovr)) {
		try {
			return {
				path: config.preset,
				preset: normalizeRpPreset(JSON.parse(readFileSync(ovr, "utf8"))),
				fromOverride: true,
			};
		} catch {
			/* fall through */
		}
	}
	const disk = loadDiskPreset(cwd);
	if (!disk) return { path: config.preset, preset: null, fromOverride: false };
	return { path: disk.path, preset: disk.preset, fromOverride: false };
}

export function mergePresetPatches(
	base: RpPreset,
	body: {
		samplers?: Record<string, number>;
		blocks?: Array<{
			id: string;
			enabled?: boolean;
			name?: string;
			content?: string;
			channel?: "system" | "postHistory";
		}>;
	},
): RpPreset {
	return {
		...base,
		samplers: sanitizeSamplers(body.samplers) ?? base.samplers,
		blocks: base.blocks.map((b) => {
			const patch = body.blocks?.find((x) => x.id === b.id);
			if (!patch) return b;
			const out = { ...b };
			if (typeof patch.enabled === "boolean") out.enabled = patch.enabled;
			if (typeof patch.name === "string") out.name = patch.name.trim() || b.name;
			if (typeof patch.content === "string") out.content = patch.content;
			if (patch.channel === "system" || patch.channel === "postHistory") out.channel = patch.channel;
			return out;
		}),
	};
}

export function listPresetFiles(cwd: string): Array<{ file: string; name: string }> {
	const out: Array<{ file: string; name: string }> = [];
	const readName = (abs: string): string | null => {
		try {
			return normalizeRpPreset(JSON.parse(readFileSync(abs, "utf8"))).name;
		} catch {
			return null;
		}
	};
	const rootPreset = "drawdream-preset.json";
	const rootPath = join(cwd, rootPreset);
	if (existsSync(rootPath)) {
		const name = readName(rootPath);
		if (name !== null) out.push({ file: rootPreset, name });
	}
	const dir = join(cwd, PRESETS_DIR);
	if (existsSync(dir)) {
		for (const f of readdirSync(dir)) {
			if (!f.endsWith(".json")) continue;
			const name = readName(join(dir, f));
			if (name !== null) out.push({ file: `${PRESETS_DIR}/${f}`, name });
		}
	}
	return out;
}

// ---------- 世界书文件管理（PLAN-PANELS-V2 §2.3：选书/导入/删除） ----------

export const LOREBOOKS_DIR = "assets/lorebooks";

/** 世界书扫描目录：assets/lorebooks + 各挂载书所在目录（用户素材常在项目外） */
export function lorebookDirSpecs(cwd: string, config: RpConfig): Array<{ abs: string; relBase: string }> {
	const specs = [{ abs: join(cwd, LOREBOOKS_DIR), relBase: LOREBOOKS_DIR }];
	for (const rel of mountedLorebookPaths(config)) {
		const base = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ".";
		const abs = resolvePath(cwd, base);
		if (!specs.some((s) => s.abs === abs)) specs.push({ abs, relBase: base });
	}
	return specs;
}

const lorebookMetaCache = new Map<string, { mtimeMs: number; count: number | null; displayName: string }>();

export function listLorebookFiles(cwd: string, config: RpConfig): Array<{ path: string; name: string; entryCount: number }> {
	const out: Array<{ path: string; name: string; entryCount: number }> = [];
	for (const spec of lorebookDirSpecs(cwd, config)) {
		if (!existsSync(spec.abs)) continue;
		for (const f of readdirSync(spec.abs)) {
			if (!f.endsWith(".json")) continue;
			const abs = join(spec.abs, f);
			let mtimeMs = 0;
			try {
				mtimeMs = statSync(abs).mtimeMs;
			} catch {
				continue;
			}
			const cached = lorebookMetaCache.get(abs);
			// Prefer JSON `name` over bare filename — zip tools (Windows Compress-Archive)
			// often corrupt non-ASCII filenames while leaving UTF-8 content intact.
			let displayName = f.replace(/\.json$/i, "");
			let count: number | null;
			if (cached && cached.mtimeMs === mtimeMs) {
				count = cached.count;
				displayName = cached.displayName || displayName;
			} else {
				try {
					const raw = readJsonFile(abs) as Record<string, unknown>;
					const entries = normalizeEntries(raw.entries);
					count = entries.length > 0 ? entries.length : null; // 0 条=不是世界书（同目录常混有卡/预设）
					if (typeof raw.name === "string" && raw.name.trim()) {
						displayName = raw.name.trim();
					}
				} catch {
					count = null;
				}
				lorebookMetaCache.set(abs, { mtimeMs, count, displayName });
			}
			if (count === null) continue;
			out.push({ path: `${spec.relBase}/${f}`, name: displayName, entryCount: count });
		}
	}
	return out;
}

// ---------- persona 投影（PLAN-PANELS-V2 §2.5：config.userName/userPersona=当前 persona 的镜像） ----------

export function projectPersonaToConfig(cwd: string, p: Persona): void {
	const config = loadConfig(cwd) as unknown as Record<string, unknown>;
	config.userName = p.name;
	config.userPersona = p.persona;
	writeJsonWithBackup(configPath(cwd), config);
}
