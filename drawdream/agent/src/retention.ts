/**
 * DrawDream 上下文剪辑：磁盘会话保留全量；送入 LLM 的上下文每轮重新裁剪。
 *
 * 已闭合轮次去掉工具残渣与思考块，只留叙事正文；当前轮原样保留（工具循环不可截断）。
 * 助手场外轮：最近一个闭合轮整轮保留；更早的场外轮只留用户句与最终报告。
 * 纯函数，不依赖 runtime 类型。
 */

import { isBackstageText } from "./stance.ts";

export interface PruneStats {
	messagesBefore: number;
	messagesAfter: number;
	charsBefore: number;
	charsAfter: number;
	droppedToolResults: number;
	droppedToolCallBlocks: number;
	droppedThinkingBlocks: number;
	droppedEmptyAssistant: number;
	/** 旧场外轮中被整条裁掉的中间叙述（最终报告之外的 assistant 正文） */
	droppedBackstageNarration: number;
}

interface PartLike {
	type?: unknown;
	text?: unknown;
}

interface MsgLike {
	role?: unknown;
	content?: unknown;
}

const emptyStats = (messages: unknown[]): PruneStats => ({
	messagesBefore: messages.length,
	messagesAfter: messages.length,
	charsBefore: 0,
	charsAfter: 0,
	droppedToolResults: 0,
	droppedToolCallBlocks: 0,
	droppedThinkingBlocks: 0,
	droppedEmptyAssistant: 0,
	droppedBackstageNarration: 0,
});

function textOf(m: MsgLike): string {
	if (typeof m.content === "string") return m.content;
	if (!Array.isArray(m.content)) return "";
	return (m.content as PartLike[])
		.map((p) => (p && typeof p.text === "string" ? p.text : ""))
		.join("\n");
}

function hasText(m: MsgLike): boolean {
	if (typeof m.content === "string") return m.content.trim().length > 0;
	if (!Array.isArray(m.content)) return false;
	return (m.content as PartLike[]).some((p) => p?.type === "text" && typeof p.text === "string" && p.text.trim().length > 0);
}

export function pruneClosedTurns<T extends MsgLike>(messages: T[]): { messages: T[]; stats: PruneStats } {
	// 边界 = 最后一条真实用户消息；它之前的轮次视为已闭合
	let boundary = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "user") {
			boundary = i;
			break;
		}
	}
	if (boundary <= 0) {
		return { messages, stats: emptyStats(messages) };
	}

	// 已闭合轮次划分：每条用户消息开启一轮，[start, nextStart) ；boundary 前最后一个场外轮享受整轮保留
	interface Turn {
		start: number;
		end: number;
		backstage: boolean;
	}
	const turns: Turn[] = [];
	for (let i = 0; i < boundary; i++) {
		if (messages[i].role === "user") {
			if (turns.length > 0) turns[turns.length - 1].end = i;
			turns.push({ start: i, end: boundary, backstage: isBackstageText(textOf(messages[i])) });
		}
	}
	const lastBackstage = [...turns].reverse().find((t) => t.backstage);
	// 旧场外轮 → 该轮唯一保留的 assistant（最终报告）索引
	const finalReportOf = new Map<Turn, number>();
	for (const t of turns) {
		if (!t.backstage || t === lastBackstage) continue;
		let last = -1;
		for (let i = t.start + 1; i < t.end; i++) {
			if (messages[i].role === "assistant" && hasText(messages[i])) last = i;
		}
		finalReportOf.set(t, last);
	}

	const stats = emptyStats(messages);
	stats.charsBefore = JSON.stringify(messages).length;

	const out: T[] = [];
	let turnIdx = -1; // 当前所在轮（-1 = 首条用户消息之前的开场区）
	for (let i = 0; i < messages.length; i++) {
		const m = messages[i];
		if (i >= boundary) {
			out.push(m);
			continue;
		}
		while (turnIdx + 1 < turns.length && turns[turnIdx + 1].start === i) turnIdx++;
		const turn = turnIdx >= 0 ? turns[turnIdx] : undefined;

		// 最近的场外轮：整轮原样保留（工具循环成对保留，不做块级裁剪）
		if (turn && turn === lastBackstage) {
			out.push(m);
			continue;
		}
		// 旧场外轮：只留用户消息与最终报告
		if (turn?.backstage) {
			if (m.role === "user") {
				out.push(m);
				continue;
			}
			if (m.role === "toolResult") {
				stats.droppedToolResults++;
				continue;
			}
			if (m.role === "assistant") {
				if (i !== finalReportOf.get(turn)) {
					if (hasText(m)) stats.droppedBackstageNarration++;
					else stats.droppedEmptyAssistant++;
					continue;
				}
				out.push(stripAssistant(m, stats));
				continue;
			}
			out.push(m); // custom 注入等照旧
			continue;
		}

		// 剧情轮（及开场区）：工具/思考裁剪
		if (m.role === "toolResult") {
			stats.droppedToolResults++;
			continue;
		}
		if (m.role === "assistant" && Array.isArray(m.content)) {
			const kept = stripAssistant(m, stats);
			if (!hasText(kept)) {
				// 纯工具轮（无正文）整条丢弃：其效果已沉淀在状态快照与后续正文里
				stats.droppedEmptyAssistant++;
				continue;
			}
			out.push(kept);
			continue;
		}
		out.push(m);
	}

	stats.messagesAfter = out.length;
	stats.charsAfter = JSON.stringify(out).length;
	return { messages: out, stats };
}

/** 剥掉 assistant 消息中的 toolCall 与 thinking 块（正文保留） */
function stripAssistant<T extends MsgLike>(m: T, stats: PruneStats): T {
	if (!Array.isArray(m.content)) return m;
	const kept = (m.content as PartLike[]).filter((p) => {
		if (p?.type === "toolCall") {
			stats.droppedToolCallBlocks++;
			return false;
		}
		if (p?.type === "thinking") {
			stats.droppedThinkingBlocks++;
			return false;
		}
		return true;
	});
	return { ...m, content: kept };
}

export function formatPruneStats(s: PruneStats): string {
	const saved = s.charsBefore > 0 ? Math.round(((s.charsBefore - s.charsAfter) / s.charsBefore) * 100) : 0;
	return (
		`msgs ${s.messagesBefore}→${s.messagesAfter}, chars ${s.charsBefore}→${s.charsAfter} (-${saved}%), ` +
		`dropped: ${s.droppedToolResults} toolResults, ${s.droppedToolCallBlocks} toolCalls, ` +
		`${s.droppedThinkingBlocks} thinking, ${s.droppedEmptyAssistant} emptyAssistant, ` +
		`${s.droppedBackstageNarration} backstageNarration`
	);
}
