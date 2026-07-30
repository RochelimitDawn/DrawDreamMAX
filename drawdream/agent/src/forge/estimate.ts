/**
 * Forge 费用/调用量预估（不调用 LLM，仅按字数与模式估算）。
 * 含按篇幅/结构启发式的智能模式推荐。
 */

import type { ForgeMode } from "./types.ts";
import { DEFAULT_FORGE_OPTIONS } from "./types.ts";

export interface ForgeEstimateInput {
	sourceChars: number;
	mode: ForgeMode;
	sampleChunks?: number;
	chunkChars?: number;
	/** 额外制卡角色数（不含主角） */
	extraCards?: number;
	/** 可选正文样本，用于章节密度等结构信号（不必全文） */
	textSample?: string;
	/** 是否跑反向大纲（deep 默认 true） */
	enableOutline?: boolean;
	/** 已有用户大纲时不计自动大纲调用 */
	hasUserOutline?: boolean;
}

export interface ForgeModeRecommendation {
	mode: ForgeMode;
	/** 人读推荐理由 */
	reason: string;
	/** 0–1 粗置信 */
	confidence: number;
	/** 各档简要对照 */
	alternatives: Array<{ mode: ForgeMode; blurb: string }>;
}

export interface ForgeEstimate {
	sourceChars: number;
	mode: ForgeMode;
	/** 预估总分块数 */
	chunkTotal: number;
	/** 参与 Map 的块数 */
	mapChunks: number;
	/** Map 阶段 LLM 调用次数 */
	mapCalls: number;
	/** 反向大纲调用次数（分段摘要 + 合并） */
	outlineCalls: number;
	/** Elevate / 多卡 / 精研时间线等调用次数 */
	elevateCalls: number;
	/** 合计 LLM 调用 */
	totalCalls: number;
	/** 粗估输入 token（约 chars/1.5 中文） */
	approxInputTokens: number;
	/** 粗估输出 token */
	approxOutputTokens: number;
	/** 人读说明 */
	note: string;
	/** 预估墙钟分钟（并发 2 时粗估） */
	approxMinutes: number;
	/** 智能推荐模式（可与当前 mode 不同） */
	recommendedMode: ForgeMode;
	recommendReason: string;
	recommendConfidence: number;
	recommendAlternatives: Array<{ mode: ForgeMode; blurb: string }>;
}

/** 章节标题启发式（与 chunker 风格对齐，用于推荐） */
const CHAPTER_RE =
	/(?:^|\n)\s*(?:第[零〇一二三四五六七八九十百千两\d]+[章节回卷部集]|Chapter\s+\d+|CHAPTER\s+\d+)[^\n]{0,40}/gi;

/**
 * 按字数 + 可选结构信号推荐模式。
 * - 短篇：快扫足够试跑
 * - 中篇且有清晰分章：标准全量
 * - 长篇：默认快扫控费；分章极密且体量可控时升标准
 * - 精研仅在中长篇且分章清晰时作为可选建议（默认不强制选中）
 */
export function recommendForgeMode(
	sourceChars: number,
	textSample?: string,
): ForgeModeRecommendation {
	const chars = Math.max(0, Math.floor(sourceChars || 0));
	const sample = (textSample || "").slice(0, 120_000);
	const chapterHits = sample ? (sample.match(CHAPTER_RE) || []).length : 0;
	const sampleLen = Math.max(1, sample.length);
	// 章/万字密度；样本过短时用命中数兜底
	const density = sample.length > 2000 ? (chapterHits / sampleLen) * 10_000 : chapterHits > 2 ? 3 : 0;
	const structured = density >= 1.2 || chapterHits >= 5;

	const alts: Array<{ mode: ForgeMode; blurb: string }> = [
		{ mode: "quick", blurb: "采样快扫，费用低，适合试跑与超长篇首轮" },
		{ mode: "standard", blurb: "全量分块提取，设定更完整，费用随字数线性增长" },
		{ mode: "deep", blurb: "全量 + 时间线升华，剧情脉络更强，调用最多" },
	];

	if (chars === 0) {
		return {
			mode: "quick",
			reason: "尚未选择正文，默认快扫。",
			confidence: 0.4,
			alternatives: alts,
		};
	}

	if (chars < 25_000) {
		return {
			mode: "quick",
			reason: `约 ${(chars / 1000).toFixed(1)}k 字，篇幅较短，快扫即可覆盖主要角色与设定。`,
			confidence: 0.9,
			alternatives: alts,
		};
	}

	if (chars < 80_000) {
		if (structured) {
			return {
				mode: "standard",
				reason: `约 ${(chars / 1000).toFixed(1)}k 字且检测到较清晰分章（约 ${chapterHits} 处标题信号），建议标准全量提取。`,
				confidence: 0.85,
				alternatives: alts,
			};
		}
		return {
			mode: "quick",
			reason: `约 ${(chars / 1000).toFixed(1)}k 字，分章信号偏弱，建议先快扫；若设定残缺可改标准。`,
			confidence: 0.75,
			alternatives: alts,
		};
	}

	if (chars < 350_000) {
		if (structured) {
			return {
				mode: "standard",
				reason: `约 ${(chars / 1000).toFixed(0)}k 字的中长篇，分章结构清晰，标准全量更利于世界书完整度；精研可在入库前按需选用。`,
				confidence: 0.88,
				alternatives: alts,
			};
		}
		return {
			mode: "standard",
			reason: `约 ${(chars / 1000).toFixed(0)}k 字，已超短篇体量，建议标准全量；费用敏感时可改快扫试跑。`,
			confidence: 0.8,
			alternatives: alts,
		};
	}

	// 长篇 / 近百万字：默认快扫控费
	if (chars < 1_200_000) {
		return {
			mode: "quick",
			reason: `约 ${(chars / 10000).toFixed(1)} 万字长篇，全量 Map 费用与耗时显著上升，建议先快扫摸清角色与主设定；确认后再开标准/精研。`,
			confidence: 0.86,
			alternatives: alts,
		};
	}

	return {
		mode: "quick",
		reason: `约 ${(chars / 10000).toFixed(0)} 万字超长文本，强烈建议快扫控费与验证管线；标准/精研请在预算充足时再开。`,
		confidence: 0.92,
		alternatives: alts,
	};
}

function estimateChunkTotal(sourceChars: number, chunkChars: number): number {
	const c = Math.max(500, chunkChars);
	// 章节切分会略少，按窗口上界
	return Math.max(1, Math.ceil(sourceChars / (c * 0.85)));
}

function mapChunkCount(total: number, mode: ForgeMode, sampleChunks: number): number {
	if (mode === "quick") return Math.min(total, Math.max(1, sampleChunks));
	return total;
}

export function estimateForgeJob(input: ForgeEstimateInput): ForgeEstimate {
	const mode = input.mode || "quick";
	const sampleChunks = input.sampleChunks ?? DEFAULT_FORGE_OPTIONS.sampleChunks;
	const chunkChars = input.chunkChars ?? DEFAULT_FORGE_OPTIONS.chunkChars;
	const sourceChars = Math.max(0, Math.floor(input.sourceChars || 0));
	const chunkTotal = sourceChars === 0 ? 0 : estimateChunkTotal(sourceChars, chunkChars);
	const mapChunks = sourceChars === 0 ? 0 : mapChunkCount(chunkTotal, mode, sampleChunks);
	const mapCalls = mapChunks;
	const extraCards = Math.max(0, Math.min(12, Math.floor(input.extraCards ?? 0)));
	const wantOutline =
		typeof input.enableOutline === "boolean" ? input.enableOutline : mode === "deep";
	// 分段摘要最多 16 + 1 次合并；用户大纲跳过
	let outlineCalls = 0;
	if (sourceChars > 0 && wantOutline && !input.hasUserOutline) {
		outlineCalls = Math.min(16, Math.max(1, mapChunks)) + 1;
	}
	// 主角升华 1 + 可选多卡 + deep 时间线 1
	let elevateCalls = sourceChars === 0 ? 0 : 1 + extraCards;
	if (mode === "deep" && sourceChars > 0) elevateCalls += 1;
	const totalCalls = mapCalls + outlineCalls + elevateCalls;

	// 中文约 1.5 字/token；Map 输入≈块长+prompt，输出≈800 token
	const mapIn = mapChunks * (chunkChars + 400);
	const outlineIn = outlineCalls * 4000;
	const elevateIn = elevateCalls * 6000;
	const approxInputTokens = Math.round((mapIn + outlineIn + elevateIn) / 1.5);
	const approxOutputTokens = mapChunks * 900 + outlineCalls * 600 + elevateCalls * 2500;
	const approxMinutes = Math.max(
		0.1,
		Math.round(((mapCalls * 8 + outlineCalls * 10 + elevateCalls * 25) / 60) * 10) / 10,
	);

	const rec = recommendForgeMode(sourceChars, input.textSample);

	const noteParts = [
		`模式 ${mode}：约 ${mapChunks} 次分块提取` +
			(outlineCalls ? ` + ${outlineCalls} 次大纲` : "") +
			` + ${elevateCalls} 次升华类调用（共 ${totalCalls} 次）。`,
		`粗估输入 ~${Math.round(approxInputTokens / 1000)}k token、输出 ~${Math.round(approxOutputTokens / 1000)}k token。`,
		`按并发 2、单次约数秒～数十秒，墙钟约 ${approxMinutes} 分钟（实际随模型与限流变化）。`,
	];
	if (mode === "standard" || mode === "deep") {
		noteParts.push("标准/精研为全量 Map，长篇费用明显高于快扫。");
	}
	if (wantOutline && !input.hasUserOutline) {
		noteParts.push("含反向大纲分段摘要与合并，deep 默认开启。");
	}
	if (input.hasUserOutline) {
		noteParts.push("已提供用户大纲，跳过自动反向大纲调用。");
	}
	if (rec.mode !== mode) {
		noteParts.push(`智能推荐：${rec.mode}（${rec.reason}）`);
	}

	return {
		sourceChars,
		mode,
		chunkTotal,
		mapChunks,
		mapCalls,
		outlineCalls,
		elevateCalls,
		totalCalls,
		approxInputTokens,
		approxOutputTokens,
		note: noteParts.join(" "),
		approxMinutes,
		recommendedMode: rec.mode,
		recommendReason: rec.reason,
		recommendConfidence: rec.confidence,
		recommendAlternatives: rec.alternatives,
	};
}
