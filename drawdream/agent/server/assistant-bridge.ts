/**
 * 助手剧情桥 + 助手事件 → assistant_* wire 帧。
 * StoryBridge 只读剧情面 / 白名单写；onAssistantEvent 与剧情 subscribe 同构。
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

import { dir } from "../src/paths.ts";
import type { StoryBridge } from "./assistant.ts";
import type { RestHost } from "./rest.ts";
import {
	assistantMediaOfToolResult,
	summarizeToolResult,
	toAssistantHistory,
	type ServerFrame,
	type WireNames,
	type WireStats,
} from "./wire.ts";

export type AssistantBridgeStorySession = {
	sessionId: string;
	messages: unknown[];
	model: { provider: string; id: string } | null;
	thinkingLevel?: string;
	isStreaming: boolean;
};

export type StoryBridgeDeps = {
	getSession: () => AssistantBridgeStorySession;
	getNames: () => WireNames;
	safeStats: () => WireStats | null;
	currentState: () => import("../src/types.ts").WorldState;
	getRestHost: () => RestHost;
	getCwd: () => string;
};

export function createStoryBridge(deps: StoryBridgeDeps): StoryBridge {
	return {
		storyMessages: () => deps.getSession().messages as unknown[],
		snapshot: () => {
			const session = deps.getSession();
			const names = deps.getNames();
			return {
				sessionId: session.sessionId,
				cardName: names.charName,
				userName: names.userName,
				model: session.model ? { provider: session.model.provider, id: session.model.id } : null,
				thinkingLevel: typeof session.thinkingLevel === "string" ? session.thinkingLevel : undefined,
				contextPercent: deps.safeStats()?.contextPercent ?? null,
				messageCount: session.messages.length,
				streaming: session.isStreaming,
			};
		},
		queueStoryCommand: (text) => deps.getRestHost().queueCommand(text),
		worldState: () => deps.currentState(),
		applyStatePatch: (patch) => deps.getRestHost().applyStatePatch(patch),
		softRefreshConfig: () => deps.getRestHost().softRefreshConfig(),
		listModels: () => {
			const r = deps.getRestHost().listModels();
			return {
				current: r.current
					? { provider: r.current.provider, id: r.current.id, name: r.current.name }
					: null,
				models: r.models.map((m) => ({
					provider: m.provider,
					providerName: m.providerName,
					id: m.id,
					name: m.name,
					contextWindow: m.contextWindow,
				})),
			};
		},
		cardName: () => deps.getNames().charName,
		writePanels: (list) => deps.getRestHost().importPanels(list),
		deliverMedia: (absPath) => {
			try {
				if (!existsSync(absPath)) return { ok: false as const, error: `文件不存在：${absPath}` };
				const ext = extname(absPath).toLowerCase();
				const imageExt = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"];
				const audioExt = [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"];
				const videoExt = [".mp4", ".webm", ".mov", ".m4v", ".mkv", ".ogv"];
				const kind = imageExt.includes(ext)
					? "image"
					: audioExt.includes(ext)
						? "audio"
						: videoExt.includes(ext)
							? "video"
							: null;
				if (!kind) return { ok: false as const, error: `不支持的媒体格式：${ext || "（无扩展名）"}` };
				const mediaDir = dir(deps.getCwd(), "media");
				mkdirSync(mediaDir, { recursive: true });
				const name = `${createHash("md5").update(readFileSync(absPath)).digest("hex").slice(0, 16)}${ext}`;
				writeFileSync(join(mediaDir, name), readFileSync(absPath));
				return { ok: true as const, src: `/media/${name}`, kind };
			} catch (err) {
				return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
			}
		},
		refreshStoryMaterials: () => deps.getRestHost().softRefreshConfig(),
		mountCodex: (name, on) => {
			deps.getRestHost().queueCommand(`/codexmount ${on ? "mount" : "unmount"} ${name}`);
		},
	};
}

export type AssistantEvent = {
	type?: string;
	willRetry?: boolean;
	assistantMessageEvent?: { type?: string; delta?: string };
	message?: { role?: string };
	messages?: unknown[];
	toolName?: string;
	args?: unknown;
	result?: unknown;
	isError?: boolean;
	attempt?: number;
	maxAttempts?: number;
	todos?: Array<{ text: string; status: "pending" | "in_progress" | "done" | "cancelled" }>;
	subagents?: unknown[];
};

/** 助手会话事件 → assistant_* wire 帧 */
export function createAssistantEventHandler(
	broadcast: (frame: ServerFrame) => void,
): (event: unknown) => void {
	return (event: unknown) => {
		const ev = event as AssistantEvent;
		switch (ev.type) {
			case "agent_start":
				broadcast({ type: "assistant_state", state: "start" });
				break;
		case "todo_update":
			broadcast({ type: "assistant_todo", todos: Array.isArray(ev.todos) ? ev.todos : [] });
			break;
		case "subagent_update":
			broadcast({ type: "assistant_subagents", subagents: Array.isArray(ev.subagents) ? ev.subagents : [] });
			break;
		case "agent_end":
			if (!ev.willRetry) {
				const failed = (ev.messages ?? [])
					.slice()
					.reverse()
					.find(
						(m: { role?: string; stopReason?: string; errorMessage?: string }) =>
							m?.role === "assistant" && m.stopReason === "error",
					) as { stopReason?: string; errorMessage?: string } | undefined;
				if (failed) {
					const detail = (failed.errorMessage || "未知错误").trim();
					const friendly = /401|403|404|auth|api.?key|invalid|unauthorized|wrong.?api|model.?not.?found/i.test(detail)
						? `模型请求失败（可能是渠道 Key、接口地址或模型名配置问题）：${detail}。请到「设置 → API」检查。`
						: `模型请求失败：${detail}`;
					broadcast({ type: "error", text: friendly, errorClass: "unknown" });
				}
				broadcast({ type: "assistant_state", state: "end" });
			}
			break;
			case "message_update": {
				const e = ev.assistantMessageEvent;
				if (e?.type === "text_delta") broadcast({ type: "assistant_delta", kind: "text", delta: e.delta ?? "" });
				else if (e?.type === "thinking_delta")
					broadcast({ type: "assistant_delta", kind: "thinking", delta: e.delta ?? "" });
				break;
			}
			case "message_end": {
				if (ev.message?.role === "assistant") {
					const list = toAssistantHistory([ev.message]);
					if (list.length) broadcast({ type: "assistant_message", message: list[0] });
				} else if (ev.message?.role === "toolResult") {
					const media = assistantMediaOfToolResult(ev.message as never);
					if (media) broadcast({ type: "assistant_message", message: media });
				}
				break;
			}
			case "tool_execution_start": {
				let detail = "";
				let query = "";
				try {
					if (ev.args && typeof ev.args === "object" && typeof (ev.args as { query?: unknown }).query === "string") {
						query = (ev.args as { query: string }).query.trim().slice(0, 240);
					}
					detail = JSON.stringify(ev.args);
					if (detail.length > 120) detail = `${detail.slice(0, 120)}…`;
				} catch {
					// 参数不可序列化则留空
				}
				broadcast({
					type: "assistant_activity",
					activity: { kind: "tool_start", name: ev.toolName ?? "", detail, ...(query ? { query } : {}) },
				});
				break;
			}
			case "tool_execution_end":
				broadcast({
					type: "assistant_activity",
					activity: {
						kind: "tool_end",
						name: ev.toolName ?? "",
						detail: summarizeToolResult(ev.result),
						isError: ev.isError === true,
					},
				});
				break;
			case "auto_retry_start":
				broadcast({
					type: "notify",
					level: "warning",
					text: `助手模型请求失败，自动重试 ${ev.attempt}/${ev.maxAttempts}…`,
				});
				break;
			default:
				break;
		}
	};
}
