/**
 * 会话管理 路由。
 */

import {
	basename,
} from "node:path";
import {
	readBody,
	sendJson,
} from "../http.ts";
import type { RouteCtx } from "./context.ts";

export async function handleSessionsRoutes(ctx: RouteCtx): Promise<boolean> {
	const { req, res, host, query } = ctx;
	const refuseWhileStreaming = ctx.refuseWhileStreaming;

	switch (ctx.route) {
			case "GET /api/sessions": {
				const list = await host.sessions();
				sendJson(res, 200, { sessions: list });
				return true;
			}
			case "GET /api/sessions/search": {
				sendJson(res, 200, { hits: await host.searchSessions(query.get("q") ?? "") });
				return true;
			}
			case "POST /api/sessions/rename": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { path?: string; name?: string };
				if (!body.path || !body.name?.trim()) throw new Error("缺少 path / name");
				await host.renameSession(body.path, body.name);
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "DELETE /api/sessions": {
				if (refuseWhileStreaming()) return true;
				const path = query.get("path") ?? "";
				if (!path) throw new Error("缺少 path");
				await host.deleteSession(path);
				host.notify("info", "会话已删除");
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "GET /api/sessions/export": {
				const path = query.get("path") ?? "";
				if (!path) throw new Error("缺少 path");
				const content = await host.readSessionFile(path);
				res.writeHead(200, {
					"content-type": "application/x-ndjson; charset=utf-8",
					"content-disposition": `attachment; filename="session.jsonl"; filename*=UTF-8''${encodeURIComponent(basename(path))}`,
				});
				res.end(content);
				return true;
			}

			// ---- 卡库（PLAN-PANELS §2.7）：清单/立绘/导入/收藏 ----
			default:
				return false;
	}
}
