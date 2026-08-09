/**
 * DrawDream 账本抽取：旁侧模型在每轮结束后从正文提取世界状态补丁（纯函数）。
 * 产出为结构化数据，不改写用户可见叙事。
 */

import type { WorldState } from "./types.ts";

export interface ScribePromptInput {
	/** 当前世界状态（JSON 序列化前的对象） */
	state: WorldState;
	/** 本轮用户输入文本 */
	userText: string;
	/** 本轮助手正文（最终叙事文本） */
	assistantText: string;
	/** 主要角色名（账本规范名提示） */
	charName: string;
	/** 用户角色名 */
	userName: string;
	/**
	 * @deprecated 已不再做先斩后奏检测；保留字段以免旧调用方报错，忽略。
	 */
	detectUnaskedTurn?: boolean;
}

export interface ScribeResult {
	/** 状态补丁（applyPatch 语义），无变化为 {} */
	patch: Record<string, unknown>;
	/** 恒为空：连续性审查已关闭 */
	warnings: string[];
	/** 恒为 null：先斩后奏审查已关闭 */
	unaskedTurn: string | null;
	/**
	 * 本轮故事进度摘要（merged 流水线）：
	 * 格式建议「[第N轮] 用户意图：… | 叙事要点：…」；无则 null
	 */
	summaryEntry: string | null;
}

export interface ScribePromptOptions {
	/**
	 * 是否要求同时产出跨轮故事摘要（pipeline.mode=merged/full）。
	 * off 时仅 patch，与历史行为一致。
	 */
	includeSummary?: boolean;
	/** 当前用户轮序号（写入摘要前缀；缺省时模型可写「本轮」） */
	turnNumber?: number;
}

export function buildScribeTurnPrompt(
	input: ScribePromptInput,
	opts?: ScribePromptOptions,
): { systemPrompt: string; userText: string } {
	const { state, userText, assistantText, charName, userName } = input;
	const knownCharacters = Object.keys(state.characters);
	const nameGuide = knownCharacters.length
		? `名字必须使用账本中已有的写法（当前已有：${knownCharacters.join("、")}；用户角色「${userName}」）`
		: `用户角色写作「${userName}」`;
	const includeSummary = opts?.includeSummary === true;
	const turnLabel =
		typeof opts?.turnNumber === "number" && Number.isFinite(opts.turnNumber) && opts.turnNumber > 0
			? `第${Math.floor(opts.turnNumber)}轮`
			: "本轮";

	const summaryBlock = includeSummary
		? `
"summary_entry"：将${turnLabel}压缩为一条进度摘要字符串，格式严格为：
[第N轮] 用户意图：xxx | 叙事要点：yyy
要求：用户意图一句话；叙事要点保留影响后续理解的事实（事件、状态变化、线索、约定），把用户写成剧中角色而非「用户」；无进展时可写极短句，不要省略该字段。`
		: "";

	const systemPrompt = `你是 DrawDream 的世界状态抽取器。阅读【当前账本】与【本轮对话】，只输出 JSON，记录需要持久化的变化${includeSummary ? "，并压缩本轮进度" : ""}。

字段：
"patch"：本轮需记账的持久变化。
- "time" / "location" / "chapter"：字符串，整体替换。剧内时间推移必须更新 time；换幕/换章时更新 chapter（章节或幕次标题，如「第一章 · 听雨」）。
- "characters"：{ "名字": { "affinity"?, "status"?, "notes"? } }，按字段合并。affinity 为 -100..100 对${userName}的态度，相对当前值小步调整（通常 ±1~10）。${nameGuide}；仅全新出场人物建条目，键用人名，勿把作品标题「${charName}」当角色名。
- "inventory"：字符串数组，整体替换；仅在归属变化时给出完整清单，并注明持有者。
- "flags"：字符串键值，按键合并。
- "plot_threads"：字符串数组，整体替换；新增或了结线索时给出完整清单。
否定性事件也要记（拒礼、收回承诺等）；无变化的字段不要出现；完全无变化则 "patch": {}。
${summaryBlock}
只输出 JSON，例如 ${includeSummary ? `{"patch":{...},"summary_entry":"[${turnLabel}] 用户意图：… | 叙事要点：…"}` : `{"patch":{...}}`}。不要 warnings 或其他文字。`;

	const user = `【当前账本】
${JSON.stringify(state, null, 2)}

【本轮对话】
${userName}：${userText}

${charName}：${assistantText}`;

	return { systemPrompt, userText: user };
}

/** 宽容解析账本 JSON：剥代码围栏、截取首个对象；失败返回 null */
export function parseScribeResult(text: string): ScribeResult | null {
	let t = text.trim();
	const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fence) t = fence[1].trim();
	const start = t.indexOf("{");
	const end = t.lastIndexOf("}");
	if (start === -1 || end <= start) return null;
	try {
		const obj = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
		const patch =
			obj.patch && typeof obj.patch === "object" && !Array.isArray(obj.patch)
				? (obj.patch as Record<string, unknown>)
				: {};
		let summaryEntry: string | null = null;
		const se = obj.summary_entry ?? obj.summaryEntry;
		if (typeof se === "string" && se.trim()) summaryEntry = se.trim();
		else if (Array.isArray(obj.summary_entries) && typeof obj.summary_entries[0] === "string") {
			summaryEntry = (obj.summary_entries[0] as string).trim() || null;
		}
		// 审查字段一律丢弃（即使旧模型仍返回）
		return { patch, warnings: [], unaskedTurn: null, summaryEntry };
	} catch {
		return null;
	}
}

// ---------- 世界书中文别名（修复：专有名词中译后英文关键词地板失效） ----------

export interface AliasEntryInput {
	uid: number;
	keys: string[];
	comment: string;
	/** 正文摘录（截断后），供理解条目指代什么 */
	excerpt: string;
}

export function buildLoreAliasPrompt(
	entries: AliasEntryInput[],
	language: string,
): { systemPrompt: string; userText: string } {
	const systemPrompt = `你是 DrawDream 世界书别名生成器。为下列条目生成${language}检索别名，用于在${language}叙事中做关键词匹配。覆盖常见意译、音译、职称（每条 2~5 个，单个别名宜 2~6 字）。避免过宽泛词（如单独出现的「建筑」「怪物」），除非条目本身即该范畴。
只输出 JSON：{ "<uid>": ["别名1", "别名2", ...], ... }，无其他文字。`;

	const userText = entries
		.map((e) => `uid=${e.uid} keys=[${e.keys.join(", ")}] 标题=${e.comment || "（无）"}\n摘要：${e.excerpt}`)
		.join("\n\n");

	return { systemPrompt, userText };
}

/** 解析别名输出：{ uid: string[] }；解析失败返回 null */
export function parseLoreAliases(text: string): Map<number, string[]> | null {
	let t = text.trim();
	const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fence) t = fence[1].trim();
	const start = t.indexOf("{");
	const end = t.lastIndexOf("}");
	if (start === -1 || end <= start) return null;
	try {
		const obj = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
		const map = new Map<number, string[]>();
		for (const [k, v] of Object.entries(obj)) {
			const uid = Number(k);
			if (!Number.isFinite(uid) || !Array.isArray(v)) continue;
			const aliases = v.filter((a): a is string => typeof a === "string" && a.trim().length > 0).map((a) => a.trim());
			if (aliases.length) map.set(uid, aliases);
		}
		return map;
	} catch {
		return null;
	}
}
