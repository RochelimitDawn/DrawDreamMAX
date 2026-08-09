/**
 * 密码哈希：scrypt 加盐（与 access.ts 同算法族）。
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string, salt?: string): { salt: string; hash: string } {
	const s = salt ?? randomBytes(16).toString("hex");
	const hash = scryptSync(password, s, 64).toString("hex");
	return { salt: s, hash };
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
	const a = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "hex");
	const b = Buffer.from(hash, "hex");
	return a.length === b.length && timingSafeEqual(a, b);
}

export function isPasswordStrongEnough(password: string): boolean {
	return typeof password === "string" && password.length >= 6 && password.length <= 128;
}

export function isUsernameValid(username: string): boolean {
	if (typeof username !== "string") return false;
	const u = username.trim();
	if (u.length < 2 || u.length > 32) return false;
	return /^[\w\u4e00-\u9fff.-]+$/.test(u);
}
