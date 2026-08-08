/**
 * backendControl 工具集策略验证：
 * PUT /api/config 走 session.reload，reload 保留 getActiveToolNames() 而不重建初始工具集，
 * 因此 backendControl 关/开后必须由 rest-host 显式收敛本机工具（read/bash/edit/write）。
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRestHost } from "../server/rest-host.ts";
import type { RestHostDeps, RestHostSession } from "../server/rest-host.ts";
import { CONFIG_FILE } from "../src/paths.ts";

function makeCwd(): string {
	const dir = join(tmpdir(), `dd-backend-policy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function writeConfig(cwd: string, backendControl: boolean): void {
	writeFileSync(join(cwd, CONFIG_FILE), JSON.stringify({ version: 1, backendControl }));
}

test("backendControl 热更新后本机工具集动态收敛", async () => {
	const cwd = makeCwd();
	try {
		writeConfig(cwd, true);
		let sessionActiveTools: string[] = ["read", "bash", "edit", "write", "lorebook_search"];
		const session = {
			model: null,
			thinkingLevel: "off",
			getAvailableThinkingLevels: () => ["off"],
			modelRegistry: {
				getAvailable: () => [],
				getAll: () => [],
				getProviderDisplayName: () => "",
				getProviderAuthStatus: () => ({ configured: false }),
				authStorage: { hasAuth: () => false, set: () => {}, remove: () => {} },
				find: () => null,
				refresh: () => {},
			},
			setModel: async () => {},
			setThinkingLevel: () => {},
			getActiveToolNames: () => [...sessionActiveTools],
			getAllTools: () => [],
			setActiveToolsByName: (names: string[]) => {
				sessionActiveTools = [...names];
			},
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

		// 开启：本机工具齐全，无需收敛
		host.applyBackendToolPolicy();
		assert.deepEqual([...sessionActiveTools].sort(), ["bash", "edit", "lorebook_search", "read", "write"].sort());

		// 关闭 backendControl：剔除本机工具，保留领域工具
		writeConfig(cwd, false);
		host.applyBackendToolPolicy();
		assert.deepEqual(sessionActiveTools, ["lorebook_search"], "关闭 backendControl 应剔除 read/bash/edit/write");

		// 再次开启：本机工具补回
		writeConfig(cwd, true);
		host.applyBackendToolPolicy();
		assert.deepEqual([...sessionActiveTools].sort(), ["bash", "edit", "lorebook_search", "read", "write"].sort());
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
