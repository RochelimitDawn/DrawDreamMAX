/**
 * 剧情会话事件 → wire 帧广播。
 * bindSession 时挂到 session.subscribe；与助手侧 onAssistantEvent 对称。
 */

import {
	summarizeToolResult,
	toWireMsg,
	type ServerFrame,
	type WireNames,
	type WireStats,
} from "./wire.ts";

export type StorySubscribeDeps = {
	broadcast: (frame: ServerFrame) => void;
	resyncAll: () => void;
	safeStats: () => WireStats | null;
	getNames: () => WireNames;
	/** 轮次结束旁路记账（可选） */
	onAgentEnd?: () => void;
};

/** pi session 事件（仅订阅用到的字段） */
export type StorySessionEvent = {
	type?: string;
	willRetry?: boolean;
	assistantMessageEvent?: { type?: string; delta?: string };
	message?: unknown;
	messages?: unknown[];
	toolName?: string;
	args?: unknown;
	result?: unknown;
	isError?: boolean;
	attempt?: number;
	maxAttempts?: number;
	errorMessage?: string;
	aborted?: boolean;
	success?: boolean;
	finalError?: string;
};

export function createStoryEventHandler(deps: StorySubscribeDeps): (event: StorySessionEvent) => void {
	let generationNumber = 0;
	let generationId: string | null = null;
	const emitGeneration = (frame: Extract<ServerFrame, { type: "generation" }>) => deps.broadcast(frame);

	return (event) => {
		switch (event.type) {
			case "agent_start":
				generationId = `generation-${++generationNumber}`;
				emitGeneration({ type: "generation", generationId, phase: "start" });
				deps.broadcast({ type: "agent", state: "start" });
				break;
			case "agent_end":
				if (!event.willRetry) {
					// 模型请求失败（stopReason=error 且无可显示正文）时，wire 会过滤空文本
					// 消息，导致前端「无输出无提示」静默结束。这里显式广播失败原因。
					const failed = (event.messages ?? [])
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
						deps.broadcast({ type: "error", text: friendly, errorClass: "unknown" });
						deps.broadcast({ type: "stream", state: "clear" });
						deps.broadcast({ type: "agent", state: "end" });
						deps.resyncAll();
						try {
							deps.onAgentEnd?.();
						} catch {
							/* scribe 不得打断主流程 */
						}
						return;
					}
					const id = generationId ?? `generation-${++generationNumber}`;
					emitGeneration({
						type: "generation",
						generationId: id,
						phase: "end",
						outcome: event.aborted ? "aborted" : "completed",
					});
					deps.broadcast({ type: "agent", state: "end" });
					const stats = deps.safeStats();
					if (stats) deps.broadcast({ type: "stats", stats });
					// 挂上 swipe 序号（流式 message 帧无树元数据）
					deps.resyncAll();
					try {
						deps.onAgentEnd?.();
					} catch {
						/* scribe 不得打断主流程 */
					}
				}
				break;
			case "message_update": {
				const e = event.assistantMessageEvent;
				if (e?.type === "text_delta") deps.broadcast({ type: "delta", kind: "text", delta: e.delta ?? "" });
				else if (e?.type === "thinking_delta")
					deps.broadcast({ type: "delta", kind: "thinking", delta: e.delta ?? "" });
				break;
			}
			case "message_end": {
				const wire = toWireMsg(event.message as never, deps.getNames());
				// user 消息在 prompt 受理时已回显，这里跳过防重
				if (wire && wire.channel !== "user") {
					deps.broadcast({ type: "message", message: wire });
				}
				// 中间 tool 轮没有可展示正文时保持已有流式气泡；最终 assistant message
				// 到达后由客户端按 stream id 原子替换，避免闪屏和内容回退。
				break;
			}
			case "tool_execution_start": {
				let detail = "";
				let query = "";
				try {
					if (event.args && typeof event.args === "object" && typeof (event.args as { query?: unknown }).query === "string") {
						query = (event.args as { query: string }).query.trim().slice(0, 240);
					}
					detail = JSON.stringify(event.args);
					if (detail.length > 120) detail = `${detail.slice(0, 120)}…`;
				} catch {
					// 参数不可序列化则留空
				}
				deps.broadcast({
					type: "activity",
					activity: { kind: "tool_start", name: event.toolName ?? "", detail, ...(query ? { query } : {}) },
				});
				break;
			}
			case "tool_execution_end":
				deps.broadcast({
					type: "activity",
					activity: {
						kind: "tool_end",
						name: event.toolName ?? "",
						detail: summarizeToolResult(event.result),
						isError: event.isError === true,
					},
				});
				break;
			case "compaction_start":
				deps.broadcast({ type: "compaction", state: "start" });
				break;
			case "compaction_end":
				deps.broadcast({
					type: "compaction",
					state: "end",
					ok: !event.aborted && !event.errorMessage,
				});
				deps.resyncAll();
				break;
			case "auto_retry_start":
				if (generationId) {
					emitGeneration({
						type: "generation",
						generationId,
						phase: "retry",
						attempt: event.attempt,
					});
				}
				deps.broadcast({
					type: "notify",
					level: "warning",
					text: `模型请求失败，自动重试 ${event.attempt}/${event.maxAttempts}…${event.errorMessage ? `（${event.errorMessage}）` : ""}`,
				});
				break;
			case "auto_retry_end": {
				if (event.success) {
					if ((event.attempt ?? 0) > 1) {
						deps.broadcast({
							type: "notify",
							level: "info",
							text: `模型请求已恢复（第 ${event.attempt} 次尝试）`,
						});
					}
				} else {
					const detail = (event.finalError || "未知错误").trim();
					const id = generationId ?? `generation-${++generationNumber}`;
					emitGeneration({ type: "generation", generationId: id, phase: "end", outcome: "failed", error: detail });
					const friendly = /401|auth|api.?key|invalid|unauthorized/i.test(detail)
						? `模型鉴权失败：${detail}。请到「设置 → API」检查渠道 Key 与接口地址。`
						: `模型请求失败：${detail}`;
					deps.broadcast({ type: "error", text: friendly });
					deps.broadcast({ type: "stream", state: "clear" });
					deps.broadcast({ type: "agent", state: "end" });
					generationId = null;
				}
				break;
			}
			default:
				break;
		}
	};
}
