/**
 * 多用户认证 / 管理 / 用户设置 HTTP。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
	AUTH_COOKIE,
	type PublicUser,
	adminPublicUapi,
	clientUapiBundle,
	createUser,
	deleteUser,
	extractAuthToken,
	findUserById,
	findUserByUsername,
	getAuthMode,
	getUserSettings,
	toPublic,
	issueSessionToken,
	listUserSessions,
	listUsersAdmin,
	putUserSettings,
	readEnvAllowRegistration,
	resolveSessionToken,
	revokeAllUserTokens,
	revokeSessionToken,
	revokeUserSessionById,
	setAllowRegistration,
	setUapiConfig,
	setUserDisabled,
	setUserPassword,
	setUserRole,
	touchSession,
	updateSessionGeo,
	verifyUserLogin,
	ensureUserWorkspace,
	purgeUserHome,
	userWorkspacePath,
	FACTORY_ADMIN_PASSWORD,
	FACTORY_ADMIN_USER,
	type UserRole,
} from "../src/auth/index.ts";

export type AuthHttpDeps = {
	dataRoot: string;
	getAllowRegistration: () => boolean;
	defaultPasswordIsFactory: boolean;
	/** 登录限速：连续失败次数 */
	loginFails: { count: number };
	/** 二期：UserRuntime 池统计（管理员） */
	getPoolStats?: () => unknown;
	/** 强制释放用户 runtime（踢下线 / 删用户） */
	releaseUserRuntime?: (userId: string) => Promise<void> | void;
};

export type AuthContext = {
	user: PublicUser;
	token: string;
	workspaceCwd: string;
};

function sendJson(res: ServerResponse, code: number, body: unknown, setCookie?: string | null): void {
	const headers: Record<string, string | number | string[]> = {
		"content-type": "application/json; charset=utf-8",
	};
	if (setCookie !== undefined) {
		const base = `${AUTH_COOKIE}=${setCookie ?? ""}; Path=/; HttpOnly; SameSite=Strict`;
		headers["set-cookie"] = setCookie ? `${base}; Max-Age=${30 * 24 * 3600}` : `${base}; Max-Age=0`;
	}
	res.writeHead(code, headers);
	res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const c of req) {
		const buf = Buffer.isBuffer(c) ? c : Buffer.from(c as string);
		size += buf.length;
		if (size > 65536) throw new Error("body_too_large");
		chunks.push(buf);
	}
	if (!chunks.length) return {};
	return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

export function resolveAuthContext(req: IncomingMessage, dataRoot: string): AuthContext | null {
	const token = extractAuthToken(req);
	const user = resolveSessionToken(token);
	if (!user || !token) return null;
	const workspaceCwd = userWorkspacePath(dataRoot, user.id);
	ensureUserWorkspace(workspaceCwd);
	return { user, token, workspaceCwd };
}

export function setAuthCookieHeader(res: ServerResponse, token: string | null): void {
	const base = `${AUTH_COOKIE}=${token ?? ""}; Path=/; HttpOnly; SameSite=Strict`;
	res.setHeader("set-cookie", token ? `${base}; Max-Age=${30 * 24 * 3600}` : `${base}; Max-Age=0`);
}

/**
 * 处理 /api/auth/* /api/admin/* /api/user/settings
 * @returns true 已处理
 */
export async function handleAuthApi(
	req: IncomingMessage,
	res: ServerResponse,
	deps: AuthHttpDeps,
): Promise<boolean> {
	const url = (req.url ?? "/").split("?")[0];
	const route = `${req.method} ${url}`;

	const isAuth =
		url.startsWith("/api/auth/") ||
		url.startsWith("/api/admin/") ||
		url.startsWith("/api/uapi/") ||
		url === "/api/user/settings";
	if (!isAuth) return false;

	try {
		// ---- 公开 ----
		if (route === "GET /api/auth/status") {
			const ctx = resolveAuthContext(req, deps.dataRoot);
			const mode = getAuthMode();
			sendJson(res, 200, {
				mode,
				allowRegistration: mode === "single" ? false : deps.getAllowRegistration(),
				user: ctx?.user ?? null,
				defaultPasswordIsFactory: !!(deps.defaultPasswordIsFactory && ctx?.user.role === "admin"),
			});
			return true;
		}

		// 单机模式：自动签发本地 admin 会话（无密码 UI）
		if (route === "POST /api/auth/local-session") {
			if (getAuthMode() !== "single") {
				sendJson(res, 403, { error: "仅单机模式可用", code: "NOT_SINGLE" });
				return true;
			}
			const existing = resolveAuthContext(req, deps.dataRoot);
			if (existing) {
				sendJson(res, 200, { ok: true, user: existing.user });
				return true;
			}
			const adminName = (process.env.DD_ADMIN_USER?.trim() || FACTORY_ADMIN_USER).slice(0, 32);
			let pub: PublicUser | null = null;
			const existingDb = findUserByUsername(adminName);
			if (existingDb) {
				pub = toPublic(existingDb);
			} else {
				const r = createUser({
					username: adminName,
					password: process.env.DD_ADMIN_PASSWORD?.trim() || FACTORY_ADMIN_PASSWORD,
					role: "admin",
				});
				if (!r.ok) {
					sendJson(res, 500, { error: `创建本地用户失败：${r.code}`, code: r.code });
					return true;
				}
				pub = r.user;
			}
			ensureUserWorkspace(userWorkspacePath(deps.dataRoot, pub.id));
			const issued = issueSessionToken(pub.id, { userAgent: req.headers["user-agent"] });
			sendJson(res, 200, { ok: true, user: pub, sessionId: issued.sessionId }, issued.token);
			return true;
		}

		if (route === "POST /api/auth/register") {
			if (!deps.getAllowRegistration()) {
				sendJson(res, 403, { error: "注册已关闭", code: "REGISTER_CLOSED" });
				return true;
			}
			const body = await readJson(req);
			const username = String(body.username ?? "");
			const password = String(body.password ?? "");
			const r = createUser({ username, password, role: "user" });
			if (!r.ok) {
				const map: Record<string, { code: number; error: string }> = {
					USERNAME_INVALID: { code: 400, error: "用户名不合法（2–32 位，中英文数字._-）" },
					PASSWORD_WEAK: { code: 400, error: "密码至少 6 位" },
					USERNAME_TAKEN: { code: 409, error: "用户名已被占用" },
				};
				const m = map[r.code] ?? { code: 400, error: r.code };
				sendJson(res, m.code, { error: m.error, code: r.code });
				return true;
			}
			ensureUserWorkspace(userWorkspacePath(deps.dataRoot, r.user.id));
			const issued = issueSessionToken(r.user.id, { userAgent: req.headers["user-agent"] });
			sendJson(res, 200, { ok: true, user: r.user, sessionId: issued.sessionId }, issued.token);
			return true;
		}

		if (route === "POST /api/auth/login") {
			if (deps.loginFails.count >= 8) {
				await new Promise((r) => setTimeout(r, 2000));
			} else if (deps.loginFails.count >= 5) {
				await new Promise((r) => setTimeout(r, 800));
			}
			const body = await readJson(req);
			const r = verifyUserLogin(String(body.username ?? ""), String(body.password ?? ""));
			if (!r.ok) {
				deps.loginFails.count++;
				if (r.code === "USER_DISABLED") {
					sendJson(res, 403, { error: "账户已禁用", code: "USER_DISABLED" });
					return true;
				}
				sendJson(res, 401, { error: "用户名或密码错误", code: "INVALID" });
				return true;
			}
			deps.loginFails.count = 0;
			ensureUserWorkspace(userWorkspacePath(deps.dataRoot, r.user.id));
			const issued = issueSessionToken(r.user.id, { userAgent: req.headers["user-agent"] });
			sendJson(res, 200, { ok: true, user: r.user, sessionId: issued.sessionId }, issued.token);
			return true;
		}

		if (route === "POST /api/admin/bootstrap") {
			const expected = process.env.DD_BOOTSTRAP_TOKEN?.trim();
			const got = req.headers["x-bootstrap-token"];
			if (!expected || got !== expected) {
				sendJson(res, 403, { error: "forbidden", code: "BOOTSTRAP_FORBIDDEN" });
				return true;
			}
			// bootstrap 已在启动时完成；此处幂等返回状态
			sendJson(res, 200, {
				ok: true,
				allowRegistration: deps.getAllowRegistration(),
				hint: "Admin 已在进程启动时确保存在",
			});
			return true;
		}

		// ---- 需登录 ----
		const ctx = resolveAuthContext(req, deps.dataRoot);
		if (!ctx) {
			sendJson(res, 401, { error: "需要登录", code: "AUTH_REQUIRED" });
			return true;
		}

		if (route === "POST /api/auth/logout") {
			revokeSessionToken(ctx.token);
			sendJson(res, 200, { ok: true }, null);
			return true;
		}

		if (route === "GET /api/auth/me") {
			touchSession(ctx.token);
			sendJson(res, 200, {
				user: ctx.user,
				defaultPasswordIsFactory:
					deps.defaultPasswordIsFactory &&
					ctx.user.role === "admin" &&
					ctx.user.username.toLowerCase() === "admin",
			});
			return true;
		}

		if (route === "POST /api/auth/password") {
			const body = await readJson(req);
			const oldPassword = String(body.oldPassword ?? "");
			const newPassword = String(body.newPassword ?? "");
			const check = verifyUserLogin(ctx.user.username, oldPassword);
			if (!check.ok) {
				sendJson(res, 403, { error: "当前密码不正确", code: "OLD_PASSWORD" });
				return true;
			}
			if (!setUserPassword(ctx.user.id, newPassword)) {
				sendJson(res, 400, { error: "新密码至少 6 位", code: "PASSWORD_WEAK" });
				return true;
			}
			sendJson(res, 200, { ok: true });
			return true;
		}

		// 登录设备列表
		if (route === "GET /api/auth/sessions") {
			touchSession(ctx.token);
			sendJson(res, 200, { sessions: listUserSessions(ctx.user.id, ctx.token) });
			return true;
		}

		// 注销某设备会话
		const mRevoke = /^DELETE \/api\/auth\/sessions\/([^/]+)$/.exec(route);
		if (mRevoke) {
			const sid = decodeURIComponent(mRevoke[1]);
			const ok = revokeUserSessionById(ctx.user.id, sid);
			if (!ok) {
				sendJson(res, 404, { error: "会话不存在", code: "SESSION_NOT_FOUND" });
				return true;
			}
			// 若注销的是当前设备，清 cookie
			const still = listUserSessions(ctx.user.id, ctx.token).some((s) => s.current);
			sendJson(res, 200, { ok: true, currentRevoked: !still }, still ? undefined : null);
			return true;
		}

		// 客户端上报公网 IP（浏览器 UAPI myip 结果）
		if (route === "POST /api/auth/sessions/geo") {
			const body = await readJson(req);
			const ok = updateSessionGeo(ctx.token, {
				ip: typeof body.ip === "string" ? body.ip : undefined,
				location: typeof body.location === "string" ? body.location : undefined,
				deviceName: typeof body.deviceName === "string" ? body.deviceName : undefined,
			});
			sendJson(res, ok ? 200 : 400, { ok });
			return true;
		}

		// 浏览器拉 UAPI 配置（含可选 apiKey，用于直连 myip）
		if (route === "GET /api/uapi/client") {
			sendJson(res, 200, clientUapiBundle());
			return true;
		}

		if (route === "GET /api/user/settings") {
			const payload = getUserSettings(ctx.user.id);
			sendJson(res, 200, { settings: payload });
			return true;
		}

		if (route === "PUT /api/user/settings") {
			const body = await readJson(req);
			const settings = body.settings ?? body;
			putUserSettings(ctx.user.id, settings);
			sendJson(res, 200, { ok: true });
			return true;
		}

		// ---- Admin ----
		if (url.startsWith("/api/admin/")) {
			if (ctx.user.role !== "admin") {
				sendJson(res, 403, { error: "需要管理员", code: "ADMIN_ONLY" });
				return true;
			}

			if (route === "GET /api/admin/users") {
				sendJson(res, 200, { users: listUsersAdmin() });
				return true;
			}

			if (route === "POST /api/admin/users") {
				const body = await readJson(req);
				const role = body.role === "admin" ? "admin" : "user";
				const r = createUser({
					username: String(body.username ?? ""),
					password: String(body.password ?? ""),
					role: role as UserRole,
				});
				if (!r.ok) {
					sendJson(res, 400, { error: r.code, code: r.code });
					return true;
				}
				ensureUserWorkspace(userWorkspacePath(deps.dataRoot, r.user.id));
				sendJson(res, 200, { ok: true, user: r.user });
				return true;
			}

			if (route === "GET /api/admin/settings") {
				sendJson(res, 200, {
					allowRegistration: deps.getAllowRegistration(),
					defaultPasswordIsFactory: deps.defaultPasswordIsFactory,
					factoryPasswordHint: deps.defaultPasswordIsFactory ? FACTORY_ADMIN_PASSWORD : undefined,
					uapi: adminPublicUapi(),
				});
				return true;
			}

			if (route === "PUT /api/admin/settings") {
				const body = await readJson(req);
				if (typeof body.allowRegistration === "boolean") {
					setAllowRegistration(body.allowRegistration);
				}
				sendJson(res, 200, {
					ok: true,
					allowRegistration: readEnvAllowRegistration(),
					uapi: adminPublicUapi(),
				});
				return true;
			}

			if (route === "GET /api/admin/uapi") {
				sendJson(res, 200, { uapi: adminPublicUapi() });
				return true;
			}

			if (route === "GET /api/admin/runtime-stats") {
				sendJson(res, 200, deps.getPoolStats ? deps.getPoolStats() : { runtimes: 0, maxRuntimes: 0, connections: 0, users: [] });
				return true;
			}

			if (route === "PUT /api/admin/uapi") {
				const body = await readJson(req);
				const next = setUapiConfig({
					enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
					baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
					apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
					source: body.source === "commercial" || body.source === "standard" ? body.source : undefined,
					clearApiKey: body.clearApiKey === true,
				});
				sendJson(res, 200, {
					ok: true,
					uapi: {
						enabled: next.enabled,
						baseUrl: next.baseUrl,
						source: next.source,
						hasApiKey: Boolean(next.apiKey),
					},
				});
				return true;
			}

			// /api/admin/users/:id/...
			const mReset = /^POST \/api\/admin\/users\/([^/]+)\/reset-password$/.exec(route);
			if (mReset) {
				const id = decodeURIComponent(mReset[1]);
				const body = await readJson(req);
				const pw = String(body.password ?? "");
				if (!setUserPassword(id, pw)) {
					sendJson(res, 400, { error: "密码不合法", code: "PASSWORD_WEAK" });
					return true;
				}
				sendJson(res, 200, { ok: true });
				return true;
			}

			const mKick = /^POST \/api\/admin\/users\/([^/]+)\/kick$/.exec(route);
			if (mKick) {
				const id = decodeURIComponent(mKick[1]);
				const target = findUserById(id);
				if (!target) {
					sendJson(res, 404, { error: "用户不存在", code: "NOT_FOUND" });
					return true;
				}
				revokeAllUserTokens(id);
				await deps.releaseUserRuntime?.(id);
				sendJson(res, 200, { ok: true });
				return true;
			}

			const mGetUser = /^GET \/api\/admin\/users\/([^/]+)$/.exec(route);
			if (mGetUser) {
				const id = decodeURIComponent(mGetUser[1]);
				const target = findUserById(id);
				if (!target) {
					sendJson(res, 404, { error: "用户不存在", code: "NOT_FOUND" });
					return true;
				}
				const sessions = listUserSessions(id);
				sendJson(res, 200, {
					user: {
						id: target.id,
						username: target.username,
						role: target.role,
						disabled: !!target.disabled,
						createdAt: target.created_at,
					},
					sessions,
					sessionCount: sessions.length,
				});
				return true;
			}

			const mDelete = /^DELETE \/api\/admin\/users\/([^/]+)$/.exec(route);
			if (mDelete) {
				const id = decodeURIComponent(mDelete[1]);
				const body = await readJson(req).catch(() => ({} as Record<string, unknown>));
				const confirmUsername = String(body.confirmUsername ?? body.username ?? "");
				// 默认一并 purge workspace；仅当显式 purgeWorkspace=false 时保留目录
				const purge = body.purgeWorkspace === false ? false : true;
				const r = deleteUser(id, { actorId: ctx.user.id, confirmUsername });
				if (!r.ok) {
					const status =
						r.code === "NOT_FOUND" ? 404 : r.code === "CONFIRM_MISMATCH" ? 400 : 403;
					const msg: Record<string, string> = {
						NOT_FOUND: "用户不存在",
						SELF: "不能删除当前登录账号",
						LAST_ADMIN: "不能删除最后一个管理员",
						CONFIRM_MISMATCH: "请输入完整用户名以确认删除",
					};
					sendJson(res, status, { error: msg[r.code] ?? r.code, code: r.code });
					return true;
				}
				revokeAllUserTokens(id);
				await deps.releaseUserRuntime?.(id);
				let purged = false;
				if (purge) {
					purged = purgeUserHome(deps.dataRoot, id);
				}
				sendJson(res, 200, { ok: true, purged });
				return true;
			}

			if (route === "POST /api/admin/users/batch") {
				const body = await readJson(req);
				const action = String(body.action ?? "");
				const ids = Array.isArray(body.ids)
					? body.ids.map((x) => String(x)).filter(Boolean)
					: [];
				if (!ids.length) {
					sendJson(res, 400, { error: "缺少用户 id", code: "IDS_REQUIRED" });
					return true;
				}
				if (
					action !== "disable" &&
					action !== "enable" &&
					action !== "kick" &&
					action !== "delete"
				) {
					sendJson(res, 400, { error: "未知批量操作", code: "BAD_ACTION" });
					return true;
				}
				const purge = body.purgeWorkspace === false ? false : true;
				let ok = 0;
				const errors: Array<{ id: string; code: string }> = [];
				for (const id of ids) {
					if (action === "kick") {
						if (id === ctx.user.id) {
							errors.push({ id, code: "SELF" });
							continue;
						}
						const target = findUserById(id);
						if (!target) {
							errors.push({ id, code: "NOT_FOUND" });
							continue;
						}
						revokeAllUserTokens(id);
						await deps.releaseUserRuntime?.(id);
						ok += 1;
						continue;
					}
					if (action === "delete") {
						const target = findUserById(id);
						if (!target) {
							errors.push({ id, code: "NOT_FOUND" });
							continue;
						}
						// 批量删除：服务端用已知用户名作为确认（前端已二次确认）
						const r = deleteUser(id, {
							actorId: ctx.user.id,
							confirmUsername: target.username,
						});
						if (!r.ok) {
							errors.push({ id, code: r.code });
							continue;
						}
						revokeAllUserTokens(id);
						await deps.releaseUserRuntime?.(id);
						if (purge) purgeUserHome(deps.dataRoot, id);
						ok += 1;
						continue;
					}
					if (id === ctx.user.id && action === "disable") {
						errors.push({ id, code: "SELF" });
						continue;
					}
					const target = findUserById(id);
					if (!target) {
						errors.push({ id, code: "NOT_FOUND" });
						continue;
					}
					setUserDisabled(id, action === "disable");
					if (action === "disable") {
						revokeAllUserTokens(id);
						await deps.releaseUserRuntime?.(id);
					}
					ok += 1;
				}
				sendJson(res, 200, { ok: true, count: ok, errors });
				return true;
			}

			const mPatch = /^PATCH \/api\/admin\/users\/([^/]+)$/.exec(route);
			if (mPatch) {
				const id = decodeURIComponent(mPatch[1]);
				const body = await readJson(req);
				if (typeof body.disabled === "boolean") {
					if (body.disabled && id === ctx.user.id) {
						sendJson(res, 403, { error: "不能禁用当前登录账号", code: "SELF" });
						return true;
					}
					setUserDisabled(id, body.disabled);
					if (body.disabled) {
						revokeAllUserTokens(id);
						await deps.releaseUserRuntime?.(id);
					}
				}
				if (body.role === "admin" || body.role === "user") setUserRole(id, body.role);
				sendJson(res, 200, { ok: true });
				return true;
			}

			sendJson(res, 404, { error: "unknown admin endpoint" });
			return true;
		}

		sendJson(res, 404, { error: "unknown auth endpoint" });
		return true;
	} catch (e) {
		sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
		return true;
	}
}
