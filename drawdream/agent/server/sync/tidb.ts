/**
 * TiDB Serverless 连接层（mysql2/promise，TLS 直连）。
 * 每个同步组使用独立数据库（dd_sync_<groupId>），迁移脚本幂等建表。
 */

import mysql from "mysql2/promise";

import type { AccountRow, DeviceRow, EntityType, EntityVersionRow, SyncEntryRow, TidbConfig } from "./types.ts";

/** 连接/查询错误分类，供 /api/sync/test 返回可读信息。 */
export type TidbErrorKind =
	| "auth-failed"
	| "connect-failed"
	| "db-not-found"
	| "permission-denied"
	| "unknown";

export interface TidbErrorInfo {
	kind: TidbErrorKind;
	message: string;
}

export function classifyTidbError(err: unknown): TidbErrorInfo {
	const e = err as { code?: string; message?: string };
	const msg = e?.message ?? String(err);
	if (typeof e?.code === "string") {
		switch (e.code) {
			case "ER_ACCESS_DENIED_ERROR":
			case "ER_ACCESS_DENIED_NO_PASSWORD_ERROR":
			case "ER_DBACCESS_DENIED_ERROR":
				return { kind: "auth-failed", message: msg };
			case "ER_BAD_DB_ERROR":
				return { kind: "db-not-found", message: msg };
			case "ER_TABLEACCESS_DENIED_ERROR":
			case "ER_COLUMNACCESS_DENIED_ERROR":
			case "ER_DB_CREATE_DISALLOWED_IN_TRANSACTION":
			case "ER_SPECIFIC_ACCESS_DENIED_ERROR":
			case "ER_TABLE_CREATE_DISALLOWED_IN_TRANSACTION":
				return { kind: "permission-denied", message: msg };
			case "ECONNREFUSED":
			case "ETIMEDOUT":
			case "ENOTFOUND":
			case "EPIPE":
			case "PROTOCOL_CONNECTION_LOST":
				return { kind: "connect-failed", message: msg };
		}
	}
	if (/permission denied|command denied|operation.*denied|not permitted|execute command denied/i.test(msg)) {
		return { kind: "permission-denied", message: msg };
	}
	if (/denied|authentication|access denied/i.test(msg)) return { kind: "auth-failed", message: msg };
	if (/unknown database|database .* doesn't exist|1049/i.test(msg)) return { kind: "db-not-found", message: msg };
	return { kind: "unknown", message: msg };
}

const MIGRATE_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  id VARCHAR(40) PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  password_salt VARCHAR(128) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  kdf VARCHAR(32) NOT NULL DEFAULT 'scrypt',
  owner_device_id VARCHAR(64),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  device_id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  last_seen_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS sync_entries (
  seq BIGINT NOT NULL AUTO_INCREMENT,
  entity_type VARCHAR(32) NOT NULL,
  entity_id VARCHAR(512) NOT NULL,
  payload JSON NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (seq),
  KEY idx_entity (entity_type, entity_id)
);
CREATE TABLE IF NOT EXISTS entity_versions (
  entity_type VARCHAR(32) NOT NULL,
  entity_id VARCHAR(512) NOT NULL,
  version BIGINT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);
`;

export class TiDBClient {
	private pool: mysql.Pool | null = null;
	readonly config: TidbConfig;
	readonly groupId: string;

	constructor(config: TidbConfig, groupId: string) {
		this.config = config;
		this.groupId = groupId;
	}

	get connected(): boolean {
		return this.pool !== null;
	}

	private poolFor(): mysql.Pool {
		if (this.pool) return this.pool;
		this.pool = mysql.createPool({
			host: this.config.host,
			port: this.config.port,
			user: this.config.user,
			password: this.config.password,
			database: this.config.database,
			ssl: { rejectUnauthorized: true },
			connectionLimit: 3,
			enableKeepAlive: true,
			keepAliveInitialDelay: 10_000,
		});
		return this.pool;
	}

	async ping(): Promise<void> {
		const pool = this.poolFor();
		await pool.query("SELECT 1");
	}

	async close(): Promise<void> {
		if (this.pool) {
			await this.pool.end();
			this.pool = null;
		}
	}

	/** 幂等建表与索引。 */
	async migrate(): Promise<void> {
		const pool = this.poolFor();
		for (const stmt of MIGRATE_SQL.split(";").map((s) => s.trim()).filter(Boolean)) {
			await pool.query(stmt);
		}
	}

	async insertEntries(rows: SyncEntryRow[]): Promise<void> {
		if (rows.length === 0) return;
		const pool = this.poolFor();
		const values = rows.map((r) => [
			r.entityType,
			r.entityId,
			JSON.stringify(r.payload),
			r.deviceId,
			r.createdAt,
		]);
		await pool.query(
			"INSERT INTO sync_entries (entity_type, entity_id, payload, device_id, created_at) VALUES ?",
			[values],
		);
	}

	async fetchEntries(afterSeq: number, limit: number): Promise<SyncEntryRow[]> {
		const pool = this.poolFor();
		const [rows] = await pool.query(
			"SELECT seq, entity_type, entity_id, payload, device_id, created_at FROM sync_entries WHERE seq > ? ORDER BY seq ASC LIMIT ?",
			[afterSeq, limit],
		);
		return (rows as Array<Record<string, unknown>>).map((r) => ({
			seq: Number(r.seq),
			entityType: r.entity_type as EntityType,
			entityId: String(r.entity_id),
			payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
			deviceId: String(r.device_id),
			createdAt: Number(r.created_at),
		}));
	}

	async maxSeq(): Promise<number> {
		const pool = this.poolFor();
		const [rows] = await pool.query("SELECT COALESCE(MAX(seq), 0) AS m FROM sync_entries");
		const r = (rows as Array<{ m: number | string }>)[0];
		return Number(r?.m ?? 0);
	}

	async upsertDevice(d: DeviceRow): Promise<void> {
		const pool = this.poolFor();
		await pool.query(
			"INSERT INTO devices (device_id, name, last_seen_at, created_at, active) VALUES (?, ?, ?, ?, ?) " +
				"ON DUPLICATE KEY UPDATE name = VALUES(name), last_seen_at = VALUES(last_seen_at), active = VALUES(active)",
			[d.deviceId, d.name, d.lastSeenAt, d.createdAt, d.active],
		);
	}

	async listDevices(): Promise<DeviceRow[]> {
		const pool = this.poolFor();
		const [rows] = await pool.query(
			"SELECT device_id, name, last_seen_at, created_at, active FROM devices ORDER BY created_at ASC",
		);
		return (rows as Array<Record<string, unknown>>).map((r) => ({
			deviceId: String(r.device_id),
			name: String(r.name),
			lastSeenAt: Number(r.last_seen_at),
			createdAt: Number(r.created_at),
			active: Boolean(r.active),
		}));
	}

	async renameDevice(deviceId: string, name: string): Promise<void> {
		const pool = this.poolFor();
		await pool.query("UPDATE devices SET name = ? WHERE device_id = ?", [name, deviceId]);
	}

	async removeDevice(deviceId: string): Promise<void> {
		const pool = this.poolFor();
		await pool.query("DELETE FROM devices WHERE device_id = ?", [deviceId]);
	}

	async upsertEntityVersion(v: EntityVersionRow): Promise<void> {
		const pool = this.poolFor();
		await pool.query(
			"INSERT INTO entity_versions (entity_type, entity_id, version, content_hash, payload, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) " +
				"ON DUPLICATE KEY UPDATE version = IF(VALUES(version) > version, VALUES(version), version), " +
				"content_hash = VALUES(content_hash), payload = VALUES(payload), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)",
			[v.entityType, v.entityId, v.version, v.contentHash, JSON.stringify(v.payload), v.updatedBy, v.updatedAt],
		);
	}

	async fetchEntityVersions(): Promise<EntityVersionRow[]> {
		const pool = this.poolFor();
		const [rows] = await pool.query(
			"SELECT entity_type, entity_id, version, content_hash, payload, updated_by, updated_at FROM entity_versions",
		);
		return (rows as Array<Record<string, unknown>>).map((r) => ({
			entityType: r.entity_type as EntityType,
			entityId: String(r.entity_id),
			version: Number(r.version),
			contentHash: String(r.content_hash),
			payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
			updatedBy: String(r.updated_by),
			updatedAt: Number(r.updated_at),
		}));
	}

	async upsertAccount(a: AccountRow): Promise<void> {
		const pool = this.poolFor();
		await pool.query(
			"INSERT INTO accounts (id, username, password_salt, password_hash, kdf, owner_device_id, created_at, updated_at) " +
				"VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
				"ON DUPLICATE KEY UPDATE username = VALUES(username), updated_at = VALUES(updated_at)",
			[a.id, a.username, a.passwordSalt, a.passwordHash, a.kdf, a.ownerDeviceId, a.createdAt, a.updatedAt],
		);
	}

	async findAccount(username: string): Promise<AccountRow | null> {
		const pool = this.poolFor();
		const [rows] = await pool.query(
			"SELECT id, username, password_salt, password_hash, kdf, owner_device_id, created_at, updated_at FROM accounts WHERE username = ? LIMIT 1",
			[username],
		);
		const r = (rows as Array<Record<string, unknown>>)[0];
		if (!r) return null;
		return {
			id: String(r.id),
			username: String(r.username),
			passwordSalt: String(r.password_salt),
			passwordHash: String(r.password_hash),
			kdf: String(r.kdf),
			ownerDeviceId: String(r.owner_device_id ?? ""),
			createdAt: Number(r.created_at),
			updatedAt: Number(r.updated_at),
		};
	}

	/** 只读探测：测试连接 + 检查 accounts 表是否已存在（不执行任何 DDL）。 */
	async probe(): Promise<{ dbExists: boolean; accountCount: number }> {
		await this.ping();
		const pool = this.poolFor();
		const [rows] = await pool.query(
			"SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = ? AND table_name = 'accounts'",
			[this.config.database],
		);
		const tableExists = Number((rows as Array<{ c: number }>)[0]?.c ?? 0) > 0;
		let accountCount = 0;
		if (tableExists) {
			try {
				const [arows] = await pool.query("SELECT COUNT(*) AS c FROM accounts");
				accountCount = Number((arows as Array<{ c: number }>)[0]?.c ?? 0);
			} catch {
				// accounts 表存在但无 SELECT 权限时忽略计数，不影响连接验证
			}
		}
		return { dbExists: tableExists, accountCount };
	}

	/** 初始化（测试连接 + 建表迁移），供启用同步时调用。 */
	async init(): Promise<{ dbExists: boolean; accountCount: number }> {
		const info = await this.probe();
		await this.migrate();
		return info;
	}
}
