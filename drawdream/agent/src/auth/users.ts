/**
 * 用户 CRUD。
 */

import { randomBytes } from "node:crypto";
import { type DbUser, type UserRole, getAuthDb } from "./db.ts";
import { hashPassword, isPasswordStrongEnough, isUsernameValid, verifyPassword } from "./password.ts";

export type PublicUser = {
	id: string;
	username: string;
	role: UserRole;
};

export function toPublic(u: DbUser): PublicUser {
	return { id: u.id, username: u.username, role: u.role };
}

function newId(): string {
	return randomBytes(16).toString("hex");
}

export function countUsers(): number {
	const row = getAuthDb().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
	return Number(row.c);
}

export function countAdmins(): number {
	const row = getAuthDb().prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get() as {
		c: number;
	};
	return Number(row.c);
}

export function findUserByUsername(username: string): DbUser | null {
	const row = getAuthDb().prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username.trim()) as
		| DbUser
		| undefined;
	return row ?? null;
}

export function findUserById(id: string): DbUser | null {
	const row = getAuthDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as DbUser | undefined;
	return row ?? null;
}

export function listUsers(): PublicUser[] {
	const rows = getAuthDb()
		.prepare("SELECT id, username, role, disabled, created_at FROM users ORDER BY created_at ASC")
		.all() as Array<DbUser & { disabled: number }>;
	return rows.map((r) => ({
		id: r.id,
		username: r.username,
		role: r.role,
		// 扩展字段供管理端
		...(r as object),
	})) as PublicUser[];
}

export function listUsersAdmin(): Array<PublicUser & { disabled: boolean; createdAt: number }> {
	const rows = getAuthDb()
		.prepare("SELECT id, username, role, disabled, created_at FROM users ORDER BY created_at ASC")
		.all() as Array<{
		id: string;
		username: string;
		role: UserRole;
		disabled: number;
		created_at: number;
	}>;
	return rows.map((r) => ({
		id: r.id,
		username: r.username,
		role: r.role,
		disabled: !!r.disabled,
		createdAt: r.created_at,
	}));
}

export type CreateUserResult =
	| { ok: true; user: PublicUser }
	| { ok: false; code: "USERNAME_INVALID" | "PASSWORD_WEAK" | "USERNAME_TAKEN" };

export function createUser(input: {
	username: string;
	password: string;
	role?: UserRole;
}): CreateUserResult {
	if (!isUsernameValid(input.username)) return { ok: false, code: "USERNAME_INVALID" };
	if (!isPasswordStrongEnough(input.password)) return { ok: false, code: "PASSWORD_WEAK" };
	if (findUserByUsername(input.username)) return { ok: false, code: "USERNAME_TAKEN" };
	const now = Date.now();
	const { salt, hash } = hashPassword(input.password);
	const id = newId();
	const role: UserRole = input.role === "admin" ? "admin" : "user";
	getAuthDb()
		.prepare(
			`INSERT INTO users(id, username, password_salt, password_hash, role, disabled, created_at, updated_at)
			 VALUES(?,?,?,?,?,0,?,?)`,
		)
		.run(id, input.username.trim(), salt, hash, role, now, now);
	const user = findUserById(id)!;
	return { ok: true, user: toPublic(user) };
}

export function verifyUserLogin(
	username: string,
	password: string,
): { ok: true; user: PublicUser } | { ok: false; code: "INVALID" | "USER_DISABLED" } {
	const u = findUserByUsername(username);
	if (!u) return { ok: false, code: "INVALID" };
	if (u.disabled) return { ok: false, code: "USER_DISABLED" };
	if (!verifyPassword(password, u.password_salt, u.password_hash)) return { ok: false, code: "INVALID" };
	return { ok: true, user: toPublic(u) };
}

export function setUserPassword(userId: string, password: string): boolean {
	if (!isPasswordStrongEnough(password)) return false;
	const { salt, hash } = hashPassword(password);
	const now = Date.now();
	const r = getAuthDb()
		.prepare("UPDATE users SET password_salt=?, password_hash=?, updated_at=? WHERE id=?")
		.run(salt, hash, now, userId);
	return Number(r.changes) > 0;
}

export function setUserDisabled(userId: string, disabled: boolean): boolean {
	const now = Date.now();
	const r = getAuthDb()
		.prepare("UPDATE users SET disabled=?, updated_at=? WHERE id=?")
		.run(disabled ? 1 : 0, now, userId);
	return Number(r.changes) > 0;
}

export function setUserRole(userId: string, role: UserRole): boolean {
	const now = Date.now();
	const r = getAuthDb().prepare("UPDATE users SET role=?, updated_at=? WHERE id=?").run(role, now, userId);
	return Number(r.changes) > 0;
}

export type DeleteUserResult =
	| { ok: true }
	| {
			ok: false;
			code: "NOT_FOUND" | "SELF" | "LAST_ADMIN" | "CONFIRM_MISMATCH";
	  };

/** 硬删用户行（sessions / settings 依赖 ON DELETE CASCADE） */
export function deleteUser(
	userId: string,
	opts: { actorId: string; confirmUsername: string },
): DeleteUserResult {
	const target = findUserById(userId);
	if (!target) return { ok: false, code: "NOT_FOUND" };
	if (target.id === opts.actorId) return { ok: false, code: "SELF" };
	const confirm = String(opts.confirmUsername ?? "").trim();
	if (!confirm || confirm.toLowerCase() !== target.username.toLowerCase()) {
		return { ok: false, code: "CONFIRM_MISMATCH" };
	}
	if (target.role === "admin" && countAdmins() <= 1) {
		return { ok: false, code: "LAST_ADMIN" };
	}
	const r = getAuthDb().prepare("DELETE FROM users WHERE id = ?").run(userId);
	if (Number(r.changes) <= 0) return { ok: false, code: "NOT_FOUND" };
	return { ok: true };
}

export function getUserSettings(userId: string): unknown | null {
	const row = getAuthDb().prepare("SELECT payload_json FROM user_settings WHERE user_id = ?").get(userId) as
		| { payload_json: string }
		| undefined;
	if (!row) return null;
	try {
		return JSON.parse(row.payload_json) as unknown;
	} catch {
		return null;
	}
}

export function putUserSettings(userId: string, payload: unknown): void {
	const now = Date.now();
	getAuthDb()
		.prepare(
			`INSERT INTO user_settings(user_id, payload_json, updated_at) VALUES(?,?,?)
			 ON CONFLICT(user_id) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at`,
		)
		.run(userId, JSON.stringify(payload), now);
}
