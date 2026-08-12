/**
 * 云同步 REST 路由（/api/sync/*）。
 * 依赖鉴权已由 main.ts 完成；本路由基于 ctx.host（当前用户 workspace）。
 */

import { readBody, sendJson } from "../http.ts";
import type { RouteCtx } from "./context.ts";
import { hashPassword } from "../../../src/auth/password.ts";
import { AccountService } from "../../sync/account.ts";
import { SyncConfigStore } from "../../sync/config.ts";
import { ConflictStore } from "../../sync/conflicts.ts";
import { ensureEngineStarted, getEngine, stopEngine } from "../../sync/manager.ts";
import { TiDBClient } from "../../sync/tidb.ts";
import type { TidbConfig } from "../../sync/types.ts";

export async function handleSyncRoutes(ctx: RouteCtx): Promise<boolean> {
	const { req, res, host } = ctx;
	const route = ctx.route;
	if (!ctx.url.startsWith("/api/sync/")) return false;

	const cwd = host.cwd;
	const agentDir = host.agentDir();

	// GET /api/sync/status
	if (route === "GET /api/sync/status") {
		const store = new SyncConfigStore(cwd);
		const handle = ensureEngineStarted(cwd, agentDir);
		const status = handle?.engine.status ?? {
			enabled: false,
			connecting: false,
			connected: false,
			lastSeq: 0,
			remoteMaxSeq: 0,
			pendingCount: 0,
			conflictCount: new ConflictStore(cwd).count,
		};
		sendJson(res, 200, {
			...status,
			hasConfig: store.hasConfig(),
			deviceId: store.getDeviceId(),
			deviceName: store.getDeviceName(),
			groupId: store.getGroupId(),
		});
		return true;
	}

	// GET /api/sync/config（回显非敏感字段）
	if (route === "GET /api/sync/config") {
		const store = new SyncConfigStore(cwd);
		const cfg = store.getTidbConfig();
		sendJson(res, 200, {
			configured: store.hasConfig(),
			enabled: store.getEnabled(),
			host: cfg?.host ?? null,
			port: cfg?.port ?? null,
			user: cfg?.user ?? null,
			database: cfg?.database ?? null,
			hasPassword: cfg ? cfg.password.length > 0 : false,
		});
		return true;
	}

	// PUT /api/sync/config（保存连接配置，不启用）
	if (route === "PUT /api/sync/config") {
		const body = JSON.parse(await readBody(req)) as Partial<TidbConfig>;
		const tidb: TidbConfig = {
			host: String(body.host ?? "").trim(),
			port: Number(body.port ?? 4000),
			user: String(body.user ?? "").trim(),
			password: String(body.password ?? ""),
			database: String(body.database ?? "").trim(),
		};
		if (!tidb.host || !tidb.user || !tidb.database) {
			sendJson(res, 400, { error: "host/user/database 必填", code: "INVALID_CONFIG" });
			return true;
		}
		const store = new SyncConfigStore(cwd);
		store.saveTidbConfig(tidb);
		sendJson(res, 200, { ok: true });
		return true;
	}

	// POST /api/sync/test（测试连接，不保存）
	if (route === "POST /api/sync/test") {
		const body = JSON.parse(await readBody(req)) as Partial<TidbConfig> | undefined;
		const store = new SyncConfigStore(cwd);
		let cfg: TidbConfig | null = null;
		if (body?.host) {
			cfg = {
				host: String(body.host),
				port: Number(body.port ?? 4000),
				user: String(body.user),
				password: String(body.password ?? ""),
				database: String(body.database ?? ""),
			};
		} else {
			cfg = store.getTidbConfig();
		}
		if (!cfg) {
			sendJson(res, 400, { error: "未配置连接", code: "NO_CONFIG" });
			return true;
		}
		try {
			const client = new TiDBClient(cfg, "test");
			const info = await client.probe();
			await client.close();
			sendJson(res, 200, {
				ok: true,
				dbExists: info.dbExists,
				accountCount: info.accountCount,
				message: info.dbExists
					? "连接成功（数据库已初始化）"
					: "连接成功（新数据库，启用同步时自动建表）",
			});
		} catch (err) {
			const { classifyTidbError } = await import("../../sync/tidb.ts");
			const info = classifyTidbError(err);
			const hint =
				info.kind === "permission-denied"
					? "数据库账号对该库无操作权限，请检查「数据库名」是否与该账号可访问的库一致（TiDB Serverless 需使用账号绑定的集群库名）"
					: info.kind === "db-not-found"
						? "数据库不存在，请在 TiDB Cloud 中先创建对应数据库"
						: undefined;
			sendJson(res, 200, {
				ok: false,
				error: info.message,
				code: info.kind,
				hint,
			});
		}
		return true;
	}

	// POST /api/sync/enable（启用同步：保存配置 + 账号注册/登录 + 登记设备 + 启动引擎）
	if (route === "POST /api/sync/enable") {
		const body = JSON.parse(await readBody(req)) as {
			host?: string;
			port?: number;
			user?: string;
			password?: string;
			database?: string;
			username?: string;
			accountPassword?: string;
			deviceName?: string;
		};
		const store = new SyncConfigStore(cwd);
		const tidb: TidbConfig = body.host
			? {
					host: String(body.host).trim(),
					port: Number(body.port ?? 4000),
					user: String(body.user ?? "").trim(),
					password: String(body.password ?? ""),
					database: String(body.database ?? "").trim(),
				}
			: (store.getTidbConfig() as TidbConfig);
		if (!tidb) {
			sendJson(res, 400, { error: "缺少连接配置", code: "NO_CONFIG" });
			return true;
		}
		const username = String(body.username ?? "").trim();
		const accountPassword = String(body.accountPassword ?? "");
		if (!username || !accountPassword) {
			sendJson(res, 400, { error: "需要云账号用户名与密码", code: "NO_ACCOUNT" });
			return true;
		}
		const groupId = store.getGroupId() || `grp-${Date.now().toString(36)}`;
		const deviceId = store.getDeviceId() || `dev-${Date.now().toString(36)}`;
		const deviceName = String(body.deviceName ?? "DrawDream").trim();
		try {
			// 连接 + 迁移 + 账号注册/登录
			const client = new TiDBClient(tidb, groupId);
			await client.init();
			const acct = new AccountService({
				client,
				deviceId,
				deviceName,
			});
			// 新账号注册时须用真实哈希（传空 salt/hash 会把空哈希存进云端，
			// 导致后续任何设备登录该校验必然失败 → invalid-password）
			const { salt, hash } = hashPassword(accountPassword);
			const reg = await acct.registerWithHash(username, salt, hash, accountPassword);
			if (!reg.ok) {
				await client.close();
				sendJson(res, 200, { ok: false, error: reg.error, code: reg.error.toUpperCase() });
				return true;
			}
			// 若云端账号已存在，用本地哈希补登
			if (!reg.newAccount) {
				const found = await client.findAccount(username);
				if (found) {
					// 校验通过（registerWithHash 已校验）
				}
			}
			await client.close();
			// 持久化配置与身份
			store.saveTidbConfig(tidb);
			store.setDevice(deviceId, deviceName, groupId);
			store.setEnabled(true);
			// 启动引擎（含全量拉取）
			const handle = ensureEngineStarted(cwd, agentDir);
			if (handle?.engine) {
				await handle.engine.start().catch(() => undefined);
				const applied = await handle.engine.fullPull().catch(() => 0);
				sendJson(res, 200, {
					ok: true,
					newAccount: reg.newAccount,
					deviceId,
					groupId,
					fullPullApplied: applied,
				});
			} else {
				sendJson(res, 200, { ok: true, newAccount: reg.newAccount, deviceId, groupId });
			}
		} catch (err) {
			const { classifyTidbError } = await import("../../sync/tidb.ts");
			const info = classifyTidbError(err);
			const hint =
				info.kind === "permission-denied"
					? "数据库账号对「" + (tidb?.database ?? "") + "」库无建表/写入权限。请确认：1) 数据库名是该账号可访问的库；2) 在 TiDB Cloud 控制台给该用户授予对应库权限"
					: undefined;
			sendJson(res, 200, { ok: false, error: info.message, code: info.kind, hint });
		}
		return true;
	}

	// POST /api/sync/disable（停用：停止引擎 + 清除凭据）
	if (route === "POST /api/sync/disable") {
		await stopEngine(cwd);
		const store = new SyncConfigStore(cwd);
		store.clearCredentials();
		sendJson(res, 200, { ok: true });
		return true;
	}

	// POST /api/sync/sync-now（手动立即同步）
	if (route === "POST /api/sync/sync-now") {
		const handle = ensureEngineStarted(cwd, agentDir);
		if (!handle?.engine) {
			sendJson(res, 400, { error: "同步未启用", code: "NOT_ENABLED" });
			return true;
		}
		try {
			await handle.engine.syncNow();
			sendJson(res, 200, { ok: true, status: handle.engine.status });
		} catch (err) {
			sendJson(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err) });
		}
		return true;
	}

	// POST /api/sync/full-pull（手动全量拉取）
	if (route === "POST /api/sync/full-pull") {
		const handle = ensureEngineStarted(cwd, agentDir);
		if (!handle?.engine) {
			sendJson(res, 400, { error: "同步未启用", code: "NOT_ENABLED" });
			return true;
		}
		const applied = await handle.engine.fullPull();
		sendJson(res, 200, { ok: true, applied });
		return true;
	}

	// GET /api/sync/devices
	if (route === "GET /api/sync/devices") {
		const handle = ensureEngineStarted(cwd, agentDir);
		if (!handle?.engine) {
			sendJson(res, 200, { devices: [] });
			return true;
		}
		const acct = new AccountService({
			client: handle.engine.tidb,
			deviceId: handle.store.getDeviceId(),
			deviceName: handle.store.getDeviceName(),
		});
		const devices = await acct.listDevices();
		sendJson(res, 200, { devices });
		return true;
	}

	// POST /api/sync/devices/rename
	if (route === "POST /api/sync/devices/rename") {
		const body = JSON.parse(await readBody(req)) as { deviceId?: string; name?: string };
		const handle = ensureEngineStarted(cwd, agentDir);
		if (!handle?.engine || !body.deviceId) {
			sendJson(res, 400, { error: "同步未启用", code: "NOT_ENABLED" });
			return true;
		}
		const acct = new AccountService({
			client: handle.engine.tidb,
			deviceId: handle.store.getDeviceId(),
			deviceName: handle.store.getDeviceName(),
		});
		await acct.renameDevice(body.deviceId, String(body.name ?? "").trim());
		sendJson(res, 200, { ok: true });
		return true;
	}

	// GET /api/sync/conflicts
	if (route === "GET /api/sync/conflicts") {
		const conflicts = new ConflictStore(cwd).list();
		sendJson(res, 200, { conflicts });
		return true;
	}

	// POST /api/sync/conflicts/resolve（解决冲突：{entityType, entityId, fieldPath, value}）
	if (route === "POST /api/sync/conflicts/resolve") {
		const body = JSON.parse(await readBody(req)) as {
			entityType?: string;
			entityId?: string;
			fieldPath?: string;
			value?: unknown;
		};
		const store = new ConflictStore(cwd);
		const conflict = store
			.list()
			.find((c) => c.entityType === body.entityType && c.entityId === body.entityId && c.fieldPath === body.fieldPath);
		if (!conflict) {
			sendJson(res, 404, { error: "冲突不存在", code: "NOT_FOUND" });
			return true;
		}
		store.resolve(conflict, body.value);
		sendJson(res, 200, { ok: true });
		return true;
	}

	return false;
}

export { getEngine };
