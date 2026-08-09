/**
 * 同步引擎管理器：按用户 workspace 管理 SyncEngine 生命周期。
 * 模块级单例，供 REST 路由与 UserHost 启停调用。
 */

import { resolve } from "node:path";
import { join } from "node:path";

import { SyncConfigStore } from "./config.ts";
import { SyncEngine } from "./engine.ts";
import { TiDBClient } from "./tidb.ts";

/** 会话目录 = <agentDir>/sessions/--<encoded-cwd>--（与 coding-agent getDefaultSessionDir 同语义）。 */
function sessionDirFor(cwd: string, agentDir: string): string {
	const resolvedCwd = resolve(cwd);
	const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(agentDir, "sessions", safePath);
}

export interface EngineHandle {
	engine: SyncEngine;
	store: SyncConfigStore;
}

const engines = new Map<string, EngineHandle>();

function keyFor(cwd: string): string {
	return cwd;
}

/** 获取（或创建）某 workspace 的同步引擎句柄。会话目录按 agentDir + cwd 计算。 */
export function getEngine(cwd: string, _agentDir: string): EngineHandle {
	const key = keyFor(cwd);
	const existing = engines.get(key);
	if (existing) return existing;
	const store = new SyncConfigStore(cwd);
	const handle: EngineHandle = { engine: null as unknown as SyncEngine, store };
	engines.set(key, handle);
	return handle;
}

/** 仅当该 workspace 已配置并启用了同步，创建真正的 SyncEngine。 */
export function ensureEngineStarted(cwd: string, agentDir: string): EngineHandle | null {
	const key = keyFor(cwd);
	const existing = engines.get(key);
	if (existing?.engine) return existing;

	const store = existing?.store ?? new SyncConfigStore(cwd);
	if (!store.getEnabled()) {
		// 未启用：只保留配置句柄，不启动引擎
		if (!existing) {
			engines.set(key, { engine: null as unknown as SyncEngine, store });
		}
		return null;
	}
	const tidbCfg = store.getTidbConfig();
	if (!tidbCfg) return null;

	const sessionDir = sessionDirFor(cwd, agentDir);
	const engine = new SyncEngine({
		workspaceCwd: cwd,
		sessionDir,
		deviceId: store.getDeviceId() || `dev-${Date.now().toString(36)}`,
		deviceName: store.getDeviceName() || "DrawDream",
		groupId: store.getGroupId() || "default",
		config: tidbCfg,
	});
	const handle = { engine, store };
	engines.set(key, handle);
	void engine.start().catch(() => {
		// 启动失败（网络）不抛出到路由层；状态通过 engine.status.lastError 呈现
	});
	return handle;
}

/** 停止并移除某 workspace 的同步引擎。 */
export async function stopEngine(cwd: string): Promise<void> {
	const key = keyFor(cwd);
	const handle = engines.get(key);
	if (handle?.engine) {
		try {
			await handle.engine.stop();
		} catch {
			/* ignore */
		}
	}
	engines.delete(key);
}

/** 停止全部引擎（服务退出时调用）。 */
export async function stopAllEngines(): Promise<void> {
	for (const key of [...engines.keys()]) {
		await stopEngine(key);
	}
}

export function engineCount(): number {
	let n = 0;
	for (const h of engines.values()) if (h.engine) n++;
	return n;
}

export { TiDBClient };
