/**
 * 世界书 路由。
 */

import {
	existsSync,
	mkdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import {
	join,
} from "node:path";
import {
	loadCardFile,
} from "../../../src/card.ts";
import {
	applyDisabledLore,
	exportStLorebook,
	loadLorebookFile,
	loreFingerprint,
	mountedLorebookPaths,
	normalizeEntries,
	overlayPathFor,
	patchLorebookFileEntry,
	searchEntries,
	setMountedLorebooks,
	type LoreEntryPatch,
} from "../../../src/lorebook.ts";
import {
	type LorebookEntry,
} from "../../../src/types.ts";
import {
	readJsonFile,
} from "../../../src/jsonio.ts";
import {
	readBody,
	resolvePath,
	sendJson,
} from "../http.ts";
import {
	configPath,
	listLorebookFiles,
	loadConfig,
	loadMergedLore,
	loadMergedLoreWithSource,
	LOREBOOKS_DIR,
	previewText,
	writeJsonWithBackup,
} from "../config.ts";
import type { RouteCtx } from "./context.ts";

export async function handleLoreRoutes(ctx: RouteCtx): Promise<boolean> {
	const { req, res, host, query } = ctx;
	const refuseWhileStreaming = ctx.refuseWhileStreaming;

	switch (ctx.route) {
			case "GET /api/lorebooks": {
				const config = loadConfig(host.cwd);
				const active = mountedLorebookPaths(config);
				sendJson(res, 200, {
					/** 多本同时挂载；兼容旧前端：active 现为 string[] */
					active,
					/** @deprecated 旧单本字段：取 active[0] 或 null */
					activeOne: active[0] ?? null,
					books: listLorebookFiles(host.cwd, config),
				});
				return true;
			}
			/**
			 * 挂载多选：
			 * - { paths: string[] } 整体覆盖挂载列表（[] = 一本都不挂）
			 * - { path, enabled?: boolean } 单本开关（默认 enabled=true 切换为挂上；enabled=false 卸下）
			 * - { path: null } 清空全部挂载
			 * 角色卡与世界书无关：本接口不碰 card。
			 */
			case "POST /api/lorebooks/select": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as {
					path?: string | null;
					paths?: string[];
					enabled?: boolean;
				};
				const config = loadConfig(host.cwd);
				const ensureBook = (p: string) => {
					const abs = resolvePath(host.cwd, p);
					if (!existsSync(abs) || loadLorebookFile(abs).length === 0) {
						throw new Error(`不是有效的世界书文件：${p}`);
					}
				};
				let nextPaths: string[];
				if (Array.isArray(body.paths)) {
					nextPaths = body.paths.map((p) => p.replace(/\\/g, "/")).filter(Boolean);
					for (const p of nextPaths) ensureBook(p);
				} else if (body.path === null || body.path === "") {
					nextPaths = [];
				} else if (typeof body.path === "string" && body.path.trim()) {
					const p = body.path.replace(/\\/g, "/");
					ensureBook(p);
					const cur = new Set(mountedLorebookPaths(config));
					const on = body.enabled !== false; // 默认挂上；传 false 卸下
					// 若未显式传 enabled 且已在列表中 → 视为切换（toggle）
					if (body.enabled === undefined) {
						if (cur.has(p)) cur.delete(p);
						else cur.add(p);
					} else if (on) cur.add(p);
					else cur.delete(p);
					nextPaths = [...cur];
				} else {
					throw new Error("缺少 path 或 paths");
				}
				const next = setMountedLorebooks(config, nextPaths);
				writeJsonWithBackup(configPath(host.cwd), next);
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true, active: nextPaths });
				return true;
			}
			case "POST /api/lorebooks/import": {
				const rawName = (query.get("name") ?? "").trim().replace(/\.json$/i, "");
				if (!rawName) throw new Error("缺少 name");
				const safe = `${rawName.replace(/[\\/:*?"<>|]/g, "-")}.json`;
				mkdirSync(join(host.cwd, LOREBOOKS_DIR), { recursive: true });
				const dest = join(host.cwd, LOREBOOKS_DIR, safe);
				if (existsSync(dest)) throw new Error(`同名世界书已存在：${safe}`);
				const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
				const entries = normalizeEntries(body.entries);
				if (entries.length === 0) throw new Error("不是有效的世界书（entries 为空）");
				writeFileSync(dest, `${JSON.stringify(body, null, "\t")}\n`, "utf8");
				host.notify("info", `世界书「${rawName}」已导入（${entries.length} 条）`);
				sendJson(res, 200, { ok: true, path: `${LOREBOOKS_DIR}/${safe}`, entryCount: entries.length });
				return true;
			}
			case "DELETE /api/lorebooks": {
				if (refuseWhileStreaming()) return true;
				const p = (query.get("path") ?? "").replace(/\\/g, "/");
				const base = p.startsWith(`${LOREBOOKS_DIR}/`) ? p.slice(LOREBOOKS_DIR.length + 1) : "";
				if (!base || base.includes("/") || base.includes("..") || !base.endsWith(".json")) {
					throw new Error("只能删除 assets/lorebooks/ 下的世界书（项目外的素材文件不动）");
				}
				const abs = join(host.cwd, LOREBOOKS_DIR, base);
				if (!existsSync(abs)) throw new Error("文件不存在");
				unlinkSync(abs);
				const config = loadConfig(host.cwd);
				const active = mountedLorebookPaths(config);
				if (active.includes(p)) {
					const next = setMountedLorebooks(
						config,
						active.filter((x) => x !== p),
					);
					writeJsonWithBackup(configPath(host.cwd), next);
					await host.softRefreshConfig();
				}
				sendJson(res, 200, { ok: true });
				return true;
			}

			// ---- 知识库管理（PLAN-PANELS-V2 §2.4：建库/改名/删除/挂载按钮，用户主权） ----
			case "GET /api/lorebook": {
				const config = loadConfig(host.cwd);
				const pathQ = (query.get("path") ?? "").replace(/\\/g, "/").trim();
				const sourceQ = (query.get("source") ?? "").trim();
				const mounted = mountedLorebookPaths(config);
				const mapEntries = (entries: LorebookEntry[], source: LoreSource) =>
					entries.map((e) => ({
						fingerprint: loreFingerprint(e.content),
						comment: e.comment,
						keys: e.keys,
						secondaryKeys: e.secondaryKeys,
						constant: e.constant,
						enabled: e.enabled,
						selective: e.selective,
						order: e.order,
						chars: e.content.length,
						source,
						preview: previewText(e.content, 160),
					}));

				if (sourceQ === "agent") {
					const card = loadCardFile(resolvePath(host.cwd, config.card));
					const overlayPath = overlayPathFor(host.cwd, card.name);
					const raw = existsSync(overlayPath) ? loadLorebookFile(overlayPath) : [];
					const entries = applyDisabledLore(raw, config.disabledLore);
					sendJson(res, 200, {
						lorebookPath: null,
						lorebookPaths: mounted,
						viewPath: null,
						viewSource: "agent" as const,
						viewName: "agent 补充设定",
						total: entries.length,
						entries: mapEntries(entries, "agent"),
					});
					return true;
				}

				if (pathQ) {
					const abs = resolvePath(host.cwd, pathQ);
					if (!existsSync(abs)) throw new Error("世界书文件不存在");
					const raw = loadLorebookFile(abs);
					if (raw.length === 0) throw new Error("不是有效的世界书文件");
					const entries = applyDisabledLore(raw, config.disabledLore);
					const name =
						(() => {
							try {
								const j = readJsonFile(abs) as Record<string, unknown>;
								return typeof j.name === "string" && j.name.trim() ? j.name.trim() : null;
							} catch {
								return null;
							}
						})() ?? pathQ.split("/").pop()?.replace(/\.json$/i, "") ?? pathQ;
					sendJson(res, 200, {
						lorebookPath: pathQ,
						lorebookPaths: mounted,
						viewPath: pathQ,
						viewSource: "file" as const,
						viewName: name,
						total: entries.length,
						entries: mapEntries(entries, "file"),
					});
					return true;
				}

				// 无 path：不返回合并全集（UI 必须先点选一本）
				sendJson(res, 200, {
					lorebookPath: null,
					lorebookPaths: mounted,
					viewPath: null,
					viewSource: null,
					viewName: null,
					total: 0,
					entries: [],
				});
				return true;
			}
			case "GET /api/lorebook/entry": {
				const fp = query.get("fp") ?? "";
				const config = loadConfig(host.cwd);
				// 在全部库文件 + 补充设定里找（浏览未挂载书时也能展开正文）
				const card = loadCardFile(resolvePath(host.cwd, config.card));
				const candidates: Array<{ abs: string; source: LoreSource }> = [];
				for (const b of listLorebookFiles(host.cwd, config)) {
					candidates.push({ abs: resolvePath(host.cwd, b.path), source: "file" });
				}
				candidates.push({ abs: overlayPathFor(host.cwd, card.name), source: "agent" });
				let found: LorebookEntry | null = null;
				let source: LoreSource = "file";
				for (const c of candidates) {
					if (!existsSync(c.abs)) continue;
					const hit = applyDisabledLore(loadLorebookFile(c.abs), config.disabledLore).find(
						(e) => loreFingerprint(e.content) === fp,
					);
					if (hit) {
						found = hit;
						source = c.source;
						break;
					}
				}
				if (!found) throw new Error("条目不存在（世界书可能已更换）");
				sendJson(res, 200, {
					content: found.content,
					comment: found.comment,
					keys: found.keys,
					secondaryKeys: found.secondaryKeys,
					constant: found.constant,
					enabled: found.enabled,
					selective: found.selective,
					order: found.order,
					source,
					fingerprint: fp,
				});
				return true;
			}
			/**
			 * 编辑条目：写回源文件（独立世界书 file / agent 补充设定）。
			 * 可改 constant（绿/蓝灯）、order（优先级）、keys、selective、comment、content。
			 */
			case "PUT /api/lorebook/entry": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as {
					fingerprint?: string;
					constant?: boolean;
					order?: number;
					keys?: string[];
					secondaryKeys?: string[];
					selective?: boolean;
					comment?: string;
					content?: string;
				};
				const fp = (body.fingerprint ?? "").trim();
				if (!fp) throw new Error("缺少 fingerprint");
				const config = loadConfig(host.cwd);
				const card = loadCardFile(resolvePath(host.cwd, config.card));
				// 写回：扫描全部世界书文件 + 补充设定（不限当前挂载，浏览哪本改哪本）
				const candidates: string[] = [];
				for (const b of listLorebookFiles(host.cwd, config)) {
					candidates.push(resolvePath(host.cwd, b.path));
				}
				candidates.push(overlayPathFor(host.cwd, card.name));

				const patch: LoreEntryPatch = {};
				if (typeof body.constant === "boolean") patch.constant = body.constant;
				if (typeof body.order === "number" && Number.isFinite(body.order)) {
					patch.order = Math.max(0, Math.min(9999, Math.round(body.order)));
				}
				if (Array.isArray(body.keys)) patch.keys = body.keys.filter((k): k is string => typeof k === "string");
				if (Array.isArray(body.secondaryKeys)) {
					patch.secondaryKeys = body.secondaryKeys.filter((k): k is string => typeof k === "string");
				}
				if (typeof body.selective === "boolean") patch.selective = body.selective;
				if (typeof body.comment === "string") patch.comment = body.comment;
				if (typeof body.content === "string") patch.content = body.content;
				if (Object.keys(patch).length === 0) throw new Error("没有可更新的字段");

				let result: { entry: LorebookEntry; newFingerprint: string } | null = null;
				let wrotePath = "";
				for (const abs of candidates) {
					if (!existsSync(abs)) continue;
					const r = patchLorebookFileEntry(abs, fp, patch);
					if (r) {
						result = r;
						wrotePath = abs;
						break;
					}
				}
				if (!result) throw new Error("未找到可写条目（世界书可能已更换，或条目不在挂载书/补充设定中）");

				// 内容变更时迁移 disabledLore 指纹
				if (result.newFingerprint !== fp && config.disabledLore?.includes(fp)) {
					const disabled = config.disabledLore.map((d) => (d === fp ? result!.newFingerprint : d));
					const next = { ...config, disabledLore: disabled } as Record<string, unknown>;
					writeJsonWithBackup(configPath(host.cwd), next);
				}

				// constant / order / content 影响注入，重装会话
				await host.softRefreshConfig();
				host.notify("info", "世界书条目已保存");
				sendJson(res, 200, {
					ok: true,
					fingerprint: result.newFingerprint,
					constant: result.entry.constant,
					order: result.entry.order,
					path: wrotePath.startsWith(host.cwd) ? wrotePath.slice(host.cwd.length + 1).replace(/\\/g, "/") : wrotePath,
				});
				return true;
			}
			case "GET /api/lorebook/search": {
				const q = query.get("q") ?? "";
				const entries = loadMergedLore(host.cwd, loadConfig(host.cwd));
				const hits = searchEntries(entries, q, 5);
				sendJson(res, 200, {
					hits: hits.map((h) => ({
						comment: h.entry.comment,
						keys: h.entry.keys,
						score: h.score,
						preview: previewText(h.entry.content, 400),
					})),
				});
				return true;
			}
			case "POST /api/lorebook/toggle": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as {
					fingerprint?: string;
					fingerprints?: string[];
					enabled?: boolean;
				};
				// 单条与批量（过滤结果全启/全停）共用一个端点
				const fps = [
					...(body.fingerprint ? [body.fingerprint] : []),
					...(Array.isArray(body.fingerprints) ? body.fingerprints.filter((f): f is string => typeof f === "string") : []),
				];
				if (fps.length === 0) throw new Error("缺少 fingerprint(s)");
				const config = loadConfig(host.cwd);
				const disabled = new Set(config.disabledLore ?? []);
				for (const fp of fps) {
					if (body.enabled) disabled.delete(fp);
					else disabled.add(fp);
				}
				const next = { ...config, disabledLore: [...disabled] } as Record<string, unknown>;
				if ((next.disabledLore as string[]).length === 0) delete next.disabledLore;
				writeJsonWithBackup(configPath(host.cwd), next);
				await host.softRefreshConfig(); // constant 条目影响 system prompt，必须重装
				sendJson(res, 200, { ok: true, count: fps.length });
				return true;
			}
			// 导出：?path=按书导出（原样内容）；缺省导出合并结果（agent 补充的正典也有了带走的路）
			case "GET /api/lorebook/export": {
				const p = (query.get("path") ?? "").replace(/\\/g, "/");
				if (p) {
					const abs = resolvePath(host.cwd, p);
					if (!existsSync(abs)) throw new Error("世界书文件不存在");
					const entries = loadLorebookFile(abs);
					if (entries.length === 0) throw new Error("不是有效的世界书文件");
					const name = p.split("/").pop()?.replace(/\.json$/i, "") ?? "lorebook";
					sendJson(res, 200, { name, json: exportStLorebook(name, entries) });
					return true;
				}
				const { entries, cardName } = loadMergedLoreWithSource(host.cwd, loadConfig(host.cwd));
				const name = `${cardName}-DrawDream世界书`;
				sendJson(res, 200, { name, json: exportStLorebook(name, entries) });
				return true;
			}

			// ---- 预设 ----
			/**
			 * GET：默认读**磁盘已保存**版（切换回来应看到原样）。
			 * ?full=1 附带每块 content；?working=1 则返回当前运行时草稿（若有）。
			 */
			default:
				return false;
	}
}
