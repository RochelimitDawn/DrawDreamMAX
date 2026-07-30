/**
 * 知识库 路由。
 */

import {
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import {
	appendCodexEntry,
	createCodex,
	deleteCodexEntry,
	findCodex,
	listCodexes,
	loadCodexEntries,
	userEntryToCodexInput,
} from "../../../src/codex.ts";
import {
	exportStLorebook,
	loreFingerprint,
} from "../../../src/lorebook.ts";
import {
	readBody,
	sendJson,
} from "../http.ts";
import type { RouteCtx } from "./context.ts";

export async function handleCodexRoutes(ctx: RouteCtx): Promise<boolean> {
	const { req, res, host, query } = ctx;
	const refuseWhileStreaming = ctx.refuseWhileStreaming;

	switch (ctx.route) {
			case "GET /api/codex": {
				const mounted = new Set(host.mountedCodexes());
				sendJson(res, 200, {
					mounted: [...mounted],
					codexes: listCodexes(host.cwd).map((c) => ({
						name: c.name,
						description: c.description,
						entryCount: c.entryCount,
						mounted: mounted.has(c.name),
					})),
				});
				return true;
			}
			case "GET /api/codex/entries": {
				const name = query.get("name") ?? "";
				const entries = loadCodexEntries(host.cwd, name);
				if (!entries) throw new Error(`知识库不存在：${name}`);
				sendJson(res, 200, {
					entries: entries.map((e) => ({
						fingerprint: loreFingerprint(e.content),
						/** 前端主标题：名字 */
						name: e.comment || e.keys[0] || "（未命名）",
						comment: e.comment,
						keys: e.keys,
						constant: e.constant,
						/** 前端正文：信息 */
						content: e.content,
						chars: e.content.length,
					})),
				});
				return true;
			}
			/**
			 * 用户添加条目：只收 name（名字）+ info（信息），后端译为标准 lore 条目
			 * （comment/keys/content；keys 从名字自动派生，可被检索）。
			 */
			case "POST /api/codex/entries": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as {
					codex?: string;
					name?: string;
					info?: string;
					/** 兼容旧字段 / agent 同形 */
					title?: string;
					content?: string;
					keys?: string[];
				};
				const codexName = (body.codex ?? "").trim();
				if (!codexName) throw new Error("缺少知识库名 codex");
				const title = (body.name ?? body.title ?? "").trim();
				const info = (body.info ?? body.content ?? "").trim();
				if (!title) throw new Error("名字不能为空");
				if (!info) throw new Error("信息不能为空");
				const input = userEntryToCodexInput(
					title,
					info,
					Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === "string") : undefined,
				);
				const r = appendCodexEntry(host.cwd, codexName, input);
				if (!r.ok) throw new Error(r.error);
				if (!r.entry) {
					sendJson(res, 200, { ok: true, duplicate: true, fingerprint: loreFingerprint(input.content) });
					return true;
				}
				if (host.mountedCodexes().some((n) => n.toLowerCase() === codexName.toLowerCase())) {
					await host.reloadSession();
				}
				host.notify("info", `已写入「${codexName}」：${r.entry.comment}`);
				sendJson(res, 200, {
					ok: true,
					duplicate: false,
					fingerprint: loreFingerprint(r.entry.content),
					name: r.entry.comment,
				});
				return true;
			}
			case "DELETE /api/codex/entries": {
				if (refuseWhileStreaming()) return true;
				const codexName = (query.get("codex") ?? query.get("name") ?? "").trim();
				const fp = (query.get("fp") ?? query.get("fingerprint") ?? "").trim();
				if (!codexName) throw new Error("缺少知识库名");
				if (!fp) throw new Error("缺少条目 fingerprint");
				const r = deleteCodexEntry(host.cwd, codexName, fp);
				if (!r.ok) throw new Error(r.error);
				if (!r.removed) throw new Error("条目不存在（可能已删除）");
				if (host.mountedCodexes().some((n) => n.toLowerCase() === codexName.toLowerCase())) {
					await host.reloadSession();
				}
				host.notify("info", `已从「${codexName}」删除一条`);
				sendJson(res, 200, { ok: true });
				return true;
			}
			// 导出知识库为世界书 JSON（公开格式，可互通酒馆等；）
			case "GET /api/codex/export": {
				const name = query.get("name") ?? "";
				const entries = loadCodexEntries(host.cwd, name);
				if (!entries) throw new Error(`知识库不存在：${name}`);
				sendJson(res, 200, { name, json: exportStLorebook(name, entries) });
				return true;
			}

			// ---- 技能库：面板只读展示 + /skill:name 显式触发（触发经会话通道，同输入框打命令） ----
			case "POST /api/codex": {
				const body = JSON.parse(await readBody(req)) as { name?: string; description?: string };
				const r = createCodex(host.cwd, body.name ?? "", body.description ?? "");
				if (!r.ok) throw new Error(r.error);
				host.notify("info", `知识库「${r.meta.name}」已创建`);
				sendJson(res, 200, { ok: true, name: r.meta.name });
				return true;
			}
			case "POST /api/codex/rename": {
				const body = JSON.parse(await readBody(req)) as { name?: string; newName?: string };
				const meta = findCodex(host.cwd, body.name ?? "");
				if (!meta) throw new Error(`知识库不存在：${body.name}`);
				const newName = (body.newName ?? "").trim();
				if (!newName) throw new Error("缺少新名字");
				if (host.mountedCodexes().some((n) => n.toLowerCase() === meta.name.toLowerCase())) {
					throw new Error("该库已挂载到当前对话，先卸载再改名");
				}
				if (findCodex(host.cwd, newName)) throw new Error(`已存在同名知识库：${newName}`);
				const r = createCodex(host.cwd, newName, meta.description);
				if (!r.ok) throw new Error(r.error);
				// 搬条目：读旧文件原始 entries 写入新文件（保 uid 与灯法字段）
				const oldRaw = JSON.parse(readFileSync(meta.file, "utf8")) as Record<string, unknown>;
				const newRaw = JSON.parse(readFileSync(r.meta.file, "utf8")) as Record<string, unknown>;
				writeFileSync(r.meta.file, `${JSON.stringify({ ...newRaw, entries: oldRaw.entries ?? [] }, null, "\t")}\n`, "utf8");
				unlinkSync(meta.file);
				sendJson(res, 200, { ok: true, name: newName });
				return true;
			}
			case "DELETE /api/codex": {
				const name = query.get("name") ?? "";
				const meta = findCodex(host.cwd, name);
				if (!meta) throw new Error(`知识库不存在：${name}`);
				if (host.mountedCodexes().some((n) => n.toLowerCase() === meta.name.toLowerCase())) {
					throw new Error("该库已挂载到当前对话，先卸载再删除");
				}
				unlinkSync(meta.file);
				host.notify("info", `知识库「${meta.name}」已删除`);
				sendJson(res, 200, { ok: true });
				return true;
			}
			// 挂载/卸载：经命令桥走扩展 /codexmount（与 codex_mount 工具同一内存+树快照路径）
			case "POST /api/codex/mount": {
				const body = JSON.parse(await readBody(req)) as { name?: string; mounted?: boolean };
				const meta = findCodex(host.cwd, body.name ?? "");
				if (!meta) throw new Error(`知识库不存在：${body.name}`);
				const queued = host.queueCommand(`/codexmount ${body.mounted ? "mount" : "unmount"} ${meta.name}`);
				sendJson(res, 200, { ok: true, queued });
				return true;
			}

			// ---- 角色卡字段编辑（JSON + PNG tEXt 回写） ----
			default:
				return false;
	}
}
