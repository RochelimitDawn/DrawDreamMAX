/** Novel Forge 领域类型 */

export type ForgeMode = "quick" | "standard" | "deep";

export type ForgeStage =
	| "queued"
	| "indexing"
	| "outlining"
	| "extracting"
	| "reducing"
	| "awaiting_cast"
	| "elevating"
	| "ready"
	| "applied"
	| "failed"
	| "cancelled";

/** 反向大纲草稿 */
export interface OutlineChapter {
	title: string;
	summary: string;
	castHints: string[];
	beats: string[];
}

export interface OutlineDraft {
	/** 全书一句话 */
	blurb?: string;
	themes: string[];
	conflicts: string[];
	chapters: OutlineChapter[];
	/** 来源：auto 反向大纲 / user 用户粘贴 */
	source?: "auto" | "user";
	updatedAt?: number;
}

/** 失败原因分类，便于 UI 与重试策略 */
export type ForgeErrorClass = "timeout" | "json" | "quota" | "unknown";

/** 用户确认的角色名单（awaiting_cast 工作台） */
export interface CastSelection {
	/** 主角规范名（合并表中的 name，或 manual 中的名） */
	protagonist: string;
	/** 参与制卡的角色名（应含主角；未勾选不生成） */
	selected: string[];
	/** 原名 → 展示名（制卡时用展示名） */
	renames: Record<string, string>;
	/** 用户手动添加、不在合并表中的角色名 */
	manual: string[];
}

export interface ForgeJobOptions {
	mode: ForgeMode;
	/** 快扫采样块数上限 */
	sampleChunks?: number;
	/** 单块最大字符数 */
	chunkChars?: number;
	/** 块间重叠 */
	chunkOverlap?: number;
	/** Map 并发 */
	concurrency?: number;
	/** 书名（展示/文件名） */
	title?: string;
	/** 用户确认的主角名；空则 elevate 用 Top1 */
	protagonist?: string;
	/** apply 时是否切换当前卡 */
	switchCard?: boolean;
	/** apply 时是否挂载世界书 */
	mountLore?: boolean;
	/** 是否为 cast 前列额外生成多张角色卡 */
	multiCard?: boolean;
	/** 额外卡数量上限（不含主角），默认 4 */
	multiCardLimit?: number;
	/** Map 提取用模型 id（可选，默认 defaultModel） */
	extractModel?: string;
	/** 升华用模型 id（可选） */
	elevateModel?: string;
	/** Map 渠道名（可选） */
	extractProvider?: string;
	/** 升华渠道名（可选） */
	elevateProvider?: string;
	/**
	 * 是否在 extract 前跑反向大纲。
	 * deep 默认 true；standard/quick 默认 false；显式 true/false 覆盖。
	 */
	enableOutline?: boolean;
	/** 用户提供的大纲正文（跳过自动反向大纲） */
	outlineText?: string;
}

/** 精研模式事件时间线 */
export interface TimelineEvent {
	title: string;
	order: number;
	summary: string;
	keys: string[];
	chapterHint?: string;
}

export interface ForgeChunkMeta {
	id: string;
	index: number;
	chars: number;
	preview: string;
	/** 章节标题（若有） */
	title?: string;
}

export interface CastMention {
	name: string;
	aliases: string[];
	roleHint: string;
	traits: string[];
	count: number;
	/** 出现过的 chunk index */
	chunks: number[];
}

export interface LoreDraftEntry {
	title: string;
	keys: string[];
	content: string;
	constant: boolean;
	order: number;
}

export interface ForgeProgress {
	stage: ForgeStage;
	percent: number;
	message: string;
	chunkTotal: number;
	chunkDone: number;
	error?: string;
	/** 失败分类 */
	errorClass?: ForgeErrorClass;
	/** 失败前所在阶段（用于续跑） */
	failedStage?: ForgeStage;
	updatedAt: number;
}

export function classifyForgeError(message: string): ForgeErrorClass {
	const m = message.toLowerCase();
	if (
		/timeout|timed?\s*out|etimedout|aborted|abort|超时/.test(m) ||
		/AbortError/i.test(message)
	) {
		return "timeout";
	}
	if (
		/json|parse|无法从模型输出|unexpected token|syntaxerror|解析/.test(m) ||
		/SyntaxError/i.test(message)
	) {
		return "json";
	}
	if (
		/quota|rate.?limit|429|insufficient|余额|额度|billing|too many requests|resource.?exhausted/.test(
			m,
		)
	) {
		return "quota";
	}
	return "unknown";
}

export interface ForgeJobMeta {
	id: string;
	createdAt: number;
	updatedAt: number;
	sourceName: string;
	sourceChars: number;
	options: ForgeJobOptions;
	stage: ForgeStage;
	/** apply 产物 */
	result?: {
		cardPath?: string;
		lorebookPath?: string;
		cardName?: string;
	};
}

export const DEFAULT_FORGE_OPTIONS: Required<
	Pick<
		ForgeJobOptions,
		| "mode"
		| "sampleChunks"
		| "chunkChars"
		| "chunkOverlap"
		| "concurrency"
		| "switchCard"
		| "mountLore"
		| "multiCard"
		| "multiCardLimit"
	>
> = {
	mode: "quick",
	sampleChunks: 24,
	chunkChars: 3500,
	chunkOverlap: 200,
	concurrency: 2,
	switchCard: true,
	mountLore: true,
	multiCard: false,
	multiCardLimit: 4,
};
