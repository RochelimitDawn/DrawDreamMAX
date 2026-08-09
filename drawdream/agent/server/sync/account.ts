/**
 * 账号上云与设备配对。
 *
 * 模型：多设备共享账号。账号在 TiDB accounts 表注册一次（owner 为首设备），
 * 后续设备用相同账号连接同一库 → 自动识别为组员，触发全量拉取。
 *
 * 设备身份（device_id）持久化于 SyncConfigStore；重启后沿用。
 */

import { randomBytes } from "node:crypto";

import { verifyPassword } from "../../src/auth/password.ts";
import type { TiDBClient } from "./tidb.ts";
import type { AccountRow } from "./types.ts";

export interface AccountServiceOptions {
	client: TiDBClient;
	deviceId: string;
	deviceName: string;
}

export type RegisterResult =
	| { ok: true; account: AccountRow; newAccount: boolean }
	| { ok: false; error: string };

export type LoginResult =
	| { ok: true; account: AccountRow }
	| { ok: false; error: "not-found" | "invalid-password" };

function newId(): string {
	return randomBytes(16).toString("hex");
}

export class AccountService {
	private readonly client: TiDBClient;
	private readonly deviceId: string;
	private readonly deviceName: string;

	constructor(opts: AccountServiceOptions) {
		this.client = opts.client;
		this.deviceId = opts.deviceId;
		this.deviceName = opts.deviceName;
	}

	/**
	 * 带本地密码哈希注册（首设备初始化用）。
	 * 云端已有账号则视为登录，校验通过后登记设备。
	 */
	async registerWithHash(
		username: string,
		passwordSalt: string,
		passwordHash: string,
		password: string,
	): Promise<RegisterResult> {
		const existing = await this.client.findAccount(username.trim());
		if (existing) {
			if (!verifyPassword(password, existing.passwordSalt, existing.passwordHash)) {
				return { ok: false, error: "invalid-password" };
			}
			await this.registerDevice();
			return { ok: true, account: existing, newAccount: false };
		}
		const account: AccountRow = {
			id: newId(),
			username: username.trim(),
			passwordSalt,
			passwordHash,
			kdf: "scrypt",
			ownerDeviceId: this.deviceId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};
		await this.client.upsertAccount(account);
		await this.registerDevice();
		return { ok: true, account, newAccount: true };
	}

	/** 云端登录校验（凭据已由调用方从本地 sqlite 解析）。 */
	async login(username: string, password: string): Promise<LoginResult> {
		const existing = await this.client.findAccount(username.trim());
		if (!existing) return { ok: false, error: "not-found" };
		if (!verifyPassword(password, existing.passwordSalt, existing.passwordHash)) {
			return { ok: false, error: "invalid-password" };
		}
		await this.registerDevice();
		return { ok: true, account: existing };
	}

	/** 登记当前设备到 devices 表（配对的核心：同账号同库即组员）。 */
	async registerDevice(): Promise<void> {
		await this.client.upsertDevice({
			deviceId: this.deviceId,
			name: this.deviceName,
			lastSeenAt: Date.now(),
			createdAt: Date.now(),
			active: true,
		});
	}

	async listDevices(): Promise<{ deviceId: string; name: string; lastSeenAt: number; active: boolean }[]> {
		const devices = await this.client.listDevices();
		return devices.map((d) => ({
			deviceId: d.deviceId,
			name: d.name,
			lastSeenAt: d.lastSeenAt,
			active: d.active,
		}));
	}

	async renameDevice(deviceId: string, name: string): Promise<void> {
		await this.client.renameDevice(deviceId, name);
	}

	async removeDevice(deviceId: string): Promise<void> {
		await this.client.removeDevice(deviceId);
	}
}
