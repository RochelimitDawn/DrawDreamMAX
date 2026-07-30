/**
 * DrawDream Web 宿主：鉴权、HTTP/WS 路由、UserRuntime 池。
 * 每用户 Agent 会话逻辑见 user-host.ts。
 */

import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, isAbsolute, join, normalize } from "node:path";
import { pipeline } from "node:stream/promises";
import { WebSocketServer, type WebSocket } from "ws";
import { AsyncLocalStorage } from "node:async_hooks";

import {
	ACCESS_COOKIE,
	clearPassword,
	issueToken,
	loadAccess,
	parseCookies,
	setPassword,
	verifyPassword,
	verifyToken,
	type AccessData,
} from "../src/access.ts";
import {
	bootstrapAuth,
	openAuthDb,
	readEnvAllowRegistration,
	type PublicUser,
} from "../src/auth/index.ts";
import { dir as userAssetDir, preferDrawdreamAgentHome, takeAgentMergeLog } from "../src/paths.ts";
import { handleAuthApi, resolveAuthContext } from "./auth-http.ts";
import { handleApiRequest } from "./rest.ts";
import type { ClientFrame, ServerFrame } from "./wire.ts";
import { createUserHost, type UserHost } from "./user-host.ts";
import {
	readPoolEnv,
	RuntimeCreateError,
	RuntimePoolFullError,
	UserRuntimePool,
} from "./user-runtime-pool.ts";

const agentHome = preferDrawdreamAgentHome();

const processCwd = process.cwd();
const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 7620);
const newSessionFlag = process.argv.includes("--new");

const authDataRoot = (() => {
	const root = process.env.DD_DATA_ROOT?.trim() || join(processCwd, "data");
	mkdirSync(root, { recursive: true });
	return root;
})();
openAuthDb(authDataRoot);
const boot = bootstrapAuth(processCwd);
for (const line of boot.logs) console.log(`[auth] ${line}`);
const multiUserLoginFails = { count: 0 };
let defaultPasswordIsFactory = boot.config.defaultPasswordIsFactory;

const requestScope = new AsyncLocalStorage<{ user: PublicUser; workspaceCwd: string; host: UserHost }>();

const bootstrapCwd = boot.adminId
	? join(authDataRoot, "users", boot.adminId, "workspace")
	: processCwd;
mkdirSync(bootstrapCwd, { recursive: true });
console.log(`[auth] 默认工作区 ${bootstrapCwd}`);

const poolEnv = readPoolEnv();
const pool = new UserRuntimePool<UserHost>({
	...poolEnv,
	log: (m) => console.log(m),
	create: async (userId, workspaceCwd) => {
		const isBootstrapAdmin = !!boot.adminId && userId === boot.adminId;
		return createUserHost({
			userId,
			workspaceCwd,
			newSession: isBootstrapAdmin && newSessionFlag,
		});
	},
});
console.log(
	`[pool] max=${poolEnv.maxRuntimes} idleTtlMs=${poolEnv.idleTtlMs} evictIntervalMs=${poolEnv.evictIntervalMs}`,
);

/** REST/WS 解析当前用户 host（懒创建） */
async function hostForUser(user: PublicUser, workspaceCwd: string): Promise<UserHost> {
	return pool.acquire(user.id, workspaceCwd);
}

// ---------- UI dist ----------

function resolveUiDistDir(root: string): string {
	const fromEnv = process.env.DRAWDREAM_UI_DIST?.trim();
	const candidates = [
		fromEnv ? (isAbsolute(fromEnv) ? fromEnv : join(root, fromEnv)) : "",
		join(root, "..", "dist"),
		join(root, "web", "dist"),
	].filter(Boolean);
	for (const d of candidates) {
		if (existsSync(join(d, "index.html"))) return d;
	}
	return candidates[candidates.length - 1] ?? join(root, "web", "dist");
}

const distDir = resolveUiDistDir(processCwd);
const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".avif": "image/avif",
	".ico": "image/x-icon",
	".webmanifest": "application/manifest+json",
	".manifest": "application/manifest+json",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".ogg": "audio/ogg",
	".m4a": "audio/mp4",
	".webm": "video/webm",
	".aac": "audio/aac",
	".flac": "audio/flac",
	".mp4": "video/mp4",
	".m4v": "video/mp4",
	".mov": "video/quicktime",
	".mkv": "video/x-matroska",
	".ogv": "video/ogg",
	".woff2": "font/woff2",
	".map": "application/json",
};

// ---------- 访问密码（实例级，与多用户正交） ----------

let accessData: AccessData | null = loadAccess(bootstrapCwd);
let accessFails = 0;

function requestAccessAuthed(req: IncomingMessage): boolean {
	if (!accessData) return true;
	return verifyToken(accessData, parseCookies(req.headers.cookie)[ACCESS_COOKIE]);
}

function accessGuarded(url: string): boolean {
	if (url.startsWith("/api/")) {
		if (url.startsWith("/api/access/")) return false;
		if (url.startsWith("/api/auth/")) return false;
		if (url === "/api/admin/bootstrap") return false;
		return true;
	}
	return url.startsWith("/media/") || url.startsWith("/audio/") || url.startsWith("/uploads/");
}

function setAccessCookie(res: ServerResponse, token: string | null): void {
	const base = `${ACCESS_COOKIE}=${token ?? ""}; Path=/; HttpOnly; SameSite=Strict`;
	res.setHeader("set-cookie", token ? `${base}; Max-Age=31536000` : `${base}; Max-Age=0`);
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (c: Buffer) => {
			size += c.length;
			if (size > 65536) {
				reject(new Error("body 过大"));
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on("end", () => {
			try {
				resolve(chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>) : {});
			} catch (e) {
				reject(e as Error);
			}
		});
		req.on("error", reject);
	});
}

async function handleAccessApi(req: IncomingMessage, res: ServerResponse, url: string): Promise<void> {
	const json = (code: number, body: unknown, token?: string | null) => {
		if (token !== undefined) setAccessCookie(res, token);
		res.writeHead(code, { "content-type": "application/json" });
		res.end(JSON.stringify(body));
	};
	try {
		if (req.method === "GET" && url === "/api/access/status") {
			json(200, { required: !!accessData, ok: requestAccessAuthed(req) });
			return;
		}
		if (req.method === "POST" && url === "/api/access/login") {
			if (!accessData) {
				json(400, { error: "未设置访问密码" });
				return;
			}
			if (accessFails >= 5) await new Promise((r) => setTimeout(r, 1500));
			const body = await readJsonBody(req);
			if (typeof body.password === "string" && verifyPassword(accessData, body.password)) {
				accessFails = 0;
				json(200, { ok: true }, issueToken(bootstrapCwd, accessData));
			} else {
				accessFails++;
				json(401, { error: "密码不正确" });
			}
			return;
		}
		if (req.method === "POST" && url === "/api/access/set") {
			const body = await readJsonBody(req);
			if (accessData && (typeof body.oldPassword !== "string" || !verifyPassword(accessData, body.oldPassword))) {
				json(403, { error: "当前密码不正确" });
				return;
			}
			const next = typeof body.newPassword === "string" ? body.newPassword : "";
			if (!next) {
				clearPassword(bootstrapCwd);
				accessData = null;
				json(200, { required: false }, null);
				return;
			}
			if (next.length < 4) {
				json(400, { error: "密码至少 4 位" });
				return;
			}
			const r = setPassword(bootstrapCwd, next);
			accessData = r.data;
			json(200, { required: true }, r.token);
			return;
		}
		json(404, { error: "not found" });
	} catch (e) {
		json(400, { error: e instanceof Error ? e.message : String(e) });
	}
}

// ---------- HTTP ----------

const httpServer = createServer((req, res) => {
	void (async () => {
		const urlPath = (req.url ?? "/").split("?")[0];

		if (urlPath.startsWith("/api/access/")) {
			await handleAccessApi(req, res, urlPath);
			return;
		}
		if (
			await handleAuthApi(req, res, {
				dataRoot: authDataRoot,
				getAllowRegistration: () => readEnvAllowRegistration(),
				defaultPasswordIsFactory,
				loginFails: multiUserLoginFails,
				getPoolStats: () => pool.stats(),
				releaseUserRuntime: async (userId) => {
					await pool.release(userId);
				},
			})
		) {
			return;
		}
		if (accessGuarded(urlPath) && !requestAccessAuthed(req)) {
			res.writeHead(401, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "需要访问密码", code: "ACCESS_REQUIRED" }));
			return;
		}
		const url = (req.url ?? "/").split("?")[0];
		if (url === "/healthz") {
			const st = pool.stats();
			res.writeHead(200, { "content-type": "application/json" });
			res.end(
				JSON.stringify({
					ok: true,
					pool: { runtimes: st.runtimes, maxRuntimes: st.maxRuntimes, connections: st.connections },
				}),
			);
			return;
		}

		if (accessGuarded(urlPath)) {
			const ctx = resolveAuthContext(req, authDataRoot);
			if (!ctx) {
				res.writeHead(401, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "需要登录", code: "AUTH_REQUIRED" }));
				return;
			}
			let host: UserHost;
			try {
				host = await hostForUser(ctx.user, ctx.workspaceCwd);
			} catch (e) {
				const code =
					e instanceof RuntimePoolFullError
						? "RUNTIME_POOL_FULL"
						: e instanceof RuntimeCreateError
							? "RUNTIME_CREATE_FAILED"
							: "RUNTIME_ERROR";
				const status = code === "RUNTIME_POOL_FULL" ? 503 : 500;
				res.writeHead(status, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e), code }));
				return;
			}
			await requestScope.run({ user: ctx.user, workspaceCwd: ctx.workspaceCwd, host }, async () => {
				const userCwd = ctx.workspaceCwd;
				if (await handleApiRequest(req, res, host.restHost)) return;
				if (req.method === "GET" && url.startsWith("/api/assets/")) {
					let relative = "";
					try {
						relative = normalize(decodeURIComponent(url.slice("/api/assets/".length))).replace(/^([/\\])+/, "");
					} catch {
						res.writeHead(400);
						res.end();
						return;
					}
					const baseDir = join(userCwd, "assets");
					const file = join(userCwd, relative);
					if (!relative.startsWith("assets/") || !file.startsWith(`${baseDir}/`) || !existsSync(file)) {
						res.writeHead(404);
						res.end();
						return;
					}
					res.writeHead(200, {
						"content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
						"cache-control": "private, max-age=3600",
						"x-content-type-options": "nosniff",
					});
					await pipeline(createReadStream(file), res);
					return;
				}

				const serve = async (prefix: string, key: "media" | "audio" | "uploads", cache: string) => {
					const baseDir = userAssetDir(userCwd, key);
					let rel = "";
					try {
						rel = normalize(decodeURIComponent(url.slice(prefix.length))).replace(/^([/\\.])+/, "");
					} catch {
						/* ignore */
					}
					const file = rel ? join(baseDir, rel) : "";
					if (file.startsWith(baseDir) && existsSync(file)) {
						let size = 0;
						try {
							size = statSync(file).size;
						} catch {
							size = 0;
						}
						res.writeHead(200, {
							"content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
							"cache-control": cache,
							...(size > 0 ? { "content-length": String(size) } : {}),
							...(key === "uploads"
								? { "content-security-policy": "default-src 'none'", "x-content-type-options": "nosniff" }
								: {}),
						});
						// 大图/音频走流，避免整文件进内存
						await pipeline(createReadStream(file), res);
					} else {
						res.writeHead(404);
						res.end();
					}
				};

				if (url.startsWith("/media/")) {
					await serve("/media/", "media", "public, max-age=31536000, immutable");
					return;
				}
				if (url.startsWith("/audio/")) {
					await serve("/audio/", "audio", "public, max-age=31536000, immutable");
					return;
				}
				if (url.startsWith("/uploads/")) {
					await serve("/uploads/", "uploads", "public, max-age=86400");
					return;
				}
				res.writeHead(404);
				res.end();
			});
			return;
		}

		if (!existsSync(distDir) || !existsSync(join(distDir, "index.html"))) {
			res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
			res.end(
				"DrawDream Agent 运行中。尚未找到 UI 构建产物：在 drawdream 目录执行 `npm run build`，" +
					"将生成上级 dist/ 并由本进程同源托管。也可设置 DRAWDREAM_UI_DIST。WS：/ws  REST：/api/*",
			);
			return;
		}
		const rel = normalize(url === "/" ? "/index.html" : url).replace(/^([/\\])+/, "");
		let file = join(distDir, rel);
		if (!file.startsWith(distDir) || !existsSync(file)) file = join(distDir, "index.html");
		try {
			const body = readFileSync(file);
			const ext = extname(file).toLowerCase();
			const headers: Record<string, string> = {
				"content-type": MIME[ext] ?? "application/octet-stream",
			};
			if (
				ext === ".png" ||
				ext === ".webmanifest" ||
				ext === ".js" ||
				ext === ".css" ||
				ext === ".woff2" ||
				file.endsWith("sw.js") ||
				file.endsWith("site.webmanifest")
			) {
				const name = file.replace(/\\/g, "/");
				if (name.includes("/assets/")) {
					headers["cache-control"] = "public, max-age=31536000, immutable";
				} else if (name.endsWith("/sw.js")) {
					headers["cache-control"] = "no-cache";
				} else {
					headers["cache-control"] = "public, max-age=86400";
				}
			}
			res.writeHead(200, headers);
			res.end(body);
		} catch {
			res.writeHead(404);
			res.end();
		}
	})().catch((err) => {
		if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
		res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
	});
});

// ---------- WS ----------

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
/** ws -> host，用于 close 时 removeClient */
const wsHost = new WeakMap<WebSocket, UserHost>();

wss.on("connection", (ws, req) => {
	if (!requestAccessAuthed(req)) {
		ws.close(4401, "unauthorized");
		return;
	}
	const authCtx = resolveAuthContext(req, authDataRoot);
	if (!authCtx) {
		ws.close(4401, "unauthorized");
		return;
	}
	void (async () => {
		let host: UserHost;
		try {
			host = await hostForUser(authCtx.user, authCtx.workspaceCwd);
		} catch (e) {
			const poolFull = e instanceof RuntimePoolFullError;
			ws.close(poolFull ? 4413 : 4500, poolFull ? "RUNTIME_POOL_FULL" : "RUNTIME_CREATE_FAILED");
			return;
		}
		wsHost.set(ws, host);
		host.addClient(ws);
		ws.send(JSON.stringify(host.helloFrame()));
		if (host.isStreaming()) ws.send(JSON.stringify({ type: "agent", state: "start" } satisfies ServerFrame));
		ws.send(JSON.stringify(host.assistantHelloFrame()));
		for (const ch of host.pendingChoiceFrames()) ws.send(JSON.stringify(ch));
	})();

	ws.on("message", (data) => {
		void (async () => {
			const host = wsHost.get(ws);
			if (!host) return;
			let frame: ClientFrame;
			try {
				frame = JSON.parse(String(data)) as ClientFrame;
			} catch {
				return;
			}
			try {
				await host.handleFrame(ws, frame);
			} catch (err) {
				host.broadcast({ type: "error", text: err instanceof Error ? err.message : String(err) });
			}
		})();
	});

	ws.on("close", () => {
		const host = wsHost.get(ws);
		if (host) host.removeClient(ws);
	});
	ws.on("error", () => {
		const host = wsHost.get(ws);
		if (host) host.removeClient(ws);
	});
});

// ---------- 启动 ----------

httpServer.listen(PORT, HOST, () => {
	const urls = [`http://localhost:${PORT}`];
	if (HOST === "0.0.0.0") {
		for (const list of Object.values(networkInterfaces())) {
			for (const ni of list ?? []) {
				if (ni.family === "IPv4" && !ni.internal) urls.push(`http://${ni.address}:${PORT}`);
			}
		}
	}
	console.log(`[drawdream] 多用户并发池已启用（UserRuntimePool）`);
	console.log(`[drawdream] UI 静态目录 ${distDir}${existsSync(join(distDir, "index.html")) ? "" : "（尚未构建）"}`);
	console.log(`[drawdream] agent 目录 ${agentHome}`);
	for (const line of takeAgentMergeLog()) {
		console.log(`[drawdream] 迁移 ${line}`);
	}
	// 仅打印本机地址；移动端走 App 壳内嵌，不引导局域网扫码访问
	console.log(`[drawdream] listening on ${urls[0]}`);
});

const shutdown = async () => {
	try {
		for (const client of wss.clients) {
			try {
				client.close();
			} catch {
				/* */
			}
		}
		wss.close();
		httpServer.close();
		await pool.disposeAll();
	} finally {
		process.exit(0);
	}
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
