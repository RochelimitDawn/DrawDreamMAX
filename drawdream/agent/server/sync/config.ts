/**
 * 同步连接凭据配置：加密存储于 .drawdream-sync/config.json（权限 600）。
 * 密码使用设备本地随机密钥（AES-256-GCM）加密，密钥单独存于同目录 key 文件。
 * 明文密码不落盘、不写日志、不进入前端状态。
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { TidbConfig } from "./types.ts";

interface StoredConfig {
	enabled: boolean;
	accountUsername?: string;
	tidb?: {
		host: string;
		port: number;
		user: string;
		passwordEnc: string; // AES-256-GCM：iv(16) + tag(16) + ciphertext，base64
		database: string;
	};
	deviceId: string;
	deviceName: string;
	groupId: string;
}

const ALGO = "aes-256-gcm";

export class SyncConfigStore {
	readonly dir: string;
	private readonly configPath: string;
	private readonly keyPath: string;
	private cached?: StoredConfig;

	constructor(workspaceCwd: string) {
		this.dir = join(workspaceCwd, ".drawdream-sync");
		this.configPath = join(this.dir, "config.json");
		this.keyPath = join(this.dir, "key.bin");
	}

	private ensureDir(): void {
		mkdirSync(this.dir, { recursive: true, mode: 0o700 });
	}

	/** 加载设备本地加密密钥；不存在则生成并落盘。 */
	private loadKey(): Buffer {
		this.ensureDir();
		if (!existsSync(this.keyPath)) {
			const key = randomBytes(32);
			writeFileSync(this.keyPath, key, { mode: 0o600 });
			return key;
		}
		return readFileSync(this.keyPath);
	}

	private encrypt(plain: string): string {
		const key = this.loadKey();
		const iv = randomBytes(12);
		const cipher = createCipheriv(ALGO, key, iv);
		const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
		const tag = cipher.getAuthTag();
		return Buffer.concat([iv, tag, enc]).toString("base64");
	}

	private decrypt(enc: string): string {
		const key = this.loadKey();
		const raw = Buffer.from(enc, "base64");
		const iv = raw.subarray(0, 12);
		const tag = raw.subarray(12, 28);
		const data = raw.subarray(28);
		const decipher = createDecipheriv(ALGO, key, iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
	}

	private load(): StoredConfig {
		if (this.cached) return this.cached;
		if (existsSync(this.configPath)) {
			try {
				const raw = JSON.parse(readFileSync(this.configPath, "utf8")) as Partial<StoredConfig>;
				const cfg: StoredConfig = {
					enabled: raw.enabled === true,
					deviceId: raw.deviceId ?? "",
					deviceName: raw.deviceName ?? "",
					groupId: raw.groupId ?? "",
					tidb: raw.tidb,
				};
				this.cached = cfg;
				return cfg;
			} catch {
				// 损坏配置按空处理，不抛出导致服务不可用
			}
		}
		this.cached = { enabled: false, deviceId: "", deviceName: "", groupId: "" };
		return this.cached;
	}

	private save(cfg: StoredConfig): void {
		this.ensureDir();
		this.cached = cfg;
		const tmp = this.configPath + ".tmp";
		writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
		// 原子替换
		renameSync(tmp, this.configPath);
	}

	getEnabled(): boolean {
		return this.load().enabled;
	}

	getDeviceId(): string {
		return this.load().deviceId;
	}

	getDeviceName(): string {
		return this.load().deviceName;
	}

	getGroupId(): string {
		return this.load().groupId;
	}

	/** 返回明文 TidbConfig（内存态，不持久化明文）。 */
	getTidbConfig(): TidbConfig | null {
		const cfg = this.load().tidb;
		if (!cfg) return null;
		return {
			host: cfg.host,
			port: cfg.port,
			user: cfg.user,
			password: this.decrypt(cfg.passwordEnc),
			database: cfg.database,
		};
	}

	saveTidbConfig(cfg: TidbConfig): void {
		const s = this.load();
		s.tidb = {
			host: cfg.host,
			port: cfg.port,
			user: cfg.user,
			passwordEnc: this.encrypt(cfg.password),
			database: cfg.database,
		};
		this.save(s);
	}

	setEnabled(enabled: boolean): void {
		const s = this.load();
		s.enabled = enabled;
		this.save(s);
	}

	/** 云账号用户名（明文，安全信息不含密码）。 */
	getAccountUsername(): string {
		return this.load().accountUsername ?? "";
	}

	setAccountUsername(username: string): void {
		const s = this.load();
		s.accountUsername = username.trim();
		this.save(s);
	}

	setDevice(deviceId: string, deviceName: string, groupId: string): void {
		const s = this.load();
		s.deviceId = deviceId;
		s.deviceName = deviceName;
		s.groupId = groupId;
		this.save(s);
	}

	/** 停用：清除连接凭据与加密密钥，仅保留 enabled=false 与设备身份。 */
	clearCredentials(): void {
		const s = this.load();
		s.tidb = undefined;
		s.enabled = false;
		this.save(s);
	}

	/** 判断是否存在已保存的连接配置（用于 /api/sync/test 与状态展示）。 */
	hasConfig(): boolean {
		return this.load().tidb !== undefined;
	}
}
