/**
 * setThinkingLevel 无缓存时同步探测：
 * 首次切换思考档（无磁盘缓存、模型未标记 reasoning）时，setThinkingLevel
 * 必须同步发起真实探测写回能力，档位才能生效——否则被内核 clamp 回 off
 * （现象：切档显示「已更新」但实际 Off，需重复点选模型触发探测才恢复）。
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRestHost } from "../server/rest-host.ts";
import type { RestHostDeps, RestHostSession } from "../server/rest-host.ts";
import { AGENT_CONFIG_FILE } from "../src/agent-config.ts";

function startProbeServer(): Promise<{ url: string; probeCount: () => number; close: () => void }> {
	let count = 0;
	const srv = createServer((req, res) => {
		let body = "";
		req.on("data", (c) => (body += c));
		req.on("end", () => {
			count += 1;
			let level = "none";
			try {
				level = String(JSON.parse(body)?.reasoning_effort ?? "none");
			} catch {
				/* ignore */
			}
			const ok = level === "none" || ["low", "medium", "high"].includes(level);
			res.writeHead(ok ? 200 : 400, { "Content-Type": "application/json" });
			res.end(ok ? JSON.stringify({ choices: [{ message: { content: "OK" } }] }) : JSON.stringify({ error: "unsupported" }));
		});
	});
	return new Promise((resolve) => {
		srv.listen(0, "127.0.0.1", () => {
			const addr = srv.address();
			const port = typeof addr === "object" && addr ? addr.port : 0;
			resolve({ url: `http://127.0.0.1:${port}`, probeCount: () => count, close: () => srv.close() });
		});
	});
}

test("setThinkingLevel 无缓存时同步探测并生效（不依赖 selectModel）", async () => {
	const srv = await startProbeServer();
	const cwd = join(tmpdir(), `dd-think-nocache-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(cwd, { recursive: true });
	try {
		writeFileSync(
			join(cwd, AGENT_CONFIG_FILE),
			JSON.stringify({
				version: 1,
				providers: {
					tr: { baseUrl: srv.url, apiKey: "sk-test", models: [{ id: "deepseek-v4-flash-0731", name: "Flash" }] },
				},
			}),
		);
		const modelObj = {
			provider: "tr",
			id: "deepseek-v4-flash-0731",
			name: "Flash",
			reasoning: false,
			thinkingLevelMap: undefined,
		} as unknown as RestHostSession["model"];
		let currentThinkingLevel = "off";
		const session = {
			model: modelObj,
			thinkingLevel: "off",
			getAvailableThinkingLevels: () => ["off"],
			modelRegistry: {
				getAvailable: () => [modelObj],
				getAll: () => [modelObj],
				getProviderDisplayName: () => "TR",
				getProviderAuthStatus: () => ({ configured: false }),
				authStorage: { hasAuth: () => false, set: () => {}, remove: () => {} },
				find: () => modelObj,
				refresh: () => {},
			},
			setModel: async () => {},
			setThinkingLevel: (lvl: never) => {
				currentThinkingLevel = lvl as string;
				session.thinkingLevel = lvl as string;
			},
			getActiveToolNames: () => ["read"],
			getAllTools: () => [],
			setActiveToolsByName: () => {},
			reload: async () => {},
			prompt: async () => null,
			sessionFile: undefined,
			sessionId: "s",
			sessionManager: {
				appendSessionInfo: () => {},
				getBranch: () => [],
				getEntries: () => [],
				getLeafId: () => null,
				appendMessage: () => {},
			},
		} as unknown as RestHostSession;
		const deps = {
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
		} as RestHostDeps;
		const host = createRestHost(deps);

		// 初始：无缓存、能力未写回
		assert.equal(modelObj.reasoning, false);
		const hitsBefore = srv.probeCount();

		// 直接切换档位（不经 selectModel）：应触发真实探测并生效
		const cur = await host.setThinkingLevel("medium");
		assert.ok(srv.probeCount() > hitsBefore, "setThinkingLevel 无缓存时应发起探测");
		assert.equal(modelObj.reasoning, true, "探测后能力应写回");
		assert.equal(currentThinkingLevel, "medium", "档位应生效而非 clamp 回 off");
		assert.equal(cur.thinkingLevel, "medium");
		assert.ok(cur.availableLevels.includes("medium"));

		// 再次切换：缓存已写，不再重复探测
		const hitsAfter = srv.probeCount();
		await host.setThinkingLevel("high");
		assert.equal(srv.probeCount(), hitsAfter, "缓存命中后不应重复探测");
		assert.equal(currentThinkingLevel, "high");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		srv.close();
	}
});
