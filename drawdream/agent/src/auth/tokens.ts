/**
 * 会话 Token：随机串 + SHA-256 存库；附带设备/地理信息（地理由客户端上报）。
 */

import { createHash, randomBytes } from "node:crypto";
import { getAuthDb } from "./db.ts";
import { findUserById, toPublic, type PublicUser } from "./users.ts";
import { parseUserAgent } from "./ua.ts";

export const AUTH_COOKIE = "dd_session";
const MAX_TOKENS_PER_USER = 20;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export type SessionDeviceRow = {
	sessionId: string;
	createdAt: number;
	lastSeenAt: number;
	expiresAt: number | null;
	userAgent: string | null;
	deviceName: string;
	browser: string;
	os: string;
	ip: string;
	location: string;
	current: boolean;
};

function ensureSessionColumns(): void {
	const db = getAuthDb();
	const cols = db.prepare("PRAGMA table_info(sessions_token)").all() as Array<{ name: string }>;
	const have = new Set(cols.map((c) => c.name));
	const add = (name: string, def: string) => {
		if (!have.has(name)) db.exec(`ALTER TABLE sessions_token ADD COLUMN ${name} ${def}`);
	};
	add("session_id", "TEXT");
	add("ip", "TEXT");
	add("location", "TEXT");
	add("device_name", "TEXT");
	add("browser", "TEXT");
	add("os", "TEXT");
	add("last_seen_at", "INTEGER");
}

export function issueSessionToken(
	userId: string,
	opts?: { userAgent?: string; ttlMs?: number },
): { token: string; sessionId: string } {
	ensureSessionColumns();
	const token = randomBytes(32).toString("hex");
	const tokenHash = hashToken(token);
	const sessionId = randomBytes(12).toString("hex");
	const now = Date.now();
	const ttl = opts?.ttlMs ?? DEFAULT_TTL_MS;
	const expires = now + ttl;
	const ua = opts?.userAgent ?? null;
	const info = parseUserAgent(ua);
	const db = getAuthDb();
	db.prepare(
		`INSERT INTO sessions_token(
			token_hash, user_id, created_at, expires_at, user_agent,
			session_id, ip, location, device_name, browser, os, last_seen_at
		) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
	).run(
		tokenHash,
		userId,
		now,
		expires,
		ua,
		sessionId,
		"",
		"",
		info.deviceName,
		info.browser,
		info.os,
		now,
	);

	const rows = db
		.prepare("SELECT token_hash FROM sessions_token WHERE user_id = ? ORDER BY created_at ASC")
		.all(userId) as Array<{ token_hash: string }>;
	if (rows.length > MAX_TOKENS_PER_USER) {
		const drop = rows.slice(0, rows.length - MAX_TOKENS_PER_USER);
		const del = db.prepare("DELETE FROM sessions_token WHERE token_hash = ?");
		for (const r of drop) del.run(r.token_hash);
	}
	return { token, sessionId };
}

export function revokeSessionToken(token: string | undefined): void {
	if (!token) return;
	ensureSessionColumns();
	getAuthDb().prepare("DELETE FROM sessions_token WHERE token_hash = ?").run(hashToken(token));
}

export function revokeAllUserTokens(userId: string): void {
	ensureSessionColumns();
	getAuthDb().prepare("DELETE FROM sessions_token WHERE user_id = ?").run(userId);
}

export function revokeUserSessionById(userId: string, sessionId: string): boolean {
	ensureSessionColumns();
	const db = getAuthDb();
	const sid = String(sessionId ?? "").trim();
	if (!sid) return false;

	// 正常路径：真实 session_id
	let r = db.prepare("DELETE FROM sessions_token WHERE user_id = ? AND session_id = ?").run(userId, sid);
	if (Number(r.changes) > 0) return true;

	// 兼容旧列表：session_id 为空时前端曾用 token_hash 前 16 位作 ID
	if (/^[a-f0-9]{16}$/i.test(sid)) {
		const prefix = sid.toLowerCase();
		r = db
			.prepare(
				`DELETE FROM sessions_token
				 WHERE user_id = ?
				   AND (session_id IS NULL OR session_id = '')
				   AND lower(substr(token_hash, 1, 16)) = ?`,
			)
			.run(userId, prefix);
		if (Number(r.changes) > 0) return true;
	}
	return false;
}

/** 列表展示前为缺失 session_id 的旧行补齐，保证注销 ID 与库一致 */
function ensureRowSessionId(tokenHash: string, existing: string | null | undefined): string {
	if (existing) return existing;
	const sessionId = randomBytes(12).toString("hex");
	getAuthDb()
		.prepare(
			`UPDATE sessions_token SET session_id = ?
			 WHERE token_hash = ? AND (session_id IS NULL OR session_id = '')`,
		)
		.run(sessionId, tokenHash);
	const row = getAuthDb()
		.prepare("SELECT session_id FROM sessions_token WHERE token_hash = ?")
		.get(tokenHash) as { session_id: string | null } | undefined;
	return row?.session_id || sessionId;
}

export function resolveSessionToken(token: string | undefined): PublicUser | null {
	if (!token) return null;
	ensureSessionColumns();
	const row = getAuthDb()
		.prepare("SELECT user_id, expires_at FROM sessions_token WHERE token_hash = ?")
		.get(hashToken(token)) as { user_id: string; expires_at: number | null } | undefined;
	if (!row) return null;
	if (row.expires_at != null && row.expires_at < Date.now()) {
		getAuthDb().prepare("DELETE FROM sessions_token WHERE token_hash = ?").run(hashToken(token));
		return null;
	}
	const u = findUserById(row.user_id);
	if (!u || u.disabled) return null;
	return toPublic(u);
}

export function touchSession(token: string | undefined): void {
	if (!token) return;
	ensureSessionColumns();
	getAuthDb()
		.prepare("UPDATE sessions_token SET last_seen_at = ? WHERE token_hash = ?")
		.run(Date.now(), hashToken(token));
}

/** 客户端上报公网 IP / 归属（浏览器调 UAPI myip 后） */
export function updateSessionGeo(
	token: string | undefined,
	geo: { ip?: string; location?: string; deviceName?: string },
): boolean {
	if (!token) return false;
	ensureSessionColumns();
	const h = hashToken(token);
	const row = getAuthDb()
		.prepare("SELECT token_hash FROM sessions_token WHERE token_hash = ?")
		.get(h) as { token_hash: string } | undefined;
	if (!row) return false;
	const ip = typeof geo.ip === "string" ? geo.ip.slice(0, 64) : undefined;
	const location = typeof geo.location === "string" ? geo.location.slice(0, 200) : undefined;
	const deviceName = typeof geo.deviceName === "string" ? geo.deviceName.slice(0, 120) : undefined;
	const now = Date.now();
	if (ip !== undefined && location !== undefined && deviceName !== undefined) {
		getAuthDb()
			.prepare(
				"UPDATE sessions_token SET ip=?, location=?, device_name=?, last_seen_at=? WHERE token_hash=?",
			)
			.run(ip, location, deviceName, now, h);
	} else if (ip !== undefined && location !== undefined) {
		getAuthDb()
			.prepare("UPDATE sessions_token SET ip=?, location=?, last_seen_at=? WHERE token_hash=?")
			.run(ip, location, now, h);
	} else if (ip !== undefined) {
		getAuthDb().prepare("UPDATE sessions_token SET ip=?, last_seen_at=? WHERE token_hash=?").run(ip, now, h);
	} else if (location !== undefined) {
		getAuthDb()
			.prepare("UPDATE sessions_token SET location=?, last_seen_at=? WHERE token_hash=?")
			.run(location, now, h);
	} else {
		getAuthDb().prepare("UPDATE sessions_token SET last_seen_at=? WHERE token_hash=?").run(now, h);
	}
	return true;
}

export function listUserSessions(userId: string, currentToken?: string): SessionDeviceRow[] {
	ensureSessionColumns();
	const curHash = currentToken ? hashToken(currentToken) : "";
	const rows = getAuthDb()
		.prepare(
			`SELECT token_hash, session_id, created_at, expires_at, user_agent, ip, location,
			        device_name, browser, os, last_seen_at
			 FROM sessions_token WHERE user_id = ? ORDER BY COALESCE(last_seen_at, created_at) DESC`,
		)
		.all(userId) as Array<{
		token_hash: string;
		session_id: string | null;
		created_at: number;
		expires_at: number | null;
		user_agent: string | null;
		ip: string | null;
		location: string | null;
		device_name: string | null;
		browser: string | null;
		os: string | null;
		last_seen_at: number | null;
	}>;

	const out: SessionDeviceRow[] = [];
	for (const r of rows) {
		if (r.expires_at != null && r.expires_at < Date.now()) continue;
		const parsed = parseUserAgent(r.user_agent);
		const sessionId = ensureRowSessionId(r.token_hash, r.session_id);
		out.push({
			sessionId,
			createdAt: r.created_at,
			lastSeenAt: r.last_seen_at || r.created_at,
			expiresAt: r.expires_at,
			userAgent: r.user_agent,
			deviceName: r.device_name || parsed.deviceName,
			browser: r.browser || parsed.browser,
			os: r.os || parsed.os,
			ip: r.ip || "",
			location: r.location || "",
			current: r.token_hash === curHash,
		});
	}
	return out;
}

export function parseCookies(header: string | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!header) return out;
	for (const part of header.split(";")) {
		const i = part.indexOf("=");
		if (i > 0) {
			try {
				out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
			} catch {
				/* ignore */
			}
		}
	}
	return out;
}

export function readBearer(header: string | undefined): string | undefined {
	if (!header) return undefined;
	const m = header.match(/^Bearer\s+(\S+)/i);
	return m?.[1];
}

export function extractAuthToken(req: {
	headers: { cookie?: string; authorization?: string };
}): string | undefined {
	const bearer = readBearer(req.headers.authorization);
	if (bearer) return bearer;
	return parseCookies(req.headers.cookie)[AUTH_COOKIE];
}
