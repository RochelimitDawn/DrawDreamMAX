/**
 * 每用户 Agent 宿主：独立 runtime / session / 助手 / 广播域 / 选择卡 / watch。
 * 由 UserRuntimePool 懒创建，main.ts 仅负责 HTTP/WS 路由与鉴权。
 */

import { existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WebSocket } from "ws";
import {
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	ModelRegistry,
	SessionManager,
	type AgentSession,
	type CreateAgentSessionRuntimeFactory,
} from "@drawdream/agent-runtime/web";

import { loadAgentConfig, normalizeAgentConfig, syncAgentConfigToRuntime } from "../src/agent-config.ts";
import { loadCardFile } from "../src/card.ts";
import { buildGreeting } from "../src/director.ts";
import { activePanels, loadPanels } from "../src/panels.ts";
import {
	dir,
	migrateLegacyLayout,
	resolveConfigPath,
} from "../src/paths.ts";
import { loadState } from "../src/state.ts";
import { DEFAULT_CONFIG, type RpConfig } from "../src/types.ts";
import type { RestHost } from "./rest.ts";
import { createChoiceGate } from "./choice-gate.ts";
import { loadPersonas, personaForCard } from "../src/personas.ts";
import {
	loadConfig,
	projectPersonaToConfig,
	writeJsonWithBackup,
} from "./rest/config.ts";
import { createRestHost } from "./rest-host.ts";
import {
	isSameSessionPath,
	readSessionCard,
	readSessionPreview,
	type CardCache,
	type PreviewCache,
} from "./session-files.ts";
import { createSessionSwipe } from "./session-swipe.ts";
import { createStoryEventHandler } from "./story-subscribe.ts";
import { scheduleScribeTurn } from "./scribe-runner.ts";
import { createAssistantEventHandler, createStoryBridge } from "./assistant-bridge.ts";
import {
	isBackstageText,
	toAssistantHistory,
	toWireHistory,
	type ClientFrame,
	type ServerFrame,
	type WireNames,
	type WireStats,
} from "./wire.ts";
import { stripBackstageMarker } from "../src/stance.ts";
import { setSearchTurnPolicy } from "../src/search-turn-context.ts";
import { createAssistantHost, type AssistantHost } from "./assistant.ts";
import type { PooledRuntime } from "./user-runtime-pool.ts";

export type UserHost = PooledRuntime & {
	restHost: RestHost;
	addClient: (ws: WebSocket) => void;
	removeClient: (ws: WebSocket) => void;
	handleFrame: (ws: WebSocket, frame: ClientFrame) => Promise<void>;
	helloFrame: () => ServerFrame;
	assistantHelloFrame: () => ServerFrame;
	/** 未决选择卡（重连补发） */
	pendingChoiceFrames: () => ServerFrame[];
	broadcast: (frame: ServerFrame) => void;
};

export type CreateUserHostOptions = {
	userId: string;
	workspaceCwd: string;
	/** 仅首次 bootstrap 用户可用 --new；池内后续用户默认续接 */
	newSession?: boolean;
};

export async function createUserHost(opts: CreateUserHostOptions): Promise<UserHost> {
	const userId = opts.userId;
	let cwd = opts.workspaceCwd;
	mkdirSync(cwd, { recursive: true });
	const newSessionFlag = opts.newSession === true;

	for (const line of migrateLegacyLayout(cwd)) {
		console.log(`[drawdream] 迁移 ${line}`);
	}

	// 产品接线层 roleplay：优先安装树（process.cwd），再回退 import.meta 旁路。
	// 用户工作区只放 no-op 桩；真实扩展由 additionalExtensionPaths 注入。
	// 缺扩展 → 无 system 卡设定 → 对话像普通 AI。
	const roleplayCandidates = [
		join(process.cwd(), ".drawdream", "extensions", "roleplay.ts"),
		join(dirname(fileURLToPath(import.meta.url)), "..", ".drawdream", "extensions", "roleplay.ts"),
	];
	const productRoleplayPath = roleplayCandidates.find((p) => existsSync(p)) ?? roleplayCandidates[0]!;
	const localExtDir = join(cwd, ".drawdream", "extensions");
	const localRoleplayPath = join(localExtDir, "roleplay.ts");
	try {
		mkdirSync(localExtDir, { recursive: true });
		if (!existsSync(localRoleplayPath) || !readFileSync(localRoleplayPath, "utf8").includes("DRAW_DREAM_ROLEPLAY_STUB")) {
			writeFileSync(
				localRoleplayPath,
				[
					"/** DRAW_DREAM_ROLEPLAY_STUB — real extension loaded from agent install path */",
					'import type { ExtensionAPI } from "@drawdream/agent-runtime";',
					"export default function roleplayExtension(_pi: ExtensionAPI) {}",
					"",
				].join("\n"),
				"utf8",
			);
		}
	} catch (err) {
		console.error(
			`[drawdream] 写入工作区 roleplay 桩失败：${err instanceof Error ? err.message : String(err)}`,
		);
	}
	if (!existsSync(productRoleplayPath)) {
		console.error(`[drawdream] 未找到产品 roleplay 扩展：candidates=${roleplayCandidates.join(" | ")}`);
	} else {
		console.log(`[drawdream] roleplay 扩展：${productRoleplayPath}`);
	}

	// Windows PATH 修补（每用户 settings 可不同）
	try {
		const settings = JSON.parse(readFileSync(join(cwd, ".drawdream", "settings.json"), "utf8")) as { shellPath?: string };
		if (settings.shellPath) {
			const usrBin = dirname(settings.shellPath);
			if (existsSync(usrBin) && !(process.env.PATH ?? "").split(";").includes(usrBin)) {
				process.env.PATH = `${usrBin};${process.env.PATH ?? ""}`;
			}
		}
	} catch {
		/* skip */
	}

const names: WireNames = { charName: "角色", userName: "用户" };
/** 当前卡标识（drawdream.config.json 的 card 路径原文，会话过滤用） */
let cardPath = "";

const extractEntryText = (content: unknown): string => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((p) =>
			p && typeof p === "object" && (p as { type?: unknown }).type === "text"
				? String((p as { text?: unknown }).text ?? "")
				: "",
		)
		.join("");
};

/** 从项目配置刷新显示名与当前卡（启动时与每次配置写入/会话重载后调用） */
const refreshNamesFromConfig = () => {
	names.charName = "角色";
	names.userName = "用户";
	names.displayRegexScripts = [];
	cardPath = "";
	try {
		const config = JSON.parse(readFileSync(resolveConfigPath(cwd), "utf8")) as RpConfig;
		if (config.userName) names.userName = config.userName;
		if (config.card) {
			cardPath = config.card;
			const abs = isAbsolute(config.card) ? config.card : join(cwd, config.card);
			const card = loadCardFile(abs);
			names.charName = card.name;
			names.displayRegexScripts = card.compat?.regexScripts ?? [];
		}
		// 显示名覆盖（仅显示层；{{char}} 宏与提示词仍用卡名）
		if (config.displayName) names.charName = config.displayName;
	} catch (err) {
		console.error(`[drawdream] 读取角色显示名失败（用占位名继续）：${err instanceof Error ? err.message : String(err)}`);
	}
};
refreshNamesFromConfig();

/**
 * 打开历史会话时：用会话文件内 rp-card 对齐全局 config.card。
 * 否则 hello/charName/system 仍绑旧卡，用户以为在 B 会话却用 A 卡续写。
 * cardCache 在下方声明，调用时已初始化。
 */
let cardCacheRef: CardCache | null = null;
const syncConfigCardFromSessionFile = (sessionFilePath: string): boolean => {
	if (!sessionFilePath || !existsSync(sessionFilePath) || !cardCacheRef) return false;
	let mtimeMs = 0;
	try {
		mtimeMs = statSync(sessionFilePath).mtimeMs;
	} catch {
		return false;
	}
	const info = readSessionCard(sessionFilePath, mtimeMs, cardCacheRef);
	const sessCard = (info?.card ?? "").trim().replace(/\\/g, "/");
	if (!sessCard) return false;
	const configFile = resolveConfigPath(cwd);
	let raw: Record<string, unknown> = { ...DEFAULT_CONFIG };
	try {
		if (existsSync(configFile)) {
			raw = { ...DEFAULT_CONFIG, ...(JSON.parse(readFileSync(configFile, "utf8")) as Partial<RpConfig>) };
		}
	} catch {
		/* default */
	}
	const cur = String(raw.card ?? "")
		.trim()
		.replace(/\\/g, "/");
	if (cur === sessCard) {
		refreshNamesFromConfig();
		return false;
	}
	try {
		const abs = isAbsolute(sessCard) ? sessCard : join(cwd, sessCard);
		if (!existsSync(abs)) return false;
		loadCardFile(abs);
	} catch {
		return false;
	}
	delete raw.displayName;
	delete raw.greetingIndex;
	raw.card = sessCard;
	try {
		writeJsonWithBackup(configFile, raw);
	} catch (err) {
		console.error(`[drawdream] 同步会话卡到配置失败：${err instanceof Error ? err.message : String(err)}`);
		return false;
	}
	try {
		const persona = personaForCard(loadPersonas(cwd), sessCard);
		if (persona) projectPersonaToConfig(cwd, persona);
	} catch {
		/* persona optional */
	}
	refreshNamesFromConfig();
	return true;
};

// ---------- pi 会话宿主 ----------

	const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
	const agentDir = getAgentDir();
	const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
	// Web 产品仅 models.json 自定义渠道：跳过 openrouter/bedrock 等全量内置目录
	const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"), {
		skipBuiltInModels: true,
	});
	const services = await createAgentSessionServices({
		cwd,
		agentDir,
		authStorage,
		modelRegistry,
		resourceLoaderOptions: {
			additionalExtensionPaths: existsSync(productRoleplayPath) ? [productRoleplayPath] : [],
		},
	});
	// backendControl 关：去掉 bash/read/edit/write，只保留 roleplay 扩展工具（与网页「直接对话」一致）
	let noBuiltinTools = true;
	try {
		noBuiltinTools = loadConfig(cwd).backendControl === false;
	} catch {
		noBuiltinTools = true;
	}
	const created = await createAgentSessionFromServices({
		services,
		sessionManager,
		sessionStartEvent,
		...(noBuiltinTools ? { noTools: "builtin" as const } : {}),
	});
	// 扩展加载失败时打日志（否则剧情接线静默缺失，对话退化为普通 AI）
	try {
		const ext = services.resourceLoader?.getExtensions?.();
		const errors = ext?.errors ?? [];
		if (errors.length) {
			for (const e of errors) {
				console.error(`[drawdream] 扩展加载失败 ${e.path}: ${e.error}`);
			}
		}
		const names = (ext?.extensions ?? []).map((x: { path?: string }) => x.path || "?");
		console.log(`[drawdream] 已加载扩展 ${names.length} 个：${names.join(", ") || "(none)"}`);
	} catch (err) {
		console.error(`[drawdream] 读取扩展列表失败：${err instanceof Error ? err.message : String(err)}`);
	}
	return {
		...created,
		services,
		diagnostics: services.diagnostics,
	};
};

const runtime = await createAgentSessionRuntime(createRuntime, {
	cwd,
	agentDir: getAgentDir(),
	sessionManager: newSessionFlag ? SessionManager.create(cwd) : SessionManager.continueRecent(cwd),
});

let session: AgentSession = runtime.session;
let unsubscribe: (() => void) | undefined;
let eventSequence = 0;
let sessionRevision = 0;

// ---------- WS 广播 ----------

const clients = new Set<WebSocket>();
const broadcast = (frame: ServerFrame) => {
	const sequence = ++eventSequence;
	const revision = frame.type === "hello" ? sessionRevision : ++sessionRevision;
	const enriched =
		frame.type === "hello"
			? { ...frame, sequence, sessionRevision: revision }
			: { ...frame, sequence, sessionRevision: revision };
	const data = JSON.stringify(enriched);
	for (const ws of clients) {
		if (ws.readyState === ws.OPEN) ws.send(data);
	}
};

// ---------- 会话统计与世界状态（右栏信息面板的数据源） ----------

const safeStats = (): WireStats | null => {
	try {
		const s = session.getSessionStats();
		const cu = s.contextUsage;
		return {
			userMessages: s.userMessages,
			assistantMessages: s.assistantMessages,
			totalTokens: s.tokens.total,
			cost: s.cost,
			contextPercent: cu?.percent ?? null,
			contextTokens: cu?.tokens ?? null,
			contextWindow: cu?.contextWindow ?? session.model?.contextWindow ?? null,
		};
	} catch {
		return null;
	}
};

const stateDir = dir(cwd, "state");
mkdirSync(stateDir, { recursive: true });
const currentState = () => loadState(join(stateDir, `${session.sessionId}.json`));

// 账本落盘即推送（fs.watch 目录级监听；
// Windows 下同一次写可能触发多次事件，200ms 去抖）
let stateDebounce: ReturnType<typeof setTimeout> | undefined;
const stateWatcher = watch(stateDir, (_evt, filename) => {
	if (filename !== `${session.sessionId}.json`) return;
	clearTimeout(stateDebounce);
	stateDebounce = setTimeout(() => {
		try {
			broadcast({ type: "state", state: currentState() });
		} catch {
			// 读取竞态（写入未完成）：下次事件再推
		}
	}, 200);
});

// 侧栏面板：落盘 artifacts/<sessionId>.json，fs.watch 推送全量（含 rewind 回退）
const artifactsDir = dir(cwd, "artifacts");
mkdirSync(artifactsDir, { recursive: true });
const currentPanels = () => activePanels(loadPanels(join(artifactsDir, `${session.sessionId}.json`)));

let panelsDebounce: ReturnType<typeof setTimeout> | undefined;
const panelsWatcher = watch(artifactsDir, (_evt, filename) => {
	if (filename !== `${session.sessionId}.json`) return;
	clearTimeout(panelsDebounce);
	panelsDebounce = setTimeout(() => {
		try {
			broadcast({ type: "panels", panels: currentPanels() });
		} catch {
			// 读取竞态（写入未完成）：下次事件再推
		}
	}, 200);
});

// swipe 工厂在 hello/resync 之后创建（需 resyncAll 闭包）；此处先声明再赋值
let annotateSwipes: ReturnType<typeof createSessionSwipe>["annotateSwipes"];
let regenerateSwipe: ReturnType<typeof createSessionSwipe>["regenerateSwipe"];
let handleSwipe: ReturnType<typeof createSessionSwipe>["handleSwipe"];

const helloFrame = (): ServerFrame => ({
	type: "hello",
	sequence: eventSequence,
	sessionRevision,
	sessionId: session.sessionId,
	charName: names.charName,
	userName: names.userName,
	cardPath: cardPath || undefined,
	messages: annotateSwipes(toWireHistory(session.messages, names)),
	state: currentState(),
	stats: safeStats(),
	panels: currentPanels(),
});

/** 全量重放（斜杠命令 / 树导航 / 压缩后：让所有端与会话文件对齐） */
const resyncAll = () => broadcast(helloFrame());

const sessionSwipe = createSessionSwipe({
	getSession: () => session as never,
	broadcast,
	resyncAll,
});
annotateSwipes = sessionSwipe.annotateSwipes;
regenerateSwipe = sessionSwipe.regenerateSwipe;
handleSwipe = sessionSwipe.handleSwipe;

/** 会话树条目是否为开场白 */
const isGreetingTreeEntry = (e: Record<string, unknown>): boolean => {
	const t = String(e.type ?? "");
	if (t === "custom_message" && e.customType === "rp-greeting") return true;
	const msg = e.message as { role?: unknown; customType?: unknown } | undefined;
	if (t === "message" && msg?.role === "custom" && msg?.customType === "rp-greeting") return true;
	return false;
};

/**
 * 宿主层切换开场白：await 导航 + 注入 + resync，避免叠楼。
 * （扩展里 pi.sendMessage 是 fire-and-forget，resync 会抢跑；且 custom_message 识别曾漏检）
 */
const hostSwitchGreeting = async (rawArg: string): Promise<void> => {
	const configPath = resolveConfigPath(cwd);
	let cfg: RpConfig = { ...DEFAULT_CONFIG };
	try {
		if (existsSync(configPath)) {
			cfg = { ...DEFAULT_CONFIG, ...(JSON.parse(readFileSync(configPath, "utf8")) as Partial<RpConfig>) };
		}
	} catch {
		/* default */
	}
	if (!cfg.card) {
		broadcast({ type: "notify", level: "error", text: "未配置角色卡" });
		return;
	}
	let card;
	try {
		const cardPath = isAbsolute(cfg.card) ? cfg.card : join(cwd, cfg.card);
		card = loadCardFile(cardPath);
	} catch (err) {
		broadcast({
			type: "notify",
			level: "error",
			text: `角色卡装载失败：${err instanceof Error ? err.message : String(err)}`,
		});
		return;
	}
	// 全量下标（与 buildGreeting / 配置 greetingIndex 一致）+ 非空槽位（切换时跳过空开场白）
	const fullPool = [card.firstMes, ...card.alternateGreetings].map((t, i) => ({
		i,
		t: typeof t === "string" ? t : "",
	}));
	const nonempty = fullPool.filter((x) => x.t.trim());
	if (nonempty.length === 0) {
		broadcast({ type: "notify", level: "error", text: "本卡没有开场白" });
		return;
	}
	const raw = rawArg.trim().toLowerCase();
	const curFull = cfg.greetingIndex ?? 0;
	let pos = nonempty.findIndex((x) => x.i === curFull);
	if (pos < 0) pos = 0;
	if (!raw || raw === "next") pos = (pos + 1) % nonempty.length;
	else if (raw === "prev") pos = (pos - 1 + nonempty.length) % nonempty.length;
	else {
		const n = Number.parseInt(raw, 10);
		if (!Number.isFinite(n)) {
			broadcast({ type: "notify", level: "error", text: "用法：/greeting [序号|next|prev]" });
			return;
		}
		// 数字按「全量下标」理解（与配置 / 卡面板一致）
		const hit = nonempty.findIndex((x) => x.i === n);
		pos = hit >= 0 ? hit : Math.max(0, Math.min(nonempty.length - 1, n));
	}
	const idx = nonempty[pos].i; // 写入配置与 buildGreeting 的全量下标
	const displayOrdinal = pos + 1; // 角标用非空序位 1..N
	const displayTotal = nonempty.length;
	try {
		const disk = existsSync(configPath)
			? (JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>)
			: {};
		disk.greetingIndex = idx;
		writeFileSync(configPath, `${JSON.stringify(disk, null, "\t")}\n`, "utf8");
	} catch (err) {
		broadcast({
			type: "notify",
			level: "error",
			text: `写入配置失败：${err instanceof Error ? err.message : String(err)}`,
		});
		return;
	}
	cfg = { ...cfg, greetingIndex: idx };

	const sm = session.sessionManager;
	const branch = sm.getBranch() as Array<Record<string, unknown>>;
	const hasUser = branch.some((e) => {
		if (e.type !== "message") return false;
		const msg = e.message as { role?: string; content?: unknown } | undefined;
		if (msg?.role !== "user") return false;
		return !isBackstageText(extractEntryText(msg.content));
	});
	if (hasUser) {
		broadcast({
			type: "notify",
			level: "info",
			text: `已选定开场白 ${displayOrdinal}/${displayTotal}，当前会话已开聊，下次新会话生效。`,
		});
		return;
	}

	const greets = branch.filter(isGreetingTreeEntry);
	if (greets.length > 0) {
		const first = greets[0];
		const parentId = (first.parentId as string | null) ?? null;
		if (parentId) {
			const result = await session.navigateTree(parentId, { summarize: false });
			if (result.cancelled) return;
		} else {
			// 树根开场白：resetLeaf，新开场白与旧的并列 sibling，当前只显示新的
			sm.resetLeaf();
			const ctx = sm.buildSessionContext();
			session.agent.state.messages = ctx.messages;
		}
	}

	const text = buildGreeting(card, cfg);
	// details 带序号 → wire greetingPick，前端角标与正文同源
	await session.sendCustomMessage({
		customType: "rp-greeting",
		content: text,
		display: true,
		details: { rpGreeting: { index: pos, total: displayTotal, fullIndex: idx } },
	});
	resyncAll();
	broadcast({ type: "notify", level: "info", text: `已切换开场白 ${displayOrdinal}/${displayTotal}` });
};

/**
 * 新会话/换卡后：同步写入 rp-card + 开场白（await），再 resync。
 * 扩展里 pi.sendMessage 是 fire-and-forget，reload 后立刻 resync 会抢到空历史，
 * 前端就一直显示「请从卡面库挑选角色」。
 */
const ensureSessionCardAndGreeting = async (): Promise<void> => {
	refreshNamesFromConfig();
	const configPath = resolveConfigPath(cwd);
	let cfg: RpConfig = { ...DEFAULT_CONFIG };
	try {
		if (existsSync(configPath)) {
			cfg = { ...DEFAULT_CONFIG, ...(JSON.parse(readFileSync(configPath, "utf8")) as Partial<RpConfig>) };
		}
	} catch {
		/* default */
	}
	const rel = (cfg.card ?? "").trim();
	if (!rel) return;
	let card;
	try {
		const abs = isAbsolute(rel) ? rel : join(cwd, rel);
		if (!existsSync(abs)) return;
		card = loadCardFile(abs);
	} catch {
		return;
	}
	const sm = session.sessionManager;
	const branch = sm.getBranch() as Array<Record<string, unknown>>;
	// 已有 rp-card 时不要用当前 config 覆盖（跨卡历史）
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
		try {
			session.sessionManager.appendCustomEntry("rp-card", { card: rel, name: card.name });
		} catch {
			/* ignore */
		}
	}
	if (cfg.greeting === false) {
		resyncAll();
		return;
	}
	const hasGreeting = branch.some(isGreetingTreeEntry);
	const hasUser = branch.some((e) => {
		if (e.type !== "message") return false;
		const msg = e.message as { role?: string; content?: unknown } | undefined;
		if (msg?.role !== "user") return false;
		return !isBackstageText(extractEntryText(msg.content));
	});
	if (hasGreeting || hasUser) {
		resyncAll();
		return;
	}
	const fullPool = [card.firstMes, ...card.alternateGreetings].map((t) => (typeof t === "string" ? t : ""));
	const nonempty = fullPool
		.map((t, i) => ({ i, t }))
		.filter((x) => x.t.trim());
	if (nonempty.length === 0) {
		resyncAll();
		return;
	}
	const curFull = cfg.greetingIndex ?? 0;
	let pos = nonempty.findIndex((x) => x.i === curFull);
	if (pos < 0) pos = 0;
	const idx = nonempty[pos]!.i;
	const text = buildGreeting(card, { ...cfg, greetingIndex: idx });
	if (!text.trim()) {
		resyncAll();
		return;
	}
	await session.sendCustomMessage({
		customType: "rp-greeting",
		content: text,
		display: true,
		details: { rpGreeting: { index: pos, total: nonempty.length, fullIndex: idx } },
	});
	resyncAll();
};

// ---------- 扩展绑定：headless UI 上下文 + 命令动作桥（参考 dist/modes/rpc/rpc-mode.js） ----------
// ---------- 剧情决策门禁：uiContext.select/input ↔ 前端选择卡（choice-gate.ts） ----------

const choiceGate = createChoiceGate(broadcast);
/** 抉择应答收敛：除回填选择卡外，把用户的选择/自由输入作为一条 user 消息写入历史并广播进正文，
 *  避免用户输入只在抉择卡工具条里一闪而过（resync 后消失）。 */
const settleChoice = (id: string, outcome: { value?: string; stop?: boolean; via?: "option" | "free" }) => {
	if (!outcome.stop && outcome.value?.trim()) {
		const value = outcome.value.trim();
		try {
			session.sessionManager.appendMessage({
				role: "user",
				content: value,
				timestamp: Date.now(),
			} as never);
		} catch {
			/* 落盘失败不影响应答收敛 */
		}
		broadcast({ type: "message", message: { channel: "user", name: names.userName, text: value } });
	}
	choiceGate.settle(id, outcome);
};
const uiContext = choiceGate.uiContext;

const onStoryEvent = createStoryEventHandler({
	broadcast,
	resyncAll,
	safeStats,
	getNames: () => names,
	onAgentEnd: () => {
		scheduleScribeTurn({
			getCwd: () => cwd,
			getSessionId: () => session.sessionId,
			getModel: () => session.model as never,
			getApiKey: async (model) => {
				try {
					const r = await session.modelRegistry.getApiKeyAndHeaders(model as never);
					if (r?.ok && typeof r.apiKey === "string" && r.apiKey.trim()) return r.apiKey;
				} catch {
					/* ignore */
				}
				return null;
			},
			getMessages: () => session.messages as never,
			getNames: () => names,
			onStateWritten: () => resyncAll(),
		});
	},
});

const bindSession = async () => {
	session = runtime.session;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- headless stub 集合，形状对齐 rpc-mode 的实现
	await session.bindExtensions({
		uiContext: uiContext as any,
		mode: "rpc",
		commandContextActions: {
			waitForIdle: () => session.agent.waitForIdle(),
			newSession: (options: unknown) => runtime.newSession(options as never),
			fork: async (entryId: string, options: unknown) => {
				const result = await runtime.fork(entryId, options as never);
				return { cancelled: result.cancelled };
			},
			navigateTree: async (targetId: string, options: unknown) => {
				const result = await session.navigateTree(targetId, options as never);
				return { cancelled: result.cancelled };
			},
			switchSession: (sessionPath: string, options: unknown) => runtime.switchSession(sessionPath, options as never),
			reload: () => session.reload(),
		} as never,
		onError: (err: { extensionPath: string; event: string; error: string }) => {
			broadcast({ type: "error", text: `扩展错误（${err.event}）：${err.error}` });
		},
	});

	unsubscribe?.();
	unsubscribe = session.subscribe((event) => onStoryEvent(event as never));
};

runtime.setRebindSession(async () => {
	await bindSession();
	resyncAll(); // /branch 等替换会话后，所有端对齐新会话
});
await bindSession();
// 冷启动：若配置已有卡但会话尚无开场白，同步注入（避免前端空态误导）
try {
	await ensureSessionCardAndGreeting();
} catch (err) {
	console.error(`[drawdream] 启动注入开场白失败：${err instanceof Error ? err.message : String(err)}`);
	resyncAll();
}

// ---------- REST 宿主接口（rest-host.ts；pi 经 deps.getSession 触碰） ----------

// 会话文件缓存提前声明，供 restHost / sessionInfos 共用
const cardCache: CardCache = new Map();
cardCacheRef = cardCache;
const previewCache: PreviewCache = new Map();
const sessionCard = (path: string, mtimeMs: number) => readSessionCard(path, mtimeMs, cardCache);
const sessionPreview = (path: string, mtimeMs: number) => readSessionPreview(path, mtimeMs, previewCache);

// sessionInfos / listSessions / handlePrompt / assertListedSession 在下方定义；
// 方法调用时再解析，闭包绑定即可。
const restHost: RestHost = createRestHost({
	getCwd: () => cwd,
	getSession: () => session as never,
	switchSession: (path) => runtime.switchSession(path),
	newSession: () => runtime.newSession(),
	broadcast,
	resyncAll,
	refreshNamesFromConfig,
	ensureSessionCardAndGreeting,
	handlePrompt: (text) => handlePrompt(text),
	listSessionsFrame: () => listSessions(),
	sessionInfos: () => sessionInfos(),
	assertListedSession: (path) => assertListedSession(path),
	cardCache,
	previewCache,
	sessionCard,
	stateDir,
	artifactsDir,
});

// 启动时：drawdream.agent.json → models.json/auth.json，重绑模型 + 应用思考档（配置 → 当前生效）
try {
	const loaded = loadAgentConfig(cwd);
	if (loaded.exists && Object.keys(loaded.config.providers).length > 0) {
		const cfg = normalizeAgentConfig(loaded.config);
		syncAgentConfigToRuntime(cwd, getAgentDir(), cfg);
		session.modelRegistry.refresh();
		// 内存 AuthStorage 同步明文 Key（refresh 不重载 auth.json）
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
		// 优先配置默认模型；否则尝试刷新当前模型对象。unknown 占位必须被替换。
		const preferP = cfg.defaultProvider?.trim();
		const preferM = cfg.defaultModel?.trim();
		let bound = false;
		if (preferP && preferM) {
			const m = session.modelRegistry.find(preferP, preferM);
			if (m) {
				await session.setModel(m);
				bound = true;
			}
		}
		const cur = session.model;
		if (!bound && cur && cur.provider !== "unknown") {
			const next = session.modelRegistry.find(cur.provider, cur.id);
			if (next) await session.setModel(next);
		} else if (!bound) {
			const first = session.modelRegistry.getAvailable()[0];
			if (first) await session.setModel(first);
		}
		const after = session.model;
		if (after && after.provider !== "unknown") {
			const p = cfg.providers[after.provider];
			const entry = Array.isArray(p?.models) ? p.models.find((m) => String(m.id) === after.id) : undefined;
			const per =
				typeof entry?.thinkingLevel === "string" && entry.thinkingLevel.trim()
					? entry.thinkingLevel.trim()
					: "";
			const def =
				typeof cfg.defaultThinkingLevel === "string" && cfg.defaultThinkingLevel.trim()
					? cfg.defaultThinkingLevel.trim()
					: "";
			const think = per || def;
			if (think) {
				try {
					session.setThinkingLevel(think as never);
				} catch {
					/* 档位名不支持时忽略 */
				}
			}
		}
		console.log("[drawdream] 已从 drawdream.agent.json 同步 models.json 与思考档");
	}
} catch (err) {
	console.error(`[drawdream] 启动同步 agent 配置失败：${err instanceof Error ? err.message : String(err)}`);
}

// ---------- 助手会话（右栏）：同进程第二 pi 会话（server/assistant.ts 托管） ----------
// 剧情桥 + 事件翻译见 assistant-bridge.ts；启动失败不挡剧情。

const storyBridge = createStoryBridge({
	getSession: () => session as never,
	getNames: () => names,
	safeStats,
	currentState,
	getRestHost: () => restHost,
	getCwd: () => cwd,
});

let assistantHost: AssistantHost | null = null;

const assistantHelloFrame = (): ServerFrame => ({
	type: "assistant_hello",
	messages: assistantHost ? toAssistantHistory(assistantHost.messages()) : [],
	busy: assistantHost?.isStreaming() ?? false,
	model: assistantHost?.modelInfo() ?? null,
	follow: assistantHost?.follows() ?? true,
	todos: assistantHost?.todos() ?? [],
	subagents: assistantHost?.subagents() ?? [],
});

const onAssistantEvent = createAssistantEventHandler(broadcast);

/** 用户对助手发话（面板输入框 / 主输入框场外标记改道共用） */
	const promptAssistant = async (text: string, webSearch = false) => {
	if (!assistantHost) {
		broadcast({ type: "notify", level: "warning", text: "助手不可用（启动失败或没有可用模型），剧情不受影响" });
		return;
	}
	broadcast({ type: "assistant_message", message: { role: "user", text } });
		await assistantHost.prompt(text, webSearch);
};

try {
	assistantHost = await createAssistantHost({
		cwd,
		bridge: storyBridge,
		uiContext,
		onEvent: onAssistantEvent,
		onError: (text) => broadcast({ type: "error", text }),
	});
	console.log(`[drawdream] 助手会话已就位（${assistantHost.modelInfo() ? `${assistantHost.modelInfo()!.provider}/${assistantHost.modelInfo()!.id}` : "暂无模型"}${assistantHost.follows() ? "，跟随剧情模型" : ""}）`);
} catch (err) {
	console.error(`[drawdream] 助手会话启动失败（面板不可用，剧情不受影响）：${err instanceof Error ? err.message : String(err)}`);
}

	const handlePrompt = async (text: string, webSearch = false) => {
	const trimmed = text.trim();
	// 配置热更新：宿主层直接 reload，避免未知斜杠进模型（历史 softRefresh 走 /rprefresh）
	if (/^\/rprefresh\s*$/i.test(trimmed)) {
		if (session.isStreaming) {
			void session.agent
				.waitForIdle()
				.then(async () => {
					await session.reload();
					refreshNamesFromConfig();
					resyncAll();
				})
				.catch((err: unknown) => {
					broadcast({
						type: "notify",
						level: "error",
						text: err instanceof Error ? err.message : String(err),
					});
				});
			return;
		}
		await session.reload();
		refreshNamesFromConfig();
		resyncAll();
		return;
	}
	// ST 式变体：无参 /reroll 与 /swipe 由宿主处理（需 agent.continue，扩展命令上下文无此能力）
	if (/^\/reroll\s*$/i.test(trimmed)) {
		if (session.isStreaming) {
			broadcast({ type: "notify", level: "warning", text: "请等当前回复完成（或先停止），再重新生成" });
			return;
		}
		await regenerateSwipe();
		return;
	}
	// 开场白切换：宿主层处理，保证「同一条替换」而非叠楼
	const greetingMatch = /^\/greeting(?:\s+(.*))?$/i.exec(trimmed);
	if (greetingMatch) {
		if (session.isStreaming) {
			broadcast({ type: "notify", level: "warning", text: "请等当前回复完成（或先停止），再切换开场白" });
			return;
		}
		await hostSwitchGreeting(greetingMatch[1] ?? "");
		return;
	}
	const swipeMatch = /^\/swipe(?:\s+(prev|next|new))?\s*$/i.exec(trimmed);
	if (swipeMatch) {
		if (session.isStreaming) {
			broadcast({ type: "notify", level: "warning", text: "请等当前回复完成（或先停止），再切换变体" });
			return;
		}
		const dir = (swipeMatch[1]?.toLowerCase() ?? "next") as "prev" | "next" | "new";
		await handleSwipe(dir);
		return;
	}
	// /compact：pi 在 TUI 层拦截，SDK prompt 不会当命令执行。Web/API/补全统一在此走 session.compact。
	// compaction_end 事件会 resyncAll；失败时用 notify 回传（session too small / Already compacted 等）。
	const compactMatch = /^\/compact(?:\s+(.*))?$/i.exec(trimmed);
	if (compactMatch) {
		if (session.isStreaming) {
			broadcast({ type: "notify", level: "warning", text: "请等当前回复完成（或先停止），再压缩上下文" });
			return;
		}
		if (session.isCompacting) return;
		const custom = compactMatch[1]?.trim();
		try {
			await session.compact(custom || undefined);
		} catch (err) {
			broadcast({
				type: "notify",
				level: "error",
				text: err instanceof Error ? err.message : String(err),
			});
		}
		return;
	}

	// 场外标记 → 改道助手会话；叙事会话只处理剧情。旧会话场外轮由 wire 历史渲染。
	if (isBackstageText(trimmed)) {
		await promptAssistant(stripBackstageMarker(trimmed), webSearch);
		return;
	}
	if (session.isStreaming) {
		broadcast({ type: "notify", level: "warning", text: "当前回复仍在生成，请等待完成后再发送" });
		return;
	}

	const isCommand = trimmed.startsWith("/");
	if (!isCommand) {
		broadcast({
			type: "message",
			message: { channel: "user", name: names.userName, text: trimmed },
		});
	}
	const config = loadConfig(cwd);
	const searchAllowed = webSearch && config.smartSearch?.enabled !== false;
	setSearchTurnPolicy(cwd, session.sessionId, searchAllowed ? "force" : "off");
	// 基于当前 active 工具过滤 smart_search（不缓存 storyToolNames：
	// backendControl 热更新会动态收敛本机工具集，缓存旧值会导致 prompt 时误清空工具）。
	const currentTools = session.getActiveToolNames();
	session.setActiveToolsByName(
		searchAllowed ? currentTools : currentTools.filter((name) => name !== "smart_search"),
	);
	await session.prompt(trimmed);
	// 斜杠命令可能改写历史（/rewind /reroll /import）或注入消息：全量对齐
	if (isCommand) resyncAll();
};

	let promptInFlight = false;

/** 流式中禁止的操作统一挡下 */
const refuseWhileStreaming = (ws: WebSocket, what: string): boolean => {
	if (!session.isStreaming) return false;
	ws.send(JSON.stringify({ type: "notify", level: "warning", text: `请等当前回复完成（或先停止），再${what}` } satisfies ServerFrame));
	return true;
};

// ---------- 会话列表（卡过滤 + 预览；缓存见上方 restHost 段） ----------

/**
 * 列**全部会话**（跨角色卡），按修改时间倒序。
 * - 当前打开的会话始终标 current
 * - 无 rp-card 的会话仍列出，cardName 回落当前卡显示名
 */
const sessionInfos = async () => {
	const all = await SessionManager.list(cwd);
	const curFile = session.sessionFile;
	const curId = session.sessionId;
	const list: Array<{
		path: string;
		id: string;
		name?: string;
		firstMessage: string;
		modified: number;
		messageCount: number;
		current: boolean;
		preview?: string;
		cardName: string;
		cardPath?: string;
	}> = [];
	const fallbackCardPath = cardPath || undefined;
	for (const s of all) {
		const mtime = s.modified instanceof Date ? s.modified.getTime() : Number(s.modified) || 0;
		// 新建后 mtime 刚变：清掉可能过期的卡缓存再读
		if (cardCache.has(s.path)) {
			const c = cardCache.get(s.path)!;
			if (c.mtimeMs !== mtime) cardCache.delete(s.path);
		}
		const info = sessionCard(s.path, mtime);
		const isCurrent = s.id === curId || isSameSessionPath(s.path, curFile);
		const preview = sessionPreview(s.path, mtime);
		const sessCardPath = info?.card || (isCurrent ? fallbackCardPath : undefined);
		list.push({
			path: s.path,
			id: s.id,
			...(s.name ? { name: s.name } : {}),
			firstMessage: s.firstMessage,
			modified: mtime,
			messageCount: s.messageCount,
			current: isCurrent,
			...(preview ? { preview } : {}),
			cardName: info?.name || names.charName,
			...(sessCardPath ? { cardPath: sessCardPath } : {}),
		});
	}
	// 兜底：列表里没有任何 current，但进程确有打开会话 → 按 id/路径补一条
	if (curId && !list.some((x) => x.current)) {
		const mine = all.find((s) => s.id === curId || isSameSessionPath(s.path, curFile));
		if (mine) {
			const mtime = mine.modified instanceof Date ? mine.modified.getTime() : Number(mine.modified) || 0;
			const info = sessionCard(mine.path, mtime);
			const preview = sessionPreview(mine.path, mtime);
			const existing = list.find((x) => x.id === mine.id || isSameSessionPath(x.path, mine.path));
			const sessCardPath = info?.card || fallbackCardPath;
			if (existing) {
				existing.current = true;
				if (sessCardPath && !existing.cardPath) existing.cardPath = sessCardPath;
			} else {
				list.push({
					path: mine.path,
					id: mine.id,
					...(mine.name ? { name: mine.name } : {}),
					firstMessage: mine.firstMessage,
					modified: mtime,
					messageCount: mine.messageCount,
					current: true,
					...(preview ? { preview } : {}),
					cardName: info?.name || names.charName,
					...(sessCardPath ? { cardPath: sessCardPath } : {}),
				});
			}
		} else {
			// 惰性落盘：首条 assistant 前会话文件可能尚未出现在 SessionManager.list
			// （_persist 无 assistant 时不写盘）。新建后列表仍须立刻有「当前会话」。
			let cardName = names.charName;
			let lazyCardPath = fallbackCardPath;
			try {
				const entries = session.sessionManager.getEntries() as Array<{
					type?: string;
					customType?: string;
					data?: { name?: string; card?: string };
				}>;
				for (let i = entries.length - 1; i >= 0; i--) {
					const e = entries[i];
					if (e?.type === "custom" && e.customType === "rp-card") {
						if (typeof e.data?.name === "string" && e.data.name) cardName = e.data.name;
						if (typeof e.data?.card === "string" && e.data.card) lazyCardPath = e.data.card;
						break;
					}
				}
			} catch {
				// 极早期生命周期：回落显示名
			}
			let messageCount = 0;
			try {
				messageCount = session.messages?.length ?? 0;
			} catch {
				messageCount = 0;
			}
			list.push({
				path: curFile || "",
				id: curId,
				firstMessage: "",
				modified: Date.now(),
				messageCount,
				current: true,
				cardName,
				...(lazyCardPath ? { cardPath: lazyCardPath } : {}),
			});
		}
	}
	list.sort((a, b) => b.modified - a.modified);
	return list;
};

const listSessions = async (): Promise<ServerFrame> => ({ type: "sessions", list: await sessionInfos() });

// ---------- 会话文件辅助（预览/重命名/删除/搜索——面板重做 PLAN-PANELS §2.1） ----------

/** 校验路径确属本项目会话清单（所有会话文件操作的门），返回清单项 */
const assertListedSession = async (path: string) => {
	const all = await SessionManager.list(cwd);
	const found = all.find((s) => s.path === path);
	if (!found) throw new Error("不是本项目的会话文件");
	return found;
};

	const host: UserHost = {
		userId,
		workspaceCwd: cwd,
		get connectionCount() {
			return clients.size;
		},
		lastActiveAt: Date.now(),
		isStreaming: () => session.isStreaming || (assistantHost?.isStreaming() ?? false),
		restHost,
		addClient(ws) {
			clients.add(ws);
			host.lastActiveAt = Date.now();
		},
		removeClient(ws) {
			clients.delete(ws);
			host.lastActiveAt = Date.now();
		},
		broadcast,
		helloFrame,
		assistantHelloFrame,
		pendingChoiceFrames: () => choiceGate.pendingFrames(),
		async handleFrame(ws, frame) {
			host.lastActiveAt = Date.now();
				switch (frame.type) {
				case "prompt": {
					const text = String(frame.text ?? "").trim();
					if (!text) break;
					if (promptInFlight || session.isStreaming) {
						ws.send(JSON.stringify({ type: "notify", level: "warning", text: "当前回复仍在生成，请等待完成后再发送" } satisfies ServerFrame));
						break;
					}
					promptInFlight = true;
					try {
						await handlePrompt(text, frame.webSearch === true);
					} finally {
						promptInFlight = false;
					}
					break;
				}
				case "command": {
					const text = String(frame.text ?? "").trim();
					if (!text.startsWith("/")) {
						ws.send(JSON.stringify({ type: "notify", level: "warning", text: "Slash Command 必须以 / 开头" } satisfies ServerFrame));
						break;
					}
					if (promptInFlight || session.isStreaming) {
						ws.send(JSON.stringify({ type: "notify", level: "warning", text: "当前回复仍在生成，请等待完成后再执行 Slash Command" } satisfies ServerFrame));
						break;
					}
					promptInFlight = true;
					try {
						await handlePrompt(text, false);
					} finally {
						promptInFlight = false;
					}
					break;
				}
				case "custom_message": {
					if (session.isStreaming) {
						ws.send(JSON.stringify({ type: "notify", level: "warning", text: "当前回复仍在生成，暂不能写入消息" } satisfies ServerFrame));
						break;
					}
					const customType = String(frame.customType ?? "").trim();
					const content = String(frame.content ?? "");
					if (!customType || !content.trim()) break;
					await session.sendCustomMessage({ customType, content, display: frame.display !== false, details: frame.details });
					resyncAll();
					break;
				}
				case "message_update": {
					if (refuseWhileStreaming(ws, "更新消息")) return;
					const id = String(frame.id ?? "").trim();
					if (!id) throw new Error("缺少消息 ID");
					session.sessionManager.updateMessageEntry(id, {
						...(frame.content !== undefined ? { content: frame.content } : {}),
						...(frame.display !== undefined ? { display: frame.display } : {}),
						...(frame.details !== undefined ? { details: frame.details } : {}),
					});
					resyncAll();
					break;
				}
				case "message_delete": {
					if (refuseWhileStreaming(ws, "删除消息")) return;
					const id = String(frame.id ?? "").trim();
					if (!id) throw new Error("缺少消息 ID");
					session.sessionManager.deleteMessageEntry(id);
					resyncAll();
					break;
				}
				case "abort": {
					// 有未决抉择时先收敛（ask_director 返回 terminate toolResult，历史配对完整），
					// 避免直接 abort 中断工具导致 tool_calls 无配对、后续请求 400。
					const pendingFrames = choiceGate.pendingFrames();
					if (pendingFrames.length) {
						for (const pf of pendingFrames) settleChoice(pf.id, { stop: true });
					} else {
						await session.abort();
					}
					break;
				}
				case "reroll": {
					if (refuseWhileStreaming(ws, "重新生成")) return;
					const t = String(frame.text ?? "").trim();
					await handlePrompt(t ? `/reroll ${t}` : "/reroll", false);
					break;
				}
				case "swipe": {
					if (refuseWhileStreaming(ws, "切换回复变体")) return;
					const dir = frame.dir === "prev" || frame.dir === "next" || frame.dir === "new" ? frame.dir : "next";
					await handleSwipe(dir);
					break;
				}
				case "compact":
					if (refuseWhileStreaming(ws, "压缩上下文")) return;
					if (session.isCompacting) return;
					await session.compact();
					break;
				case "sessions":
					ws.send(JSON.stringify(await listSessions()));
					break;
				case "open": {
					if (refuseWhileStreaming(ws, "切换会话")) return;
					const path = String(frame.path ?? "");
					if (!path) return;
					if (isSameSessionPath(path, session.sessionFile)) {
						// 已在该文件：仍强制对齐卡配置 + hello，避免 UI 以为切了但后端仍用旧卡
						const aligned = syncConfigCardFromSessionFile(path);
						if (aligned) {
							try {
								await session.reload();
							} catch {
								/* ignore */
							}
						}
						refreshNamesFromConfig();
						resyncAll();
						broadcast(await listSessions());
						return;
					}
					try {
						session.sessionManager.ensurePersisted();
					} catch {
						/* best-effort */
					}
					await assertListedSession(path);
					await runtime.switchSession(path);
					// switchSession → rebindSession → resyncAll（可能仍是旧 config.card 名）
					const aligned = syncConfigCardFromSessionFile(session.sessionFile || path);
					if (aligned) {
						try {
							await session.reload();
							refreshNamesFromConfig();
						} catch {
							/* ignore */
						}
					}
					refreshNamesFromConfig();
					resyncAll();
					broadcast(await listSessions());
					broadcast({ type: "notify", level: "info", text: "已切换会话" });
					break;
				}
				case "new": {
					if (refuseWhileStreaming(ws, "新建会话")) return;
					try {
						session.sessionManager.ensurePersisted();
					} catch {
						/* best-effort */
					}
					const newResult = await runtime.newSession();
					if (newResult.cancelled) {
						ws.send(
							JSON.stringify({
								type: "notify",
								level: "warning",
								text: "新建会话已被扩展取消",
							} satisfies ServerFrame),
						);
						return;
					}
					try {
						session.sessionManager.ensurePersisted();
					} catch {
						/* best-effort */
					}
					// 扩展里 pi.sendMessage 是 fire-and-forget；rebindSession 的 resync 可能在
					// 开场白写入分支之前抢跑。ensureSessionCardAndGreeting 用 await 确保写入后再
					// resync，避免前端看到空白对话页。
					try {
						await ensureSessionCardAndGreeting();
					} catch {
						resyncAll();
					}
					broadcast(await listSessions());
					broadcast({ type: "notify", level: "info", text: "已新建会话" });
					break;
				}
				case "choice_reply": {
					const id = String(frame.id ?? "");
					if (frame.stop) {
						settleChoice(id, { stop: true });
						// 不粗暴 abort：让 ask_director 正常返回终止型 toolResult（terminate），
						// 保证 tool_calls 与 toolResult 配对完整、历史不被破坏；agent 由 terminate 收尾。
					} else {
						const value = String(frame.value ?? "").trim();
						if (!value) return;
						settleChoice(id, { value, via: frame.via === "free" ? "free" : "option" });
					}
					break;
				}
				case "assistant_prompt": {
					const t = String(frame.text ?? "").trim();
					if (t) await promptAssistant(t, frame.webSearch === true);
					break;
				}
				case "assistant_abort":
					await assistantHost?.abort();
					break;
				case "assistant_new":
					if (!assistantHost) return;
					if (assistantHost.isStreaming()) {
						ws.send(
							JSON.stringify({
								type: "notify",
								level: "warning",
								text: "请等助手当前回复完成（或先停止），再开新对话",
							} satisfies ServerFrame),
						);
						return;
					}
					await assistantHost.newConversation();
					broadcast(assistantHelloFrame());
					break;
				case "assistant_sync":
					ws.send(JSON.stringify(assistantHelloFrame()));
					break;
				case "assistant_model": {
					if (!assistantHost) return;
					const provider = typeof frame.provider === "string" ? frame.provider.trim() : "";
					const id = typeof frame.id === "string" ? frame.id.trim() : "";
					try {
						await assistantHost.setModel(provider && id ? { provider, id } : null);
						broadcast(assistantHelloFrame());
					} catch (err) {
						ws.send(
							JSON.stringify({
								type: "notify",
								level: "error",
								text: err instanceof Error ? err.message : String(err),
							} satisfies ServerFrame),
						);
					}
					break;
				}
				default:
					break;
			}
		},
		async dispose() {
			try {
				choiceGate.abortAll();
				unsubscribe?.();
				try {
					stateWatcher?.close();
				} catch {
					/* */
				}
				try {
					panelsWatcher?.close();
				} catch {
					/* */
				}
				for (const ws of clients) {
					try {
						ws.close(1001, "runtime disposed");
					} catch {
						/* */
					}
				}
				clients.clear();
				await assistantHost?.dispose();
				await runtime.dispose();
			} catch (e) {
				console.error(`[pool] host dispose ${userId.slice(0, 8)}:`, e);
			}
		},
	};

	return host;
}
