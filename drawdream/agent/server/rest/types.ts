/**
 * DrawDream REST 宿主接口与公开类型（pi 止步于 user-host 实现侧）。
 */

import type { WorldlineView } from "../../src/worldline.ts";

export interface CurrentModelInfo {
	provider: string;
	id: string;
	name: string;
	thinkingLevel: string;
	availableLevels: string[];
	/** 当前模型上下文窗口（来自 models.json / 连接配置；默认 128000） */
	contextWindow: number;
	/** 单次最大输出（来自 models.json / 连接配置；缺省时 registry 用 16384） */
	maxTokens?: number;
}

export interface ModelInfo {
	provider: string;
	providerName: string;
	id: string;
	name: string;
	reasoning: boolean;
	/** 支持图片输入（上传图片可被该模型看见） */
	vision: boolean;
	contextWindow: number;
	maxTokens?: number;
}

export interface AuthProviderInfo {
	provider: string;
	displayName: string;
	/** 已写入 auth.json（可「移除已存 key」） */
	configured: boolean;
	/**
	 * 当前是否真正可用（stored / 环境变量已设 / runtime key 等）。
	 * 注意：pi 的 getAuthStatus().configured 对「仅环境变量」恒为 false，
	 * 列表展示必须以 ready 为准，否则 DeepSeek 等会沉进「未配置」。
	 */
	ready: boolean;
	/** 凭据来源（stored/environment/models_json_key…） */
	source?: string;
	/** 环境变量名等提示（如 DEEPSEEK_API_KEY） */
	label?: string;
	modelCount: number;
}

/** 运行时渠道快照（用于空配置时收编当前正在用的渠道） */
export interface ProviderRuntimeSnapshot {
	provider: string;
	baseUrl?: string;
	api?: string;
	/** 环境变量名（无 $），如 DEEPSEEK_API_KEY */
	envKey?: string;
	models: Array<{
		id: string;
		name?: string;
		reasoning?: boolean;
		contextWindow?: number;
		maxTokens?: number;
	}>;
}

export interface RestHost {
	cwd: string;
	isStreaming(): boolean;
	/**
	 * 广播 ServerFrame（如 forge_progress）。可选：无 WS 时忽略。
	 */
	broadcastFrame?(frame: import("./wire.ts").ServerFrame): void;
	listModels(): { current: CurrentModelInfo | null; models: ModelInfo[] };
	selectModel(provider: string, id: string): Promise<CurrentModelInfo>;
	setThinkingLevel(level: string): CurrentModelInfo;
	/**
	 * 显式探测指定模型（缺省当前默认模型）的真实思考档位，成功即缓存并应用最低档。
	 * 返回 reason：probe=探测成功 / cache=命中缓存 / no-config=渠道无 Key / no-reasoning=模型不支持 / probe-fail=探测失败。
	 */
	probeThinking(provider?: string, id?: string): Promise<{
		current: CurrentModelInfo;
		levels: string[];
		reason: string;
	}>;
	authProviders(): AuthProviderInfo[];
	setAuthKey(provider: string, key: string): void;
	removeAuth(provider: string): void;
	/** runtime agent 目录（同步用，不对用户暴露） */
	agentDir(): string;
	/** 取某 provider 的运行时模型/端点快照 */
	providerSnapshot(provider: string): ProviderRuntimeSnapshot | null;
	refreshModels(): void;
	/** 会话重载（session_start 重放，素材重装）+ 服务端显示名刷新 + 全端对齐 */
	reloadSession(): Promise<void>;
	/**
	 * 热更新：扩展内重读 config/卡/世界书/预设并重建 system prompt，不 session.reload。
	 * 用于切身份、改 user 设定、挂载世界书等——ST 式即时生效。
	 */
	softRefreshConfig(): Promise<void>;
	/** config.card 已写盘后调用：切到该卡最近会话，无则新建 */
	switchToCard(): Promise<"switched" | "created">;
	/** 经会话通道执行斜杠命令（/import 等，扩展的 notify 会以 wire notify 推送） */
	promptCommand(text: string): Promise<void>;
	/** 排队执行斜杠命令（不等待完成；流式中自动排到本轮结束）。返回是否进入了排队 */
	queueCommand(text: string): boolean;
	/** 面板导入：逐条领域层校验写入当前会话，返回成功数/成功名单/逐条错误 */
	importPanels(list: Array<{ name?: unknown; kind?: unknown; content?: unknown }>): {
		imported: number;
		names: string[];
		errors: string[];
	};
	/** 用户收起/删除面板（同 panel_close：归档出活跃列表，盘上保留，同名重写可重开） */
	closePanel(name: string): void;
	/** 当前剧情分支上挂载的知识库名（会话树 rp-codex 快照，随 rewind/fork 走） */
	mountedCodexes(): string[];
	// ---- 会话管理（PLAN-PANELS §2.1，main.ts 实现） ----
	sessions(): Promise<SessionInfoLite[]>;
	renameSession(path: string, name: string): Promise<void>;
	deleteSession(path: string): Promise<void>;
	/** 删除绑定某张卡的全部会话文件（删卡「相关数据」用；当前打开的会话不动） */
	deleteCardSessions(cardRel: string): Promise<number>;
	readSessionFile(path: string): Promise<string>;
	searchSessions(q: string): Promise<SessionSearchHit[]>;
	/** 世界状态用户主权编辑（applyPatch 语义，落盘+树快照经命令桥） */
	applyStatePatch(patch: Record<string, unknown>): { applied: string[]; warnings: string[] };
	notify(level: "info" | "warning" | "error", text: string): void;
	/** 世界线时间线视图（会话树 rp-save + 旁路 meta） */
	worldlineView(): WorldlineView;
	/** 软删除存档节点 */
	deleteWorldlineSave(saveId: string): void;
	/** 重命名世界线（自动名可改） */
	renameWorldline(worldlineId: string, name: string): void;
	/** 文生音并写入会话（气泡「配音」/ REST） */
	ttsSpeak(text: string, caption?: string): Promise<{ src: string; bytes: number }>;
	/** 导入 SillyTavern JSONL，保留原始消息 sidecar。 */
	importStChat(content: string, tag?: string): Promise<{ messages: number; warnings: string[] }>;
}

export interface SessionInfoLite {
	path: string;
	id: string;
	name?: string;
	firstMessage: string;
	modified: number;
	messageCount: number;
	current: boolean;
	preview?: string;
	cardName?: string;
	/** 会话绑定的角色卡相对路径（来自 rp-card；无则缺省） */
	cardPath?: string;
}

export interface SessionSearchHit {
	path: string;
	name?: string;
	firstMessage: string;
	modified: number;
	messageCount: number;
	snippet: string;
	current: boolean;
}
