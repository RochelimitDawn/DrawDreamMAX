/**
 * 角色卡 路由。
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import {
	basename,
	join,
} from "node:path";
import {
	addCardGreeting,
	deleteCardGreeting,
	exportCardFile,
	loadCardFile,
	moveCardGreeting,
	remapGreetingIndexAfterMove,
	setCardGreetings,
	updateCardFields,
	updateCardGreeting,
	type CardExportLoreMode,
	type CardFieldPatch,
} from "../../../src/card.ts";
import {
	exportStLorebook,
	mountedLorebookPaths,
	overlayPathFor,
	setMountedLorebooks,
} from "../../../src/lorebook.ts";
import {
	loadPersonas,
	personaForCard,
	savePersonas,
} from "../../../src/personas.ts";
import {
	DEFAULT_CONFIG,
} from "../../../src/types.ts";
import {
	MAX_UPLOAD,
	readBody,
	readBodyRaw,
	resolvePath,
	sendJson,
} from "../http.ts";
import {
	assertLibraryCard,
	clampInt,
	collectActiveLoreForExport,
	configPath,
	invalidateCardMetaCache,
	listCardLibrary,
	loadConfig,
	loadFavs,
	LOREBOOKS_DIR,
	projectPersonaToConfig,
	saveFavs,
	writeJsonWithBackup,
} from "../config.ts";
import type { RouteCtx } from "./context.ts";

export async function handleCardsRoutes(ctx: RouteCtx): Promise<boolean> {
	const { req, res, host, query } = ctx;
	const refuseWhileStreaming = ctx.refuseWhileStreaming;

	switch (ctx.route) {
			case "GET /api/cards": {
				const config = loadConfig(host.cwd);
				const favs = new Set(loadFavs(host.cwd));
				sendJson(res, 200, {
					current: config.card,
					cards: listCardLibrary(host.cwd, config).map((c) => ({ ...c, fav: favs.has(c.path) })),
				});
				return true;
			}
			/** 按卡库路径读取完整详情（不限当前卡；修复详情页非 current 无正文） */
			case "GET /api/cards/detail": {
				const p = (query.get("path") ?? "").trim();
				if (!p) throw new Error("缺少 path");
				const config = loadConfig(host.cwd);
				const abs = assertLibraryCard(host.cwd, config, p);
				const card = loadCardFile(abs);
				// ST 卡常把设定写在 first_mes，description/personality 为空——UI 用开场白摘录兜底
				const firstMes = card.firstMes || "";
				const desc =
					card.description.trim() ||
					card.creatorNotes.trim() ||
					(firstMes ? firstMes.replace(/<[^>]+>/g, "").slice(0, 280) : "");
				sendJson(res, 200, {
					path: p,
					displayName: config.card === p ? (config.displayName ?? null) : null,
					greetingIndex: config.card === p ? (config.greetingIndex ?? 0) : 0,
					name: card.name,
					description: desc,
					personality: card.personality,
					scenario: card.scenario,
					creatorNotes: card.creatorNotes,
					tags: card.tags,
					isPng: /\.png$/i.test(abs),
					embeddedLoreCount: card.book.length,
					runtimeManifest: card.runtimeManifest ?? null,
					greetings: [card.firstMes, ...card.alternateGreetings].map((text, index) => ({
						index,
						label: index === 0 ? "默认开场白" : `备选 ${index}`,
						text,
					})),
				});
				return true;
			}
			/** 角色卡兼容运行时投影：只返回静态 Manifest，不执行卡内脚本。 */
			case "GET /api/cards/runtime": {
				const p = (query.get("path") ?? "").trim();
				if (!p) throw new Error("缺少 path");
				const config = loadConfig(host.cwd);
				const abs = assertLibraryCard(host.cwd, config, p);
				const card = loadCardFile(abs);
				if (!card.runtimeManifest) throw new Error("角色卡缺少兼容运行时清单");
				const grants = config.tavernModuleGrants && typeof config.tavernModuleGrants === "object" && !Array.isArray(config.tavernModuleGrants)
					? config.tavernModuleGrants[card.runtimeManifest.cardFingerprint]
					: undefined;
				sendJson(res, 200, {
					path: p,
					name: card.name,
					manifest: card.runtimeManifest,
					grantedModules: Array.isArray(grants) ? grants.filter((item): item is string => typeof item === "string") : [],
				});
				return true;
			}
			case "POST /api/cards/runtime/module-grant": {
				const body = JSON.parse(await readBody(req)) as { fingerprint?: string; url?: string; allow?: boolean };
				const fingerprint = (body.fingerprint ?? "").trim();
				const url = (body.url ?? "").trim();
				if (!fingerprint || !/^https:\/\//i.test(url)) throw new Error("需要 fingerprint 与 HTTPS 模块 URL");
				const config = loadConfig(host.cwd) as unknown as Record<string, unknown>;
				const grants = config.tavernModuleGrants && typeof config.tavernModuleGrants === "object" && !Array.isArray(config.tavernModuleGrants)
					? { ...(config.tavernModuleGrants as Record<string, string[]>) }
					: {};
				const current = Array.isArray(grants[fingerprint]) ? grants[fingerprint].filter((item): item is string => typeof item === "string") : [];
				const next = body.allow === false ? current.filter((item) => item !== url) : [...new Set([...current, url])];
				if (next.length) grants[fingerprint] = next;
				else delete grants[fingerprint];
				config.tavernModuleGrants = grants;
				writeJsonWithBackup(configPath(host.cwd), config);
				sendJson(res, 200, { ok: true, fingerprint, granted: next });
				return true;
			}
			case "GET /api/cards/image": {
				const p = query.get("path") ?? "";
				const abs = assertLibraryCard(host.cwd, loadConfig(host.cwd), p);
				if (!/\.png$/i.test(abs)) throw new Error("该卡没有内嵌立绘（JSON 卡）");
				// 路径稳定即可长缓存；避免卡库↔详情来回时封面反复重下
				let mtime = 0;
				try {
					mtime = statSync(abs).mtimeMs;
				} catch {
					/* ignore */
				}
				res.writeHead(200, {
					"content-type": "image/png",
					"cache-control": "public, max-age=604800, immutable",
					etag: `"${mtime.toString(16)}"`,
				});
				res.end(readFileSync(abs));
				return true;
			}
			case "POST /api/cards/import": {
				const rawName = (query.get("name") ?? "").trim();
				if (!rawName || !/\.(png|json)$/i.test(rawName)) throw new Error("文件名必须以 .png 或 .json 结尾");
				const extPrefer = /\.json$/i.test(rawName) ? ".json" : ".png";
				// 去危险字符后，再把非 ASCII 压成安全 stem（Android WebView / 部分文件系统对中文路径不友好）
				let safe = rawName.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
				if (!safe || safe === ".png" || safe === ".json" || /^blob/i.test(safe) || safe === "null" || safe === "undefined") {
					safe = `import-${Date.now()}${extPrefer}`;
				} else {
					const extM = safe.match(/(\.(?:png|json))$/i);
					const ext = extM ? extM[1].toLowerCase() : extPrefer;
					const stem = (extM ? safe.slice(0, -extM[1].length) : safe)
						.normalize("NFKD")
						.replace(/[^\x20-\x7E]/g, "")
						.replace(/[^A-Za-z0-9._-]+/g, "-")
						.replace(/-+/g, "-")
						.replace(/^-|-$/g, "");
					safe = `${stem || `import-${Date.now()}`}${ext}`;
				}
				const dir = join(host.cwd, "assets", "cards");
				mkdirSync(dir, { recursive: true });
				// 同名自动加后缀，避免二次导入直接失败
				const extM = safe.match(/(\.[^.]+)$/);
				const ext = extM ? extM[1] : "";
				const stem = ext ? safe.slice(0, -ext.length) : safe;
				let dest = join(dir, safe);
				let n = 2;
				while (existsSync(dest)) {
					safe = `${stem}-${n}${ext}`;
					dest = join(dir, safe);
					n++;
					if (n > 200) throw new Error("无法分配唯一文件名");
				}
				const data = await readBodyRaw(req, MAX_UPLOAD);
				if (data.length === 0) throw new Error("文件内容为空（请确认已选中本地 .png/.json 角色卡）");
				writeFileSync(dest, data);
				try {
					const card = loadCardFile(dest);
					if (!card.name.trim()) throw new Error("卡名为空");
					const path = `assets/cards/${safe}`;
					// 当前未选卡或原卡文件丢失时：导入后自动选用，避免进对话仍是「请选卡面」
					const cfg = loadConfig(host.cwd);
					const cur = (cfg.card ?? "").trim();
					const curAbs = cur ? resolvePath(host.cwd, cur) : "";
					let switched = false;
					if (!cur || !existsSync(curAbs)) {
						const raw = cfg as unknown as Record<string, unknown>;
						delete raw.displayName;
						delete raw.greetingIndex;
						raw.card = path;
						writeJsonWithBackup(configPath(host.cwd), raw);
						const persona = personaForCard(loadPersonas(host.cwd), path);
						if (persona) projectPersonaToConfig(host.cwd, persona);
						if (!refuseWhileStreaming()) {
							await host.switchToCard();
							switched = true;
						}
					}
					host.notify(
						"info",
						switched
							? `已导入并选用角色卡「${card.name}」`
							: `已导入角色卡「${card.name}」（可在卡库点开始对话）`,
					);
					sendJson(res, 200, {
						ok: true,
						path,
						name: card.name,
						embeddedLoreCount: card.book.length,
						switched,
					});
				} catch (e) {
					unlinkSync(dest); // 坏卡不留盘
					throw new Error(`不是有效的角色卡：${e instanceof Error ? e.message : String(e)}`);
				}
				return true;
			}
			/**
			 * 删除角色卡。query：
			 * - path：卡库内相对路径（必填）
			 * - lore=1：连同配套世界书（assets/lorebooks/<卡名>.json 及 -N 变体）一起删并取消挂载
			 * - data=1：连同相关数据（该卡全部会话、补充设定集、persona 卡锁定）一起删；
			 *   不带则数据保留，重新导入同路径同名卡可无缝续玩
			 * 删除当前使用中的卡：先自动切到默认卡（或卡库剩余第一张），最后一张卡拒删。
			 */
			case "DELETE /api/cards": {
				if (refuseWhileStreaming()) return true;
				const p = query.get("path") ?? "";
				const wantLore = query.get("lore") === "1";
				const wantData = query.get("data") === "1";
				let config = loadConfig(host.cwd);
				const abs = assertLibraryCard(host.cwd, config, p);
				let cardName = basename(p).replace(/\.(png|json)$/i, "");
				try {
					cardName = loadCardFile(abs).name || cardName;
				} catch {
					// 坏卡也允许删，名字退回文件名
				}
				const isCurrent = !!config.card && resolvePath(host.cwd, config.card) === abs;

				// 删当前卡：先切走（默认卡优先，其次卡库剩余第一张；没有可去处则拒绝）
				let switchedTo: string | null = null;
				if (isCurrent) {
					const others = listCardLibrary(host.cwd, config).filter((c) => resolvePath(host.cwd, c.path) !== abs);
					const fallback = others.find((c) => c.path === DEFAULT_CONFIG.card) ?? others[0];
					if (!fallback) throw new Error("这是卡库里最后一张卡，删掉就没有可用角色了：请先导入其它卡");
					const raw = config as unknown as Record<string, unknown>;
					delete raw.displayName;
					delete raw.greetingIndex;
					raw.card = fallback.path;
					writeJsonWithBackup(configPath(host.cwd), raw);
					const persona = personaForCard(loadPersonas(host.cwd), fallback.path);
					if (persona) projectPersonaToConfig(host.cwd, persona);
					await host.switchToCard();
					switchedTo = fallback.path;
					config = loadConfig(host.cwd);
				}

				// 卡本体
				unlinkSync(abs);
				invalidateCardMetaCache(abs);
				if (existsSync(abs)) throw new Error(`角色卡删除失败：文件仍存在（${p}）`);
				invalidateCardMetaCache();
				const favs = loadFavs(host.cwd);
				if (favs.includes(p)) {
					saveFavs(host.cwd, favs.filter((f) => f !== p));
				}

				// 配套世界书：与 import-embedded-lore 同一命名推导（<卡名>.json / <卡名>-N.json）
				let deletedLore = 0;
				if (wantLore) {
					const safeBase = cardName.replace(/[\\/:*?"<>|]/g, "-").trim() || "card-lore";
					const rx = new RegExp(`^${safeBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(-\\d+)?\\.json$`, "i");
					const dir = join(host.cwd, LOREBOOKS_DIR);
					const gone: string[] = [];
					if (existsSync(dir)) {
						for (const f of readdirSync(dir)) {
							if (!rx.test(f)) continue;
							try {
								unlinkSync(join(dir, f));
								gone.push(`${LOREBOOKS_DIR}/${f}`);
							} catch {
								// 删不掉的留着，挂载也别拆
							}
						}
					}
					if (gone.length > 0) {
						const mounted = mountedLorebookPaths(config).filter((m) => !gone.includes(m));
						writeJsonWithBackup(configPath(host.cwd), setMountedLorebooks(config, mounted));
						await host.softRefreshConfig();
					}
					deletedLore = gone.length;
				}

				// 相关数据：会话 + 补充设定集 + persona 卡锁定（保留则重新导入同路径卡即无缝续玩）
				let deletedSessions = 0;
				if (wantData) {
					deletedSessions = await host.deleteCardSessions(p);
					const overlay = overlayPathFor(host.cwd, cardName);
					if (existsSync(overlay)) {
						try {
							unlinkSync(overlay);
						} catch {
							/* 不挡 */
						}
					}
					const pstore = loadPersonas(host.cwd);
					if (pstore.byCard[p]) {
						const byCard = { ...pstore.byCard };
						delete byCard[p];
						savePersonas(host.cwd, { ...pstore, byCard });
					}
				}

				host.notify(
					"info",
					`已删除角色卡「${cardName}」${wantLore && deletedLore > 0 ? `，配套世界书 ${deletedLore} 本` : ""}${wantData ? `，相关数据（会话 ${deletedSessions} 个）` : "（数据保留，重新导入可续玩）"}${switchedTo ? `；已切换到「${basename(switchedTo)}」` : ""}`,
				);
				sendJson(res, 200, { ok: true, deletedLore, deletedSessions, switchedTo });
				return true;
			}
			case "POST /api/cards/fav": {
				const body = JSON.parse(await readBody(req)) as { path?: string; fav?: boolean };
				if (!body.path) throw new Error("缺少 path");
				const favs = new Set(loadFavs(host.cwd));
				if (body.fav) favs.add(body.path);
				else favs.delete(body.path);
				saveFavs(host.cwd, [...favs]);
				sendJson(res, 200, { ok: true });
				return true;
			}

			// ---- 世界状态编辑（PLAN-PANELS §2.11）：用户主权，applyPatch 语义，不经模型 ----
			case "PUT /api/card": {
				if (refuseWhileStreaming()) return true;
				const patch = JSON.parse(await readBody(req)) as CardFieldPatch;
				const config = loadConfig(host.cwd);
				updateCardFields(resolvePath(host.cwd, config.card), patch);
				await host.softRefreshConfig(); // 卡字段进 system prompt，必须重装
				sendJson(res, 200, { ok: true });
				return true;
			}
			/** 按卡库路径写字段（详情页标签等；非当前卡不触发 softRefresh） */
			case "PUT /api/cards/fields": {
				const body = JSON.parse(await readBody(req)) as CardFieldPatch & { path?: string };
				const p = (body.path ?? "").trim();
				if (!p) throw new Error("缺少 path");
				const config = loadConfig(host.cwd);
				const abs = assertLibraryCard(host.cwd, config, p);
				const { path: _path, ...patch } = body;
				void _path;
				updateCardFields(abs, patch);
				if (config.card === p) {
					if (refuseWhileStreaming()) return true;
					await host.softRefreshConfig();
				}
				sendJson(res, 200, { ok: true, path: p });
				return true;
			}
			/**
			 * 导出当前角色卡（含可选世界书合并）。
			 * query: format=json|png，lore=active|embedded|none
			 * - active（默认）：挂载世界书 + 本卡补充设定 + 原内嵌书（指纹去重），即「改过之后」的创作态
			 * - embedded：仅卡内原 character_book
			 * - none：不带世界书
			 */
			case "GET /api/card/export": {
				const config = loadConfig(host.cwd);
				const format = (query.get("format") ?? "json").toLowerCase() === "png" ? "png" : "json";
				const loreRaw = (query.get("lore") ?? "active").toLowerCase();
				const loreMode: CardExportLoreMode =
					loreRaw === "none" || loreRaw === "embedded" ? loreRaw : "active";
				const abs = resolvePath(host.cwd, config.card);
				const bookEntries =
					loreMode === "active" ? collectActiveLoreForExport(host.cwd, config) : undefined;
				const exp = exportCardFile(abs, { format, loreMode, bookEntries });
				res.writeHead(200, {
					"content-type": exp.mime,
					"content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(exp.filename)}`,
					"cache-control": "no-store",
					"x-drawdream-lore-mode": exp.loreMode,
					"x-drawdream-lore-count": String(exp.loreCount),
				});
				res.end(exp.body);
				return true;
			}
			/** 开场白 CRUD：index 0=first_mes，1..=alternate_greetings */
			case "PUT /api/card/greetings": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as {
					index?: number;
					text?: string;
					greetings?: string[];
				};
				const config = loadConfig(host.cwd);
				const abs = resolvePath(host.cwd, config.card);
				if (Array.isArray(body.greetings)) {
					setCardGreetings(
						abs,
						body.greetings.map((t) => String(t ?? "")),
					);
				} else if (typeof body.index === "number" && typeof body.text === "string") {
					updateCardGreeting(abs, body.index, body.text);
				} else {
					throw new Error("需要 greetings[] 或 index+text");
				}
				// 若当前选中序号越界，钳回
				const card = loadCardFile(abs);
				const max = card.alternateGreetings.length;
				const gi = config.greetingIndex ?? 0;
				if (gi > max) {
					writeJsonWithBackup(configPath(host.cwd), { ...config, greetingIndex: 0 });
				}
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "POST /api/card/greetings": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { text?: string };
				const config = loadConfig(host.cwd);
				const abs = resolvePath(host.cwd, config.card);
				const index = addCardGreeting(abs, body.text ?? "");
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true, index });
				return true;
			}
			case "DELETE /api/card/greetings": {
				if (refuseWhileStreaming()) return true;
				const index = Number.parseInt(query.get("index") ?? "", 10);
				if (!Number.isFinite(index)) throw new Error("缺少 index");
				const config = loadConfig(host.cwd);
				const abs = resolvePath(host.cwd, config.card);
				deleteCardGreeting(abs, index);
				const card = loadCardFile(abs);
				const max = card.alternateGreetings.length;
				let gi = config.greetingIndex ?? 0;
				if (gi > max) gi = 0;
				else if (gi === index) gi = Math.max(0, index - 1);
				else if (gi > index) gi = gi - 1;
				writeJsonWithBackup(configPath(host.cwd), { ...config, greetingIndex: gi });
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true, greetingIndex: gi });
				return true;
			}
			/** 开场白上移/下移：{ index, delta: -1|1 } */
			case "POST /api/card/greetings/move": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { index?: number; delta?: number };
				const index = typeof body.index === "number" ? body.index : Number.NaN;
				const delta = body.delta === -1 || body.delta === 1 ? body.delta : Number.NaN;
				if (!Number.isFinite(index) || !Number.isFinite(delta)) throw new Error("需要 index 与 delta（-1 上移 / 1 下移）");
				const config = loadConfig(host.cwd);
				const abs = resolvePath(host.cwd, config.card);
				const to = moveCardGreeting(abs, index, delta);
				const gi0 = config.greetingIndex ?? 0;
				const gi = remapGreetingIndexAfterMove(gi0, index, to);
				if (gi !== gi0) {
					writeJsonWithBackup(configPath(host.cwd), { ...config, greetingIndex: gi });
				}
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true, index: to, greetingIndex: gi });
				return true;
			}

			// ---- 模型 ----
			case "GET /api/card": {
				const config = loadConfig(host.cwd);
				const card = loadCardFile(resolvePath(host.cwd, config.card));
				sendJson(res, 200, {
					path: config.card,
					displayName: config.displayName ?? null,
					greetingIndex: config.greetingIndex ?? 0,
					name: card.name,
					description: card.description,
					personality: card.personality,
					scenario: card.scenario,
					creatorNotes: card.creatorNotes,
					tags: card.tags,
					/** 卡内嵌 character_book 条数（>0 时前端可提示导入配套世界书） */
					embeddedLoreCount: card.book.length,
					greetings: [card.firstMes, ...card.alternateGreetings].map((text, index) => ({
						index,
						label: index === 0 ? "默认开场白" : `备选 ${index}`,
						text,
					})),
				});
				return true;
			}
			case "POST /api/greeting": {
				const body = JSON.parse(await readBody(req)) as { index?: number; apply?: boolean };
				const config = loadConfig(host.cwd);
				const card = loadCardFile(resolvePath(host.cwd, config.card));
				const max = card.alternateGreetings.length; // 合法范围 0..max
				const index = clampInt(body.index, 0, max, 0);
				writeJsonWithBackup(configPath(host.cwd), { ...config, greetingIndex: index });
				// apply=true：走扩展 /greeting，未开聊时可即时替换对话里的开场白
				if (body.apply) {
					if (refuseWhileStreaming()) return true;
					await host.promptCommand(`/greeting ${index}`);
					sendJson(res, 200, { greetingIndex: index, applied: true });
					return true;
				}
				host.notify("info", "开场白已选定，对下一个新会话生效");
				sendJson(res, 200, { greetingIndex: index, applied: false });
				return true;
			}
			case "POST /api/card/switch": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { card?: string };
				const cardPath = (body.card ?? "").trim();
				if (!cardPath) throw new Error("缺少 card 路径");
				const card = loadCardFile(resolvePath(host.cwd, cardPath)); // 先验卡，坏卡不落盘
				const config = loadConfig(host.cwd) as unknown as Record<string, unknown>;
				// 卡专属字段随卡走：显示名/开场白选择清掉。
				// 世界书与角色卡解耦：换卡不碰 lorebooks / disabledLore（条目启停跨卡保留）。
				delete config.displayName;
				delete config.greetingIndex;
				config.card = cardPath;
				writeJsonWithBackup(configPath(host.cwd), config);
				// persona 按卡自动选用（卡锁定→全局默认）：投影进 config 一并生效
				const pstore = loadPersonas(host.cwd);
				const persona = personaForCard(pstore, cardPath);
				if (persona) projectPersonaToConfig(host.cwd, persona);
				const result = await host.switchToCard();
				host.notify(
					"info",
					`${result === "switched" ? `已切换到「${card.name}」的最近会话` : `已为「${card.name}」新建会话`}${persona ? `（身份：${persona.name}）` : ""}`,
				);
				sendJson(res, 200, {
					result,
					name: card.name,
					path: cardPath,
					embeddedLoreCount: card.book.length,
				});
				return true;
			}
			/**
			 * 把当前卡（或指定卡）的内嵌 character_book 另存为独立世界书并挂到配置。
			 * 卡内嵌书仍会随卡加载；另存后可在世界书面板管理、跨卡复用。
			 */
			case "POST /api/card/import-embedded-lore": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { card?: string };
				const config = loadConfig(host.cwd);
				const cardPath = (body.card ?? config.card).trim();
				if (!cardPath) throw new Error("缺少角色卡");
				const card = loadCardFile(resolvePath(host.cwd, cardPath));
				if (card.book.length === 0) throw new Error(`「${card.name}」没有内嵌世界书`);
				const safeBase = card.name.replace(/[\\/:*?"<>|]/g, "-").trim() || "card-lore";
				mkdirSync(join(host.cwd, LOREBOOKS_DIR), { recursive: true });
				let file = `${safeBase}.json`;
				let dest = join(host.cwd, LOREBOOKS_DIR, file);
				let n = 2;
				while (existsSync(dest)) {
					file = `${safeBase}-${n}.json`;
					dest = join(host.cwd, LOREBOOKS_DIR, file);
					n += 1;
				}
				const stJson = exportStLorebook(card.name, card.book);
				writeFileSync(dest, `${JSON.stringify(stJson, null, "\t")}\n`, "utf8");
				const rel = `${LOREBOOKS_DIR}/${file}`;
				// 追加挂载，不顶掉其它已启用的书
				const next = setMountedLorebooks(config, [...mountedLorebookPaths(config), rel]);
				writeJsonWithBackup(configPath(host.cwd), next);
				await host.softRefreshConfig();
				host.notify("info", `已导入配套世界书「${card.name}」（${card.book.length} 条）并加入挂载`);
				sendJson(res, 200, { ok: true, path: rel, entryCount: card.book.length, name: card.name });
				return true;
			}

			// ---- 世界书 ----
			/**
			 * 条目列表：默认按「当前点开的那一本」返回，不合并多本。
			 * - ?path=assets/lorebooks/xxx.json → 只返回该文件条目
			 * - ?source=agent → 只返回当前卡的 agent 补充设定
			 * - 无参 → 空列表（避免误把全部挂载书砸进 UI）
			 * 会话上下文仍由 config.lorebooks 多本合并（扩展层），与本列表解耦。
			 */
			default:
				return false;
	}
}
