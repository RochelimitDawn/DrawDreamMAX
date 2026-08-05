/**
 * 子拓展（subagent）工具面：注册到主助手会话。
 * description 中内置「何时使用子 agent」的系统提示词准则。
 */

import { defineTool, type ToolDefinition } from "@drawdream/agent-runtime/web";
import { Type } from "typebox";
import { SubagentHost, type SubagentStatus } from "./subagent-host.ts";

const text = (t: string, isError = false) => ({
	content: [{ type: "text" as const, text: t }],
	...(isError ? { isError: true } : {}),
});

const STATUS_LABEL: Record<SubagentStatus, string> = {
	starting: "启动中",
	active: "执行中",
	waiting: "等待中",
	stalled: "停滞",
	running: "运行中",
	done: "已完成",
	error: "失败",
};

/** 子 agent 工具主描述：明确启用策略（何时用/不用子拓展） */
const SUBAGENT_GUIDELINES =
	"Spawn an async subagent to execute an independent subtask in the background while you keep working. " +
	"Returns immediately; the subagent's result is steered back to you when it finishes, so you can incorporate it.\n" +
	"Use subagents ONLY when: (1) the task cleanly decomposes into multiple INDEPENDENT subtasks and running them in parallel clearly speeds things up, OR (2) the user explicitly asks you to use subagents.\n" +
	"Do NOT spawn subagents for: sequential/dependent work, tasks that need heavy shared context you already hold, or tiny tasks you can finish faster yourself.\n" +
	"When the concurrency limit is reached, wait for existing subagents or reuse their results instead of spawning more.";

export function createSubagentTools(host: SubagentHost): ToolDefinition[] {
	return [
		defineTool({
			name: "subagent",
			label: "子拓展",
			description: SUBAGENT_GUIDELINES,
			promptSnippet: "subagent(name?, task): 并行派发一个后台子任务；完成结果自动回传。仅当任务可拆分且并行明显提速、或用户明确要求时使用。",
			parameters: Type.Object({
				name: Type.Optional(Type.String({ description: "子拓展展示名（用于面板与结果回传，建议简短）" })),
				task: Type.String({ description: "子拓展的任务提示词（独立指令，子 agent 据此自行完成）" }),
			}),
			async execute(_id, params) {
				const r = await host.spawn({ name: params.name, task: params.task });
				if (!r.ok) return text(r.error, true);
				return text(`已派发子拓展「${r.id}」在后台并行执行，完成后结果会自动回传。`);
			},
		}),
		defineTool({
			name: "subagent_list",
			label: "查看子拓展",
			description:
				"Return the current list of running/completed subagents with their status. Call this before deciding whether to spawn more, or to recall what a finished subagent returned.",
			parameters: Type.Object({}),
			async execute() {
				const list = host.snapshot();
				if (!list.length) return text("当前没有子拓展。");
				const lines = list.map((s) => {
					const tail = s.status === "done" && s.result ? `：${s.result.slice(0, 140)}` : "";
					return `- [${STATUS_LABEL[s.status]}] ${s.name}${tail}`;
				});
				return text(`当前子拓展：\n${lines.join("\n")}`);
			},
		}),
	];
}
