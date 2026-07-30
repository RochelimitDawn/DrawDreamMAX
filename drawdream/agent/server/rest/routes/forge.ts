/**
 * Novel Forge 路由。
 */

import {
	cleanNovelText,
} from "../../../src/forge/chunker.ts";
import {
	estimateForgeJob,
} from "../../../src/forge/estimate.ts";
import {
	applyJob,
	cancelJob,
	elevateJob,
	exportJobPack,
	jobPublicView,
	refineJob,
	removeJob,
	restoreDraftVersion,
	retryJob,
	saveDraft,
	startJob,
	updateCastSelection,
	updateOutline,
	type RetryFrom,
} from "../../../src/forge/job-runner.ts";
import {
	createJob,
	listJobs,
	loadJob,
	setForgeProgressListener,
} from "../../../src/forge/job-store.ts";
import type { CastSelection, ForgeMode } from "../../../src/forge/types.ts";
import type { CharacterCard } from "../../../src/types.ts";
import type { LoreDraftEntry } from "../../../src/forge/types.ts";
import {
	MAX_UPLOAD,
	readBody,
	readBodyRaw,
	sendJson,
} from "../http.ts";
import {
	configPath,
	loadConfig,
	writeJsonWithBackup,
} from "../config.ts";
import type { RouteCtx } from "./context.ts";

/** 每用户 cwd 只注册一次进度钩子，避免列表/详情/创建反复 set */
const forgeProgressBound = new Set<string>();

function ensureForgeProgress(host: RouteCtx["host"]): void {
	if (forgeProgressBound.has(host.cwd)) return;
	forgeProgressBound.add(host.cwd);
	setForgeProgressListener(host.cwd, (_cwd, jobId, progress) => {
		host.broadcastFrame?.({
			type: "forge_progress",
			jobId,
			stage: progress.stage,
			percent: progress.percent,
			message: progress.message,
			chunkTotal: progress.chunkTotal,
			chunkDone: progress.chunkDone,
			error: progress.error,
			errorClass: progress.errorClass,
			failedStage: progress.failedStage,
			updatedAt: progress.updatedAt,
		});
	});
}

export async function handleForgeRoutes(ctx: RouteCtx): Promise<boolean> {
	const { req, res, host, query } = ctx;
	const refuseWhileStreaming = ctx.refuseWhileStreaming;

	switch (ctx.route) {
			case "GET /api/forge/jobs": {
				ensureForgeProgress(host);
				const jobs = listJobs(host.cwd).map((j) => ({
					id: j.id,
					sourceName: j.sourceName,
					sourceChars: j.sourceChars,
					stage: j.stage,
					mode: j.options.mode,
					title: j.options.title,
					createdAt: j.createdAt,
					updatedAt: j.updatedAt,
					result: j.result ?? null,
				}));
				sendJson(res, 200, { jobs });
				return true;
			}
			case "GET /api/forge/job": {
				ensureForgeProgress(host);
				const id = (query.get("id") ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const view = jobPublicView(host.cwd, id);
				if (!view) throw new Error("任务不存在");
				sendJson(res, 200, view);
				return true;
			}
			case "POST /api/forge/estimate": {
				const body = JSON.parse(await readBody(req)) as {
					sourceChars?: number;
					mode?: string;
					sampleChunks?: number;
					chunkChars?: number;
					extraCards?: number;
					text?: string;
					textSample?: string;
					enableOutline?: boolean;
					hasUserOutline?: boolean;
					outlineText?: string;
				};
				const cleanedText =
					typeof body.text === "string"
						? cleanNovelText(body.text)
						: typeof body.textSample === "string"
							? cleanNovelText(body.textSample)
							: "";
				const sourceChars =
					typeof body.sourceChars === "number"
						? body.sourceChars
						: cleanedText
							? cleanedText.length
							: 0;
				const mode: ForgeMode =
					body.mode === "standard" || body.mode === "deep" || body.mode === "quick"
						? body.mode
						: "quick";
				const textSample =
					cleanedText ||
					(typeof body.textSample === "string" ? body.textSample.slice(0, 120_000) : undefined);
				const hasUserOutline =
					body.hasUserOutline === true ||
					(typeof body.outlineText === "string" && !!body.outlineText.trim());
				sendJson(
					res,
					200,
					estimateForgeJob({
						sourceChars,
						mode,
						sampleChunks: body.sampleChunks,
						chunkChars: body.chunkChars,
						extraCards: body.extraCards,
						textSample,
						enableOutline:
							typeof body.enableOutline === "boolean" ? body.enableOutline : undefined,
						hasUserOutline,
					}),
				);
				return true;
			}
			/**
			 * 创建作业：body 为原文（text/plain 或 JSON { text, name, mode, title, sampleChunks }）
			 * 禁止服务端代抓外链盗版源；仅处理用户上传正文。
			 */
			case "POST /api/forge/jobs": {
				ensureForgeProgress(host);
				const ct = (req.headers["content-type"] ?? "").toLowerCase();
				let sourceName = (query.get("name") ?? "novel.txt").trim() || "novel.txt";
				let mode = (query.get("mode") ?? "quick").trim() as ForgeMode;
				let title = (query.get("title") ?? "").trim();
				let sampleChunks: number | undefined;
				let text = "";
				if (ct.includes("application/json")) {
					const body = JSON.parse(await readBody(req)) as {
						text?: string;
						name?: string;
						mode?: string;
						title?: string;
						sampleChunks?: number;
						chunkChars?: number;
						concurrency?: number;
						multiCard?: boolean;
						multiCardLimit?: number;
						extractModel?: string;
						elevateModel?: string;
						extractProvider?: string;
						elevateProvider?: string;
						enableOutline?: boolean;
						outlineText?: string;
					};
					text = typeof body.text === "string" ? body.text : "";
					if (body.name?.trim()) sourceName = body.name.trim();
					if (body.mode === "quick" || body.mode === "standard" || body.mode === "deep") mode = body.mode;
					if (body.title?.trim()) title = body.title.trim();
					if (typeof body.sampleChunks === "number") sampleChunks = body.sampleChunks;
					// 粘贴大纲时默认压采样，降低 Map 成本
					if (
						sampleChunks === undefined &&
						typeof body.outlineText === "string" &&
						body.outlineText.trim()
					) {
						sampleChunks = 8;
					}
					const meta = createJob(host.cwd, {
						sourceName,
						sourceText: cleanNovelText(text),
						options: {
							mode,
							title: title || undefined,
							sampleChunks,
							chunkChars: typeof body.chunkChars === "number" ? body.chunkChars : undefined,
							concurrency: typeof body.concurrency === "number" ? body.concurrency : undefined,
							multiCard: body.multiCard === true,
							multiCardLimit: typeof body.multiCardLimit === "number" ? body.multiCardLimit : undefined,
							extractModel: body.extractModel?.trim() || undefined,
							elevateModel: body.elevateModel?.trim() || undefined,
							extractProvider: body.extractProvider?.trim() || undefined,
							elevateProvider: body.elevateProvider?.trim() || undefined,
							enableOutline:
								typeof body.enableOutline === "boolean" ? body.enableOutline : undefined,
							outlineText:
								typeof body.outlineText === "string" && body.outlineText.trim()
									? body.outlineText.trim()
									: undefined,
						},
					});
					if (!meta.sourceChars) throw new Error("正文为空");
					const estimate = estimateForgeJob({
						sourceChars: meta.sourceChars,
						mode: meta.options.mode,
						sampleChunks: meta.options.sampleChunks,
						chunkChars: meta.options.chunkChars,
						extraCards: meta.options.multiCard ? (meta.options.multiCardLimit ?? 4) : 0,
					});
					const started = startJob(host.cwd, meta.id);
					host.notify("info", `工坊任务已创建：${meta.options.title || sourceName}`);
					sendJson(res, 200, {
						ok: true,
						id: meta.id,
						started: started.started,
						message: started.message,
						estimate,
					});
					return true;
				}
				const data = await readBodyRaw(req, MAX_UPLOAD);
				text = data.toString("utf8");
				if (query.get("mode") === "standard" || query.get("mode") === "deep" || query.get("mode") === "quick") {
					mode = query.get("mode") as ForgeMode;
				}
				const meta = createJob(host.cwd, {
					sourceName,
					sourceText: cleanNovelText(text),
					options: { mode, title: title || undefined },
				});
				if (!meta.sourceChars) throw new Error("正文为空");
				const started = startJob(host.cwd, meta.id);
				host.notify("info", `工坊任务已创建：${meta.options.title || sourceName}`);
				sendJson(res, 200, { ok: true, id: meta.id, started: started.started, message: started.message });
				return true;
			}
			case "POST /api/forge/start": {
				const body = JSON.parse(await readBody(req)) as { id?: string };
				const id = (body.id ?? "").trim();
				if (!id) throw new Error("缺少 id");
				if (!loadJob(host.cwd, id)) throw new Error("任务不存在");
				const started = startJob(host.cwd, id);
				sendJson(res, 200, { ok: true, ...started });
				return true;
			}
			case "POST /api/forge/cancel": {
				const body = JSON.parse(await readBody(req)) as { id?: string };
				const id = (body.id ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const result = cancelJob(host.cwd, id);
				sendJson(res, 200, result);
				return true;
			}
			case "POST /api/forge/retry": {
				const body = JSON.parse(await readBody(req)) as {
					id?: string;
					from?: string;
					lowTemp?: boolean;
				};
				const id = (body.id ?? "").trim();
				if (!id) throw new Error("缺少 id");
				if (!loadJob(host.cwd, id)) throw new Error("任务不存在");
				const allowed: RetryFrom[] = [
					"auto",
					"indexing",
					"outlining",
					"extracting",
					"reducing",
					"elevating",
					"full",
				];
				const from = allowed.includes(body.from as RetryFrom)
					? (body.from as RetryFrom)
					: "auto";
				const started = retryJob(host.cwd, id, {
					from,
					lowTemp: body.lowTemp === true,
				});
				sendJson(res, 200, { ok: true, ...started });
				return true;
			}
			case "PUT /api/forge/cast-selection": {
				const body = JSON.parse(await readBody(req)) as {
					id?: string;
					protagonist?: string;
					selected?: string[];
					renames?: Record<string, string>;
					manual?: string[];
				};
				const id = (body.id ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const sel: CastSelection = {
					protagonist: String(body.protagonist ?? ""),
					selected: Array.isArray(body.selected)
						? body.selected.filter((x): x is string => typeof x === "string")
						: [],
					renames:
						body.renames && typeof body.renames === "object" && !Array.isArray(body.renames)
							? body.renames
							: {},
					manual: Array.isArray(body.manual)
						? body.manual.filter((x): x is string => typeof x === "string")
						: [],
				};
				const result = updateCastSelection(host.cwd, id, sel);
				sendJson(res, 200, result);
				return true;
			}
			case "PUT /api/forge/outline": {
				const body = JSON.parse(await readBody(req)) as {
					id?: string;
					blurb?: string;
					themes?: string[];
					conflicts?: string[];
					chapters?: {
						title: string;
						summary: string;
						castHints?: string[];
						beats?: string[];
					}[];
				};
				const id = (body.id ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const result = updateOutline(host.cwd, id, {
					blurb: body.blurb,
					themes: body.themes,
					conflicts: body.conflicts,
					chapters: body.chapters,
				});
				const o = result.outline;
				sendJson(res, 200, {
					ok: true,
					outline: o
						? {
								blurb: o.blurb,
								themes: o.themes,
								conflicts: o.conflicts,
								chapterCount: o.chapters.length,
								chapters: o.chapters.slice(0, 40).map((c) => ({
									title: c.title,
									summary: c.summary.slice(0, 400),
									castHints: c.castHints.slice(0, 8),
								})),
								source: o.source,
							}
						: null,
				});
				return true;
			}
			case "PUT /api/forge/draft": {
				const body = JSON.parse(await readBody(req)) as {
					id?: string;
					card?: Partial<CharacterCard> & { name?: string };
					lore?: LoreDraftEntry[];
					extraCards?: CharacterCard[];
				};
				const id = (body.id ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const result = saveDraft(host.cwd, id, {
					card: body.card,
					lore: Array.isArray(body.lore) ? body.lore : undefined,
					extraCards: Array.isArray(body.extraCards) ? body.extraCards : undefined,
				});
				sendJson(res, 200, result);
				return true;
			}
			case "POST /api/forge/elevate": {
				const body = JSON.parse(await readBody(req)) as {
					id?: string;
					protagonist?: string;
					multiCard?: boolean;
					multiCardLimit?: number;
					sideNames?: string[];
					selection?: CastSelection;
				};
				const id = (body.id ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const job = await elevateJob(host.cwd, id, body.protagonist, {
					multiCard: body.multiCard,
					multiCardLimit: body.multiCardLimit,
					sideNames: Array.isArray(body.sideNames)
						? body.sideNames.filter((x): x is string => typeof x === "string")
						: undefined,
					selection: body.selection,
				});
				sendJson(res, 200, { ok: true, stage: job.stage, protagonist: job.options.protagonist });
				return true;
			}
			case "POST /api/forge/refine": {
				const body = JSON.parse(await readBody(req)) as { id?: string; instruction?: string };
				const id = (body.id ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const job = await refineJob(host.cwd, id, String(body.instruction ?? ""));
				sendJson(res, 200, { ok: true, stage: job.stage });
				return true;
			}
			case "POST /api/forge/restore-version": {
				const body = JSON.parse(await readBody(req)) as { id?: string; version?: number };
				const id = (body.id ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const version = Number(body.version);
				if (!Number.isFinite(version) || version < 1) throw new Error("缺少有效 version");
				const result = restoreDraftVersion(host.cwd, id, Math.floor(version));
				sendJson(res, 200, result);
				return true;
			}
			case "GET /api/forge/export": {
				const id = (query.get("id") ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const pack = exportJobPack(host.cwd, id);
				sendJson(res, 200, pack);
				return true;
			}
			case "POST /api/forge/apply": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as {
					id?: string;
					switchCard?: boolean;
					mountLore?: boolean;
				};
				const id = (body.id ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const config = loadConfig(host.cwd);
				const result = applyJob(host.cwd, id, config, {
					switchCard: body.switchCard,
					mountLore: body.mountLore,
				});
				writeJsonWithBackup(configPath(host.cwd), result.config);
				if (body.switchCard !== false) {
					try {
						await host.switchToCard();
					} catch {
						/* 切卡失败仍保留落盘 */
					}
				} else {
					await host.softRefreshConfig();
				}
				const extraN = result.extraCardPaths?.length ?? 0;
				host.notify(
					"info",
					`工坊已入库「${result.cardName}」：卡 ${result.cardPath}，书 ${result.lorebookPath}（${result.entryCount} 条）${extraN ? `，另 ${extraN} 张配角卡` : ""}`,
				);
				sendJson(res, 200, {
					ok: true,
					cardPath: result.cardPath,
					lorebookPath: result.lorebookPath,
					cardName: result.cardName,
					entryCount: result.entryCount,
					extraCardPaths: result.extraCardPaths ?? [],
				});
				return true;
			}
			case "DELETE /api/forge/job": {
				const id = (query.get("id") ?? "").trim();
				if (!id) {
					const body = JSON.parse(await readBody(req)) as { id?: string };
					const bid = (body.id ?? "").trim();
					if (!bid) throw new Error("缺少 id");
					removeJob(host.cwd, bid);
					sendJson(res, 200, { ok: true });
					return true;
				}
				removeJob(host.cwd, id);
				sendJson(res, 200, { ok: true });
				return true;
			}
			/** 调试/校验：拒绝代抓外链 */
			case "POST /api/forge/fetch-url": {
				sendJson(res, 400, {
					error: "禁止由系统代抓外部小说链接。请上传您拥有合法权利的 txt 正文。",
					code: "FORGE_NO_REMOTE_FETCH",
				});
				return true;
			}

			default:
				return false;
	}
}
