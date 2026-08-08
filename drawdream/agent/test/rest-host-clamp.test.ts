/**
 * 思考档位切换修复验证：
 * 探测成功后 runThinkingProbe 会把 accepted 档位写回模型对象能力
 * （reasoning=true + thinkingLevelMap），使内核 session.setThinkingLevel
 * 的 clamp 依据真实端点结果，而非模型条目静态 reasoning 标志。
 * 通过本地 HTTP 探测端点 + createRestHost 走真实探测链路。
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
				const j = JSON.parse(body);
				level = String(j?.reasoning_effort ?? "none");
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

function makeCwd(): string {
	const dir = join(tmpdir(), `dd-resthost-clamp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

test("探测成功后模型对象档位能力写回，切换档位不再 clamp 回 off", async () => {
	const srv = await startProbeServer();
	const cwd = makeCwd();
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
				session.thinkingLevel = lvl as string;
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

		// 探测前：模型未标记 reasoning，可用档位仅 off
		assert.equal(modelObj.reasoning, false);

		const r = await host.probeThinking();
		assert.equal(r.reason, "probe");
		assert.deepEqual([...r.levels].sort(), ["high", "low", "medium", "off"].sort());

		// 探测后：模型能力写回 reasoning=true 且档位 map 含 accepted
		assert.equal(modelObj.reasoning, true);
		const map = (modelObj as unknown as { thinkingLevelMap?: Record<string, string | null> }).thinkingLevelMap;
		assert.ok(map, "thinkingLevelMap 应被写回");
		assert.equal(map?.off, "none");
		assert.equal(map?.low, "low");
		assert.equal(map?.medium, "medium");
		assert.equal(map?.high, "high");
		assert.equal(map?.minimal, null);

		// 设置档位 low：内核 clamp 依据写回后的能力，应保留 low（而非回退 off）
		host.setThinkingLevel("low");
		assert.equal(session.thinkingLevel, "low");

		// —— 磁盘缓存持久化：探测成功后缓存文件落盘 ——
		const cacheFile = join(cwd, ".drawdream", "thinking-probe-cache.json");
		assert.ok(existsSync(cacheFile), "探测成功后应生成磁盘缓存文件");
		const persisted = JSON.parse(readFileSync(cacheFile, "utf8")) as Record<string, unknown>;
		assert.deepEqual([...(persisted["tr::deepseek-v4-flash-0731"] as string[])].sort(), ["high", "low", "medium", "off"]);

		// —— 重启 App（新 host 实例）：命中磁盘缓存，不再发起探测 ——
		const hitsBefore = srv.probeCount();
		const host2 = createRestHost(deps);
		const r2 = await host2.probeThinking();
		assert.equal(r2.reason, "cache");
		assert.deepEqual([...r2.levels].sort(), ["high", "low", "medium", "off"].sort());
		assert.equal(srv.probeCount(), hitsBefore, "命中缓存后不应再向端点发起探测");
		// 缓存命中也会把能力写回模型对象：再次切换档位不被 clamp 回退
		assert.equal(modelObj.reasoning, true, "缓存命中后模型 reasoning 应被写回");
		const map2 = (modelObj as unknown as { thinkingLevelMap?: Record<string, string | null> }).thinkingLevelMap;
		assert.ok(map2, "缓存命中后 thinkingLevelMap 应被写回");
		host2.setThinkingLevel("medium");
		assert.equal(session.thinkingLevel, "medium", "缓存命中后切换档位应生效而非回退");

		// —— selectModel 命中缓存：模型对象能力未写回时，选完模型切换档位仍应生效 ——
		modelObj.reasoning = false;
		(modelObj as unknown as { thinkingLevelMap?: Record<string, string | null> }).thinkingLevelMap = undefined;
		const hitsBefore2 = srv.probeCount();
		await host2.selectModel("tr", "deepseek-v4-flash-0731");
		assert.equal(srv.probeCount(), hitsBefore2, "selectModel 命中缓存不应发起探测");
		assert.equal(modelObj.reasoning, true, "selectModel 命中缓存应写回模型能力");
		// 缓存命中的最低档应已应用（非 off）
		assert.notEqual(session.thinkingLevel, "off", "selectModel 命中缓存应应用最低可用档");
		// 切换到高可用档位仍不被 clamp 回退
		host2.setThinkingLevel("high");
		assert.equal(session.thinkingLevel, "high", "selectModel 缓存命中后切换档位应生效");

		// —— setThinkingLevel 兜底写回：模型能力丢失时切换档位仍生效 ——
		modelObj.reasoning = false;
		(modelObj as unknown as { thinkingLevelMap?: Record<string, string | null> }).thinkingLevelMap = undefined;
		host2.setThinkingLevel("low");
		assert.equal(session.thinkingLevel, "low", "setThinkingLevel 应兜底写回能力后生效");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		srv.close();
	}
});
