/**
 * DrawDream 领域层共享类型（本目录不 import agent runtime）。
 */

/** 归一化后的角色卡（兼容 V1 / V2 chara_card_v2 / V3 chara_card_v3 / ST 导出格式） */
export interface CharacterCard {
	name: string;
	description: string;
	personality: string;
	scenario: string;
	firstMes: string;
	mesExample: string;
	/** 卡作者自带的 system prompt（规范语义：非空时优先于应用默认主提示） */
	systemPrompt: string;
	/** 卡作者的 post-history instructions（注入上下文末端） */
	postHistoryInstructions: string;
	creatorNotes: string;
	alternateGreetings: string[];
	tags: string[];
	/** 卡内嵌世界书（character_book），已归一化 */
	book: LorebookEntry[];
	/** 酒馆卡 extensions 的无损兼容投影。 */
	compat?: CharacterCardCompat;
	/** 由无损 extensions 静态分析得到的运行时清单。 */
	runtimeManifest?: TavernRuntimeManifest;
}

export interface CardRegexScript {
	id: string;
	scriptName: string;
	findRegex: string;
	replaceString: string;
	trimStrings: string[];
	placement: number[];
	disabled: boolean;
	markdownOnly: boolean;
	promptOnly: boolean;
	runOnEdit: boolean;
	minDepth?: number;
	maxDepth?: number;
}

export interface CharacterCardCompat {
	regexScripts: CardRegexScript[];
	unknownExtensions: Record<string, unknown>;
}

export type RuntimeDiagnosticLevel = "info" | "warning" | "error";

export interface RuntimeDiagnostic {
	code: string;
	level: RuntimeDiagnosticLevel;
	message: string;
	path?: string;
}

export interface TavernRuntimeManifest {
	version: 1;
	cardFingerprint: string;
	requiredCapabilities: string[];
	regexScripts: CardRegexScript[];
	extensionScripts: Record<string, unknown>[];
	externalModules: Array<{ url: string; hash?: string }>;
	placeholders: string[];
	worldBooks: string[];
	initialVariables: Record<string, unknown>;
	diagnostics: RuntimeDiagnostic[];
}

/** 归一化后的世界书条目（兼容 ST world info 格式与卡内嵌 character_book 格式） */
export interface LorebookEntry {
	uid: number;
	keys: string[];
	secondaryKeys: string[];
	comment: string;
	content: string;
	constant: boolean;
	enabled: boolean;
	/** 是否要求次要关键词也命中（AND_ANY 语义，v0 仅实现该逻辑） */
	selective: boolean;
	order: number;
}

/** 结构化世界状态（v0 schema，可扩展） */
export interface WorldState {
	/** 剧情内时间，自由文本（如「第二天清晨」） */
	time: string;
	/** 当前地点 */
	location: string;
	/**
	 * 当前章节/幕次标题（如「第一章 · 听雨」「第三幕」）。
	 * 粘性章节条优先读取本字段；换幕时与 time/location 一并 world_state_update。
	 */
	chapter: string;
	/** 出场角色状态，键为角色名 */
	characters: Record<string, CharacterState>;
	/** {{user}} 的物品栏 */
	inventory: string[];
	/** 自由键值对（誓言、秘密、天气等） */
	flags: Record<string, string>;
	/** 未了结的剧情线/伏笔 */
	plot_threads: string[];
}

export interface CharacterState {
	/** 对 {{user}} 的好感/态度，-100..100 */
	affinity: number;
	/** 当前身体/处境状态 */
	status: string;
	/** 备注（承诺、得知的秘密等） */
	notes: string;
}

/** 项目配置（app/drawdream.config.json） */
export interface RpConfig {
	/** 角色卡路径（.png 或 .json），相对项目根 */
	card: string;
	/**
	 * 已挂载的独立世界书路径列表（可 0..N 本同时启用；与角色卡无关，换卡不清除）。
	 * 装配顺序即数组合序；条目按内容指纹去重。
	 */
	lorebooks?: string[];
	/**
	 * @deprecated 旧版单本挂载；读时迁入 lorebooks，写盘时只保留 lorebooks。
	 */
	lorebook?: string;
	/** {{user}} 的名字 */
	userName: string;
	/** Web 顶栏的角色显示名覆盖（可选；不影响 {{char}} 宏与提示词，仅显示层。适用于卡 name 是剧本标题的场景卡） */
	displayName?: string;
	/** {{user}} 的人设描述（可选） */
	userPersona: string;
	/** 回复语言 */
	language: string;
	/** 关键词扫描回溯的消息条数 */
	scanDepth: number;
	/** 每轮关键词自动注入的条目上限 */
	maxLoreInjections: number;
	/** 是否在新会话注入开场白 */
	greeting: boolean;
	/** 开场白选择：0=卡的 first_mes（默认），1..n=alternate_greetings 第 n 条；越界回落 first_mes */
	greetingIndex?: number;
	/** 被用户停用的世界书条目（内容指纹列表，见 lorebook.ts loreFingerprint；跨 uid 冲突稳定） */
	disabledLore?: string[];
	/** /import 清洗时额外剥离的标签（叠加在默认思维链/状态栏列表之上，按预设约定配置） */
	importStripTags?: string[];
	/** 转换后的预设文件路径（drawdream-preset.json，可选；由 scripts/convert-preset.mjs 生成） */
	preset?: string;
	/** 本机工具总开关：开则 bash/读写等回到工具底座；本机开发默认开，分发默认关 */
	backendControl?: boolean;
	/** 抉择门禁：ask=关键分岔停笔询问；silent=不问。默认 ask */
	creationMode?: "ask" | "silent";
	/**
	 * 叙事正文字数目标（只计用户可见叙事，不含草稿/状态栏）。
	 * 每轮注入提示；hardCap 开启时超限后下一轮强制纠正。
	 */
	narrativeLength?: {
		/** 下限，默认 400 */
		min?: number;
		/** 上限，默认 900 */
		max?: number;
		/** 是否在超限后下一轮注入纠正（默认 true） */
		hardCap?: boolean;
	};
	/**
	 * 助手独立模型；缺省跟随叙事模型。尺度较大时可单独指定更宽容的模型。
	 */
	assistantModel?: { provider: string; id: string };
	/**
	 * 叙事流水线：
	 * - off：仅账本 patch
	 * - merged：patch + 跨轮故事摘要注入（默认）
	 * - full：预留多阶段流水线（当前等同 merged）
	 */
	pipeline?: {
		mode?: "off" | "merged" | "full";
		/** 注入的故事摘要最多保留条数（默认 40） */
		maxSummaries?: number;
	};
	/**
	 * 智能搜索（Tavily POST /search）。
	 * 剧情工具 smart_search 读取此配置；apiKey 必填（tvly-…）。
	 * 文档：https://docs.tavily.com/welcome
	 */
	smartSearch?: {
		enabled?: boolean;
		apiKey?: string;
		/** 默认 https://api.tavily.com */
		baseUrl?: string;
		searchDepth?: "basic" | "advanced" | "fast" | "ultra-fast";
		topic?: "general" | "news" | "finance";
		/** @deprecated 简报已永久关闭 */
		includeAnswer?: boolean;
		/** @deprecated 配图已永久关闭 */
		includeImages?: boolean;
		/** simple=单次 Tavily；multi=多路+RRF */
		mode?: "simple" | "multi";
		maxQueries?: number;
	};
	/** 按角色卡 Runtime Manifest fingerprint 隔离的外部模块授权。 */
	tavernModuleGrants?: Record<string, string[]>;
}

/** 叙事流水线默认：merged */
export const DEFAULT_PIPELINE = {
	mode: "merged" as const,
	maxSummaries: 40,
};

export const DEFAULT_CONFIG: RpConfig = {
	// 产品包示例卡种子落盘为 ASCII 名；空库 seed 后 ensureUserWorkspace 会改写为实际第一张
	card: "assets/cards/sample-card.png",
	// 默认挂载 RP Tok UI 说明书：为用户世界书功能做功能指引，介绍白名单组件用法
	lorebooks: [],
	userName: "旅人",
	userPersona: "",
	language: "中文",
	scanDepth: 4,
	maxLoreInjections: 3,
	greeting: true,
	// 默认关闭本机 bash/read：产品路径是直接对话；可信设备可在设置里打开
	backendControl: false,
	// 默认询问档：关键分岔走选择卡
	creationMode: "ask",
	// 默认叙事字数 400–900
	narrativeLength: { min: 400, max: 900, hardCap: true },
	pipeline: { ...DEFAULT_PIPELINE },
};

/** 宏替换上下文 */
export interface MacroContext {
	charName: string;
	userName: string;
}
