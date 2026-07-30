/**
 * 用户角色 路由。
 */

import {
	existsSync,
	readFileSync,
} from "node:fs";
import {
	clearPersonaAvatar,
	createPersona,
	deletePersona,
	findPersona,
	loadPersonas,
	personaForCard,
	savePersonaAvatar,
	savePersonas,
	updatePersona,
} from "../../../src/personas.ts";
import {
	readBody,
	readBodyRaw,
	resolvePath,
	sendJson,
} from "../http.ts";
import {
	loadConfig,
	projectPersonaToConfig,
} from "../config.ts";
import type { RouteCtx } from "./context.ts";

export async function handlePersonasRoutes(ctx: RouteCtx): Promise<boolean> {
	const { req, res, host, query } = ctx;
	const refuseWhileStreaming = ctx.refuseWhileStreaming;

	switch (ctx.route) {
			case "GET /api/personas": {
				let store = loadPersonas(host.cwd);
				const config = loadConfig(host.cwd);
				// 迁移：首次使用且 config 已有单人设 → 自动收编为第一个 persona
				if (store.personas.length === 0 && config.userName) {
					const r = createPersona(store, { name: config.userName, persona: config.userPersona });
					store = { ...r.store, current: r.id };
					savePersonas(host.cwd, store);
				}
				const active = personaForCard(store, config.card);
				sendJson(res, 200, {
					personas: store.personas,
					current: store.current,
					lockedForCard: store.byCard[config.card] ?? null,
					activeId: active?.id ?? null,
				});
				return true;
			}
			case "POST /api/personas": {
				const body = JSON.parse(await readBody(req)) as { name?: string; persona?: string };
				if (!body.name?.trim()) throw new Error("缺少名字");
				const store = loadPersonas(host.cwd);
				const r = createPersona(store, { name: body.name, persona: body.persona });
				// 第一个 persona 自动成为全局默认
				savePersonas(host.cwd, r.store.current === null ? { ...r.store, current: r.id } : r.store);
				sendJson(res, 200, { ok: true, id: r.id });
				return true;
			}
			case "PUT /api/personas": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { id?: string; name?: string; persona?: string };
				if (!body.id) throw new Error("缺少 id");
				const store = loadPersonas(host.cwd);
				if (!findPersona(store, body.id)) throw new Error("身份不存在");
				const next = updatePersona(store, body.id, { name: body.name, persona: body.persona });
				savePersonas(host.cwd, next);
				// 改的是当前生效身份 → 投影进 config 并重载
				const config = loadConfig(host.cwd);
				const active = personaForCard(next, config.card);
				if (active?.id === body.id) {
					projectPersonaToConfig(host.cwd, active);
					await host.softRefreshConfig();
				}
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "DELETE /api/personas": {
				const id = query.get("id") ?? "";
				const store = loadPersonas(host.cwd);
				if (!findPersona(store, id)) throw new Error("身份不存在");
				if (store.personas.length <= 1) throw new Error("至少保留一个身份");
				savePersonas(host.cwd, deletePersona(host.cwd, store, id));
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "POST /api/personas/select": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { id?: string; lockToCard?: boolean };
				const store = loadPersonas(host.cwd);
				const p = findPersona(store, body.id ?? "");
				if (!p) throw new Error("身份不存在");
				const config = loadConfig(host.cwd);
				const byCard = { ...store.byCard };
				if (body.lockToCard === true) byCard[config.card] = p.id;
				else if (body.lockToCard === false) delete byCard[config.card];
				savePersonas(host.cwd, { ...store, current: body.lockToCard ? store.current : p.id, byCard });
				projectPersonaToConfig(host.cwd, p);
				await host.softRefreshConfig();
				host.notify("info", `已切换身份：${p.name}`);
				sendJson(res, 200, { ok: true });
				return true;
			}
			/** 上传裁剪后的头像（raw PNG/JPEG 字节，ST 式方形头像由前端裁完再传） */
			case "POST /api/personas/avatar": {
				const id = (query.get("id") ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const store = loadPersonas(host.cwd);
				if (!findPersona(store, id)) throw new Error("身份不存在");
				const data = await readBodyRaw(req, 8 * 1024 * 1024); // 裁后头像上限 8MB
				const next = savePersonaAvatar(host.cwd, store, id, data);
				savePersonas(host.cwd, next);
				const p = findPersona(next, id)!;
				host.notify("info", `已更新头像：${p.name}`);
				sendJson(res, 200, { ok: true, avatar: p.avatar });
				return true;
			}
			case "GET /api/personas/avatar": {
				const id = (query.get("id") ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const store = loadPersonas(host.cwd);
				const p = findPersona(store, id);
				if (!p?.avatar) {
					res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "无头像" }));
					return true;
				}
				const abs = resolvePath(host.cwd, p.avatar);
				if (!existsSync(abs)) {
					res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "头像文件缺失" }));
					return true;
				}
				const buf = readFileSync(abs);
				const isPng = buf[0] === 0x89 && buf[1] === 0x50;
				res.writeHead(200, {
					"content-type": isPng ? "image/png" : "image/jpeg",
					// 头像 URL 常带 bust 参数；允许短缓存减少切换闪烁
					"cache-control": "public, max-age=3600",
					"content-length": buf.length,
				});
				res.end(buf);
				return true;
			}
			case "DELETE /api/personas/avatar": {
				const id = (query.get("id") ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const store = loadPersonas(host.cwd);
				if (!findPersona(store, id)) throw new Error("身份不存在");
				const next = clearPersonaAvatar(host.cwd, store, id);
				savePersonas(host.cwd, next);
				sendJson(res, 200, { ok: true });
				return true;
			}

			// ---- 多预设管理（PLAN-PANELS-V2 §2.6） ----
			default:
				return false;
	}
}
