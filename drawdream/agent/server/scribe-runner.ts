/**
 * 旁路账本抽取：agent_end 后用当前剧情模型跑一次 completeSimple，
 * 写 world state + turn summary（不进入用户可见正文）。
 */

import { join } from "node:path";
import { completeSimple } from "@drawdream/ai/compat";
import type { Model } from "@drawdream/ai";
import { dir } from "../src/paths.ts";
import { buildScribeTurnPrompt, parseScribeResult } from "../src/scribe.ts";
import { applyPatch, loadState, saveState } from "../src/state.ts";
import { appendSummary, countUserTurns } from "../src/turn-summary.ts";
import { appendDrawer, sessionWing } from "../src/palace.ts";
import { loadConfig } from "./rest/config.ts";
import type { WireNames } from "./wire.ts";

export type ScribeRunnerDeps = {
	getCwd: () => string;
	getSessionId: () => string;
	getModel: () => Model<string> | null | undefined;
	getApiKey: (model: Model<string>) => Promise<string | null>;
	getMessages: () => Array<{ role?: string; content?: unknown }>;
	getNames: () => WireNames;
	/** 落盘后回调（触发 watch / 推送） */
	onStateWritten?: () => void;
};

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const c of content) {
		if (c && typeof c === "object" && (c as { type?: string }).type === "text") {
			const t = (c as { text?: string }).text;
			if (typeof t === "string") parts.push(t);
		}
	}
	return parts.join("");
}

function lastTurnTexts(messages: Array<{ role?: string; content?: unknown }>): {
	userText: string;
	assistantText: string;
} {
	let userText = "";
	let assistantText = "";
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		const role = m?.role;
		if (!assistantText && role === "assistant") {
			assistantText = textFromContent(m.content).trim();
			continue;
		}
		if (assistantText && role === "user") {
			userText = textFromContent(m.content).trim();
			break;
		}
	}
	return { userText, assistantText };
}

let chain: Promise<void> = Promise.resolve();

/** fire-and-forget：串行执行，失败只打日志 */
export function scheduleScribeTurn(deps: ScribeRunnerDeps): void {
	chain = chain
		.then(async () => {
			try {
				await runScribeTurn(deps);
			} catch (err) {
				console.error(`[drawdream] scribe 失败：${err instanceof Error ? err.message : String(err)}`);
			}
		})
		.catch(() => {});
}

export async function runScribeTurn(deps: ScribeRunnerDeps): Promise<void> {
	const cwd = deps.getCwd();
	const config = loadConfig(cwd);
	const mode = config.pipeline?.mode ?? "merged";
	if (mode === "off") return;

	const model = deps.getModel();
	if (!model || model.provider === "unknown" || model.id === "unknown") return;

	const messages = deps.getMessages();
	const { userText, assistantText } = lastTurnTexts(messages);
	if (!assistantText || assistantText.length < 8) return;

	const apiKey = await deps.getApiKey(model);
	if (!apiKey) return;

	const sid = deps.getSessionId();
	const file = join(dir(cwd, "state"), `${sid}.json`);
	const state = loadState(file);
	const names = deps.getNames();
	const includeSummary = mode === "merged" || mode === "full";
	const turnNumber = countUserTurns(messages);

	const { systemPrompt, userText: promptUser } = buildScribeTurnPrompt(
		{
			state,
			userText: userText || "（开场/无用户句）",
			assistantText,
			charName: names.charName || "角色",
			userName: names.userName || "旅人",
		},
		{ includeSummary, turnNumber },
	);

	const result = await completeSimple(
		model as never,
		{
			systemPrompt,
			messages: [{ role: "user", content: promptUser }],
		},
		{ apiKey, maxTokens: 1200, temperature: 0.2 } as never,
	);

	const rawText = textFromContent(result?.content);
	const parsed = parseScribeResult(rawText);
	if (!parsed) return;

	const hasPatch = parsed.patch && Object.keys(parsed.patch).length > 0;
	if (hasPatch) {
		const { state: next } = applyPatch(state, parsed.patch);
		saveState(file, next);
		deps.onStateWritten?.();
	}

	if (includeSummary && parsed.summaryEntry) {
		const maxKeep = config.pipeline?.maxSummaries ?? 40;
		appendSummary(cwd, sid, { text: parsed.summaryEntry, turn: turnNumber }, maxKeep);
		// 自动总结固化进记忆（可被向量检索召回；摘要比长原文更适合语义召回）
		try {
			appendDrawer(cwd, {
				wing: sessionWing(sid),
				hall: "events",
				text: parsed.summaryEntry,
				source: "sweep",
				tags: [],
			});
		} catch {
			/* 记忆落盘失败不影响账本 */
		}
	}
}
