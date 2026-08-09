/**
 * SubagentHost 单测：并发上限、状态迁移、watchdog stalled、结果/错误回传。
 * 通过注入 createSession 工厂使用 fake 子会话，不触真实 LLM。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { SubagentHost, type SubagentHostOptions, type SubagentInfo } from "../server/subagent-host.ts";

interface FakeSession {
	prompt(text: string): Promise<void>;
	subscribe(cb: (ev: unknown) => void): () => void;
	abort(): Promise<void>;
	dispose(): Promise<void>;
	messages: unknown[];
}

/**
 * 可控 fake 子会话：
 * - gate：prompt 挂起直到 resolve/abort（模拟长任务）
 * - onEvent：直接桥接 SubagentHost 的 subscribe（agent_end 携带最终消息）
 * - abort：中断挂起的 prompt（模拟真实 AgentSession.abort）
 */
function makeFakeSession(opts: {
	onEvent?: (ev: unknown) => void;
	gate?: Promise<void>;
	throwOnPrompt?: Error;
	endMessages?: { role: string; content: unknown }[];
	progressEvents?: string[];
}): FakeSession {
	const cancelHandlers: Array<() => void> = [];
	let aborted = false;
	const session: FakeSession = {
		messages: [],
		async prompt() {
			if (opts.throwOnPrompt) throw opts.throwOnPrompt;
			if (opts.gate) {
				await Promise.race([
					opts.gate,
					new Promise<never>((_, reject) => {
						cancelHandlers.push(() => {
							aborted = true;
							reject(new Error("aborted"));
						});
					}),
				]);
				if (aborted) throw new Error("aborted");
			}
			for (const type of opts.progressEvents ?? []) opts.onEvent?.({ type });
			opts.onEvent?.({
				type: "agent_end",
				messages: opts.endMessages ?? [{ role: "assistant", content: "子任务完成。" }],
			});
		},
		subscribe(cb) {
			opts.onEvent = cb;
			return () => {
				opts.onEvent = undefined;
			};
		},
		async abort() {
			for (const h of cancelHandlers.splice(0)) h();
		},
		async dispose() {},
	};
	return session;
}

const noopLoader = {
	reload: async () => {},
} as never;

function makeHost(overrides: Partial<SubagentHostOptions> = {}): {
	host: SubagentHost;
	updates: SubagentInfo[][];
	results: SubagentInfo[];
} {
	const updates: SubagentInfo[][] = [];
	const results: SubagentInfo[] = [];
	const host = new SubagentHost({
		cwd: "/tmp/fake-cwd",
		agentDir: "/tmp/fake-agent",
		authStorage: {} as never,
		modelRegistry: {} as never,
		settingsManager: {} as never,
		createResourceLoader: () => noopLoader,
		tools: () => [],
		getModel: () => null,
		maxConcurrent: 2,
		onUpdate: (s) => updates.push(s.map((x) => ({ ...x }))),
		onResult: (s) => results.push({ ...s }),
		watchdogIntervalMs: 20,
		stallTimeoutMs: 60,
		...overrides,
	});
	return { host, updates, results };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("spawn 立即返回派发结果，状态进入 starting→active→done", async () => {
	const { host } = makeHost({
		createSession: async ({ onEvent }) => makeFakeSession({ onEvent }) as never,
	});
	const r = await host.spawn({ name: "Scout", task: "调研" });
	assert.equal(r.ok, true);
	assert.ok("id" in r && r.id.startsWith("sa-"));
	const snap = host.snapshot();
	assert.equal(snap.length, 1);
	assert.equal(snap[0]!.name, "Scout");
	assert.equal(snap[0]!.task, "调研");
	await wait(50);
	assert.equal(host.snapshot()[0]!.status, "done");
	await host.dispose();
});

test("空任务拒绝派发", async () => {
	const { host } = makeHost();
	const r = await host.spawn({ name: "X", task: "   " });
	assert.equal(r.ok, false);
	assert.ok("error" in r && /空/.test(r.error));
});

test("并发上限：第 N+1 个派发返回错误，不排队", async () => {
	const gate = new Promise<void>(() => {});
	const { host } = makeHost({
		maxConcurrent: 2,
		createSession: async ({ onEvent }) => makeFakeSession({ onEvent, gate }) as never,
	});
	const a = await host.spawn({ name: "A", task: "t1" });
	const b = await host.spawn({ name: "B", task: "t2" });
	assert.equal(a.ok, true);
	assert.equal(b.ok, true);
	const c = await host.spawn({ name: "C", task: "t3" });
	assert.equal(c.ok, false);
	assert.ok("error" in c && /上限/.test(c.error));
	assert.equal(host.runningCount, 2);
	await host.dispose();
});

test("完成回传结果：agent_end 消息文本进入 result，onResult 触发一次", async () => {
	const { host, results } = makeHost({
		createSession: async ({ onEvent }) =>
			makeFakeSession({
				onEvent,
				endMessages: [{ role: "assistant", content: "【结论】已读 12 个文件。" }],
			}) as never,
	});
	await host.spawn({ name: "Reader", task: "读文件" });
	await wait(60);
	const done = host.snapshot().find((s) => s.status === "done");
	assert.ok(done);
	assert.match(done!.result ?? "", /已读 12 个文件/);
	assert.equal(results.length, 1);
	assert.equal(results[0]!.status, "done");
	assert.match(results[0]!.result ?? "", /已读 12 个文件/);
	await host.dispose();
});

test("prompt 抛错 → status=error，onResult 收到错误信息", async () => {
	const { host, results } = makeHost({
		createSession: async ({ onEvent }) =>
			makeFakeSession({ onEvent, throwOnPrompt: new Error("模型不可用") }) as never,
	});
	await host.spawn({ name: "Fail", task: "t" });
	await wait(60);
	const snap = host.snapshot()[0];
	assert.equal(snap?.status, "error");
	assert.match(snap?.error ?? "", /模型不可用/);
	assert.equal(results.length, 1);
	assert.match(results[0]!.error ?? "", /模型不可用/);
	await host.dispose();
});

test("无进度超时 → watchdog 置 stalled 并回传通知", async () => {
	const hang = new Promise<void>(() => {});
	const { host, results } = makeHost({
		stallTimeoutMs: 40,
		watchdogIntervalMs: 20,
		createSession: async ({ onEvent }) => makeFakeSession({ onEvent, gate: hang }) as never,
	});
	await host.spawn({ name: "Hang", task: "t" });
	await wait(150);
	const stalled = host.snapshot().find((s) => s.status === "stalled");
	assert.ok(stalled, `期望 stalled，实际 ${JSON.stringify(host.snapshot())}`);
	assert.ok(results.some((r) => r.status === "stalled"));
	await host.dispose();
});

test("进度事件刷新 updatedAt：active 持续更新不判 stalled", async () => {
	const { host } = makeHost({
		stallTimeoutMs: 40,
		watchdogIntervalMs: 20,
		createSession: async ({ onEvent }) => {
			// prompt 挂起 160ms，期间每 10ms 发 message_delta 心跳
			const gate = new Promise<void>((resolve) => {
				const timer = setInterval(() => onEvent({ type: "message_delta", delta: "x" }), 10);
				setTimeout(() => {
					clearInterval(timer);
					resolve();
				}, 160);
			});
			return makeFakeSession({ onEvent, gate }) as never;
		},
	});
	await host.spawn({ name: "Active", task: "t" });
	await wait(250);
	const snap = host.snapshot()[0];
	assert.notEqual(snap?.status, "stalled");
	assert.equal(snap?.status, "done");
	await host.dispose();
});

test("interrupt 中断运行中的子拓展", async () => {
	const hang = new Promise<void>(() => {});
	const { host } = makeHost({
		createSession: async ({ onEvent }) => makeFakeSession({ onEvent, gate: hang }) as never,
	});
	const r = await host.spawn({ name: "Work", task: "t" });
	assert.ok(r.ok);
	const id = "id" in r ? r.id : "";
	await wait(30);
	const int = await host.interrupt(id);
	assert.equal(int.ok, true);
	await wait(60);
	const snap = host.snapshot().find((s) => s.id === id);
	assert.equal(snap?.status, "error");
	assert.match(snap?.error ?? "", /中断/);
	await host.dispose();
});
