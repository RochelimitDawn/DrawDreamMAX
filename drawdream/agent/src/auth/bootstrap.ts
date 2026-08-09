/**
 * 首次启动 Bootstrap Admin + 实例配置。
 */

import { getMeta, setMeta } from "./db.ts";
import { countAdmins, createUser, findUserByUsername } from "./users.ts";
import { dataRootFromEnv, ensureUserWorkspace, maybeMigrateLegacyIntoAdmin, userWorkspacePath } from "./workspace.ts";

export type InstanceConfig = {
	allowRegistration: boolean;
	authMode: "multi" | "single";
	defaultAdminUsername: string;
	/** 仅用于日志提示，不回传明文 */
	defaultPasswordIsFactory: boolean;
};

const FACTORY_ADMIN_USER = "admin";
const FACTORY_ADMIN_PASSWORD = "DrawDream!Admin";

export function readEnvAllowRegistration(): boolean {
	const v = process.env.DD_ALLOW_REGISTER?.trim().toLowerCase();
	if (v === "0" || v === "false" || v === "no") return false;
	if (v === "1" || v === "true" || v === "yes") return true;
	const meta = getMeta("allowRegistration");
	if (typeof meta === "boolean") return meta;
	return true;
}

export function setAllowRegistration(v: boolean): void {
	setMeta("allowRegistration", v);
}

export function getAuthMode(): "multi" | "single" {
	const v = process.env.DD_AUTH_MODE?.trim().toLowerCase();
	if (v === "single") return "single";
	return "multi";
}

export function bootstrapAuth(processCwd: string): {
	dataRoot: string;
	adminId: string | null;
	logs: string[];
	config: InstanceConfig;
} {
	const dataRoot = dataRootFromEnv(processCwd);
	const logs: string[] = [];
	const adminUser = (process.env.DD_ADMIN_USER?.trim() || FACTORY_ADMIN_USER).slice(0, 32);
	const adminPass = process.env.DD_ADMIN_PASSWORD?.trim() || FACTORY_ADMIN_PASSWORD;
	const factoryPass = adminPass === FACTORY_ADMIN_PASSWORD && !process.env.DD_ADMIN_PASSWORD;

	let adminId: string | null = null;

	if (countAdmins() === 0) {
		const existing = findUserByUsername(adminUser);
		if (existing) {
			adminId = existing.id;
			logs.push(`已有用户 ${adminUser}，提升为 admin 需手动 API`);
		} else {
			const r = createUser({ username: adminUser, password: adminPass, role: "admin" });
			if (r.ok) {
				adminId = r.user.id;
				logs.push(`已创建 Bootstrap Admin「${adminUser}」`);
				if (factoryPass) {
					logs.push("警告：正在使用出厂默认管理员密码，请登录后尽快修改");
				}
			} else {
				logs.push(`创建 Admin 失败：${r.code}`);
			}
		}
	} else {
		const u = findUserByUsername(adminUser);
		adminId = u?.id ?? null;
	}

	if (adminId) {
		const ws = userWorkspacePath(dataRoot, adminId);
		ensureUserWorkspace(ws);
		const migrated = getMeta("legacyMigrated") === true;
		const mig = maybeMigrateLegacyIntoAdmin(processCwd, dataRoot, adminId, migrated);
		if (mig.length) {
			logs.push(...mig);
			setMeta("legacyMigrated", true);
		} else if (!migrated) {
			setMeta("legacyMigrated", true);
		}
	}

	// 确保 allowRegistration meta 存在
	if (getMeta("allowRegistration") === null) {
		setMeta("allowRegistration", readEnvAllowRegistration());
	}

	return {
		dataRoot,
		adminId,
		logs,
		config: {
			allowRegistration: readEnvAllowRegistration(),
			authMode: getAuthMode(),
			defaultAdminUsername: adminUser,
			defaultPasswordIsFactory: factoryPass && countAdmins() <= 1,
		},
	};
}

export { FACTORY_ADMIN_PASSWORD, FACTORY_ADMIN_USER };
