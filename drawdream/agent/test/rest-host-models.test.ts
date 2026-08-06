/**
 * 模型配置分离与思考档位探测的 rest-host 逻辑单测：
 * - collectEmbeddingModelKeys 识别 kind=embedding 向量模型
 * - selectModel 探测缓存会话期持久 + 探测成功后自动应用最低可用档位（排除 off）
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { collectEmbeddingModelKeys, createRestHost } from "../server/rest-host.ts";
import type { RestHostDeps, RestHostSession } from "../server/rest-host.ts";
import { AGENT_CONFIG_FILE } from "../src/agent-config.ts";

function makeCwd(): string {
	const dir = join(tmpdir(), `dd-resthost-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

test("collectEmbeddingModelKeys：识别各渠道 kind=embedding/embed 模型，忽略普通模型", () => {
	const cwd = makeCwd();
	try {
		writeFileSync(
			join(cwd, AGENT_CONFIG_FILE),
			JSON.stringify({
				version: 1,
				providers: {
					deepseek: {
						models: [
							{ id: "deepseek-chat", name: "Chat" },
							{ id: "embed-1", kind: "embedding", name: "Embed" },
						],
					},
					openai: {
						models: [{ id: "gpt-4o" }, { id: "text-embedding-3", kind: "embed", name: "Vec" }],
					},
					empty: { models: [] },
				},
			}),
		);
		const keys = collectEmbeddingModelKeys(cwd);
		assert.deepEqual(
			[...keys].sort(),
			["deepseek::embed-1", "openai::text-embedding-3"].sort(),
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("collectEmbeddingModelKeys：无 embedding 标记返回空集合；配置缺失返回空", () => {
	const cwd = makeCwd();
	try {
		writeFileSync(
			join(cwd, AGENT_CONFIG_FILE),
			JSON.stringify({ version: 1, providers: { deepseek: { models: [{ id: "deepseek-chat" }] } } }),
		);
		assert.equal(collectEmbeddingModelKeys(cwd).size, 0);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
	// 无配置文件
	assert.equal(collectEmbeddingModelKeys(makeCwd()).size, 0);
});

function makeSession(model: RestHostSession["model"]): RestHostSession {
	const session = {
		model,
		thinkingLevel: "low",
		getAvailableThinkingLevels: () => [],
		modelRegistry: {
			getAvailable: () => [],
			getAll: () => [],
			getProviderDisplayName: () => "DeepSeek",
			getProviderAuthStatus: () => ({ configured: false }),
			authStorage: { hasAuth: () => false, set: () => {}, remove: () => {} },
			find: () => model,
			refresh: () => {},
		},
		setModel: async () => {},
		setThinkingLevel: (lvl: never) => {
			session.thinkingLevel = lvl as string;
		},
	} as RestHostSession;
	return session;
}

function makeDeps(cwd: string, session: RestHostSession): RestHostDeps {
	return {
		getCwd: () => cwd,
		getSession: () => session,
		switchSession: async () => null,
		newSession: async () => null,
		broadcast: () => {},
		resyncAll: () => {},
		refreshNamesFromConfig: () => {},
		handlePrompt: async () => {},
		listSessionsFrame: async () => ({}) as never,
		sessionInfos: async () => [],
		assertListedSession: async () => null,
		cardCache: {} as never,
		previewCache: {} as never,
		sessionCard: () => null,
		stateDir: "",
		artifactsDir: "",
	};
}

test("probeThinking：无默认模型时抛出「尚未选择默认模型」", async () => {
	const cwd = makeCwd();
	try {
		const host = createRestHost(makeDeps(cwd, makeSession(null)));
		await assert.rejects(() => host.probeThinking(), /尚未选择默认模型/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("probeThinking：模型未标记 reasoning 且无 Key → no-config（不再被 reasoning 门控拦截）", async () => {
	const cwd = makeCwd();
	try {
		writeFileSync(
			join(cwd, AGENT_CONFIG_FILE),
			JSON.stringify({
				version: 1,
				providers: { deepseek: { baseUrl: "https://api.deepseek.com", models: [{ id: "deepseek-chat", name: "Chat" }] } },
			}),
		);
		const session = makeSession({ provider: "deepseek", id: "deepseek-chat", name: "Chat" });
		const host = createRestHost(makeDeps(cwd, session));
		const r = await host.probeThinking();
		assert.equal(r.reason, "no-config");
		assert.equal(r.levels.length, 0);
		assert.equal(session.thinkingLevel, "low");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("probeThinking：渠道无实值 API Key → no-config", async () => {
	const cwd = makeCwd();
	try {
		writeFileSync(
			join(cwd, AGENT_CONFIG_FILE),
			JSON.stringify({
				version: 1,
				providers: { deepseek: { baseUrl: "https://api.deepseek.com", models: [{ id: "deepseek-chat", reasoning: true }] } },
			}),
		);
		const session = makeSession({ provider: "deepseek", id: "deepseek-chat", name: "Chat", reasoning: true });
		const host = createRestHost(makeDeps(cwd, session));
		const r = await host.probeThinking();
		assert.equal(r.reason, "no-config");
		assert.equal(r.levels.length, 0);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
