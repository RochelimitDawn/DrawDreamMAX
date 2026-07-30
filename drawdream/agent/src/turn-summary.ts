/**
 * 跨轮故事进度摘要（Turn Summary Store）。
 * 与 session compact 摘要区分：本文件面向流水线「故事进度列表」注入。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dir } from "./paths.ts";

export interface TurnSummary {
	turn: number;
	text: string;
	at: number;
}

function summariesFile(cwd: string, sessionId: string): string {
	const safe = sessionId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "default";
	return join(dir(cwd, "summaries"), `${safe}.jsonl`);
}

export function loadSummaries(cwd: string, sessionId: string): TurnSummary[] {
	const file = summariesFile(cwd, sessionId);
	if (!existsSync(file)) return [];
	const out: TurnSummary[] = [];
	for (const line of readFileSync(file, "utf8").split("\n")) {
		const t = line.trim();
		if (!t) continue;
		try {
			const o = JSON.parse(t) as Partial<TurnSummary>;
			if (typeof o.text === "string" && o.text.trim()) {
				out.push({
					turn: typeof o.turn === "number" && Number.isFinite(o.turn) ? o.turn : out.length + 1,
					text: o.text.trim(),
					at: typeof o.at === "number" ? o.at : Date.now(),
				});
			}
		} catch {
			/* skip bad line */
		}
	}
	return out;
}

export function appendSummary(
	cwd: string,
	sessionId: string,
	entry: { text: string; turn?: number },
	maxKeep = 40,
): TurnSummary[] {
	const text = entry.text.trim();
	if (!text) return loadSummaries(cwd, sessionId);

	const file = summariesFile(cwd, sessionId);
	mkdirSync(dir(cwd, "summaries"), { recursive: true });
	const existing = loadSummaries(cwd, sessionId);
	const turn = entry.turn ?? existing.length + 1;
	const row: TurnSummary = { turn, text, at: Date.now() };
	appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
	const all = [...existing, row];
	if (all.length > maxKeep) {
		const kept = all.slice(-maxKeep);
		writeFileSync(file, kept.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
		return kept;
	}
	return all;
}

/** 供 buildTurnInjection：置顶稳定列表正文 */
export function formatSummariesForInject(entries: TurnSummary[], maxLines = 24): string {
	if (!entries.length) return "";
	const slice = entries.length > maxLines ? entries.slice(-maxLines) : entries;
	return slice.map((e) => e.text).join("\n");
}

/** 从会话消息粗算已完成用户轮数（用于 turn 编号） */
export function countUserTurns(messages: Array<{ role?: string }>): number {
	return messages.filter((m) => m.role === "user").length;
}
