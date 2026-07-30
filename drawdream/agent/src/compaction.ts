/**
 * DrawDream 上下文压缩：长线 RP 接力摘要的提示词（纯函数）。
 * 使用叙事向结构（前情/人物/伏笔/事实/当前场景），避免 coding 模板把旧场景写成续写点。
 */

export interface RpSummaryPromptInput {
	/** 序列化后的待摘要对话文本 */
	conversationText: string;
	/** 当前世界状态快照（formatState 输出，辅助参考） */
	stateSnapshot: string;
	/** 上一次压缩的摘要（增量压缩时合并） */
	previousSummary?: string;
	/** 摘要输出语言 */
	language: string;
	/** 用户角色名 */
	userName: string;
}

export interface RpSummaryPrompt {
	systemPrompt: string;
	userText: string;
}

export function buildRpSummaryPrompt(input: RpSummaryPromptInput): RpSummaryPrompt {
	const { conversationText, stateSnapshot, previousSummary, language, userName } = input;

	const systemPrompt = `你是 DrawDream 的上下文接力摘要器。即将裁掉的早期对话需要浓缩成一份「前情」，供叙事模型在「本摘要 + 保留的最近对话」上继续写。

用${language}，按下列结构输出：

## 前情提要
按时间顺序写关键事件（谁做了什么、结果如何），保留剧内时间刻度。

## 人物
每位出场人物：性格要点、说话习惯、对${userName}的称呼、关系温度与变化。

## 承诺与伏笔
未兑现约定、一闪而过的线索、未决问题。宁多勿漏。

## 事实账
物品归属、伤势、重要数值、剧内时间线。

## 当前场景
以对话中**最新**场面为准：第几天、时段、地点、在场人物、正在发生的事。写成更早场景会导致续写倒退。

规则：只记对话中实际发生的事；不虚构、不评论、不续写；专有名词保持剧中写法。`;

	const parts: string[] = [`<conversation>\n${conversationText}\n</conversation>`];
	if (previousSummary) {
		parts.push(
			`<previous-summary>\n${previousSummary}\n</previous-summary>\n\n（上面是更早剧情的既有摘要：把它的内容合并进本次摘要，不要丢弃其中的承诺、伏笔与事实。）`,
		);
	}
	parts.push(`【工具账本快照】（辅助参考；记账可能滞后于正文，与对话记录冲突时以对话记录为准）\n${stateSnapshot}`);
	parts.push("请按系统指令输出接力摘要。");

	return { systemPrompt, userText: parts.join("\n\n") };
}

/**
 * 把会话消息序列化为摘要输入文本。只保留叙事正文（用户/助手/开场白），
 * 工具调用、结果与思考块不进入摘要输入。
 * 消息结构按 pi 的 AgentMessage 形状鸭子类型处理，本模块保持零 pi 依赖。
 */
export function serializeForSummary(messages: unknown[], userLabel: string, charLabel: string): string {
	const textOf = (content: unknown): string => {
		if (typeof content === "string") return content;
		if (!Array.isArray(content)) return "";
		return content
			.map((p) =>
				p && typeof p === "object" && (p as { type?: string }).type === "text"
					? String((p as { text?: unknown }).text ?? "")
					: "",
			)
			.filter(Boolean)
			.join("\n");
	};

	const lines: string[] = [];
	for (const m of messages as Array<{ role?: string; content?: unknown; customType?: string }>) {
		const text = textOf(m.content).trim();
		if (!text) continue;
		if (m.role === "user") lines.push(`${userLabel}：${text}`);
		else if (m.role === "assistant") lines.push(`${charLabel}：${text}`);
		else if (m.role === "custom" && m.customType === "rp-greeting") lines.push(`${charLabel}：${text}`);
	}
	return lines.join("\n\n");
}
