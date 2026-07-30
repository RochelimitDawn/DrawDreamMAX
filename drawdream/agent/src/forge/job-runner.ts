/**
 * Forge 阶段机：index → extract → reduce → (await cast) → elevate → ready → apply
 * Phase A：失败续跑、cast selection、草稿保存
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { extractChunk, type ChunkExtractResult } from "./extract.ts";
import {
	buildTimeline,
	elevateAssets,
	elevateSideCards,
	refineElevateDraft,
} from "./elevate.ts";
import { resolveForgeLlm, type ForgeLlmTarget } from "./llm.ts";
import {
	appendError,
	castPath,
	defaultCastSelection,
	deleteJob as deleteJobDir,
	hasChunkExtract,
	jobDir,
	buildExportPack,
	listElevateVersions,
	loadCastSelection,
	loadElevateDraftFull,
	loadExtraCards,
	loadJob,
	loadMapping,
	loadMergedCast,
	loadMergedLore,
	loadOutline,
	loadProgress,
	loadTimeline,
	restoreElevateVersion,
	lorePath,
	readChunkText,
	readSource,
	saveCastSelection,
	saveElevateDraftFull,
	saveExtraCards,
	saveJob,
	saveMapping,
	saveMergedCast,
	saveMergedLore,
	saveOutline,
	saveTimeline,
	setStage,
	snapshotElevateVersion,
	writeChunkText,
	writeJson,
} from "./job-store.ts";
import { chunkNovel, selectChunkIndices } from "./chunker.ts";
import {
	buildReverseOutline,
	outlineToPromptContext,
	parseUserOutlineText,
	shouldEnableOutline,
} from "./outline.ts";
import { mergeCast, mergeLore, pickDefaultProtagonist } from "./reduce.ts";
import { materializeForgeAssets } from "./materialize.ts";
import {
	classifyForgeError,
	type CastMention,
	type CastSelection,
	type ForgeJobMeta,
	type ForgeStage,
	type LoreDraftEntry,
} from "./types.ts";
import type { CharacterCard, RpConfig } from "../types.ts";
import { readJsonFile } from "../jsonio.ts";
import { estimateForgeJob } from "./estimate.ts";

const running = new Map<string, Promise<void>>();
/** 协作式取消：管道在块间隙检查 */
const cancelRequested = new Set<string>();

function throwIfCancelled(jobId: string): void {
	if (!cancelRequested.has(jobId)) return;
	cancelRequested.delete(jobId);
	const err = new Error("任务已取消");
	(err as Error & { code?: string }).code = "FORGE_CANCELLED";
	throw err;
}

/** 管道选项：续跑 / 降温度 */
export interface PipelineOpts {
	/** 强制重新分块（忽略已有 mapping） */
	forceReindex?: boolean;
	/** 仅 reduce（跳过 extract） */
	reduceOnly?: boolean;
	/** extract 温度 */
	extractTemperature?: number;
	/** 强制重跑反向大纲 */
	forceOutline?: boolean;
}

export type RetryFrom =
	| "auto"
	| "indexing"
	| "outlining"
	| "extracting"
	| "reducing"
	| "elevating"
	| "full";

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	async function worker() {
		while (next < items.length) {
			const i = next++;
			results[i] = await fn(items[i], i);
		}
	}
	const n = Math.max(1, Math.min(concurrency, items.length || 1));
	await Promise.all(Array.from({ length: n }, () => worker()));
	return results;
}

function resolveExtractLlm(cwd: string, job: ForgeJobMeta): ForgeLlmTarget {
	return resolveForgeLlm(cwd, {
		model: job.options.extractModel,
		provider: job.options.extractProvider,
	});
}

function resolveElevateLlm(cwd: string, job: ForgeJobMeta): ForgeLlmTarget {
	return resolveForgeLlm(cwd, {
		model: job.options.elevateModel || job.options.extractModel,
		provider: job.options.elevateProvider || job.options.extractProvider,
	});
}

function failJob(cwd: string, jobId: string, msg: string, failedStage: ForgeStage): void {
	if ((msg === "任务已取消" || /FORGE_CANCELLED|已取消/.test(msg)) && cancelRequested.has(jobId)) {
		cancelRequested.delete(jobId);
	}
	if (msg === "任务已取消" || /任务已取消/.test(msg)) {
		appendError(cwd, jobId, msg);
		setStage(cwd, jobId, "cancelled", {
			percent: 0,
			message: "任务已取消",
			error: undefined,
			failedStage,
		});
		return;
	}
	appendError(cwd, jobId, msg);
	setStage(cwd, jobId, "failed", {
		percent: 0,
		message: msg,
		error: msg,
		errorClass: classifyForgeError(msg),
		failedStage,
	});
}

/** 请求取消运行中任务（协作式，在块间隙生效） */
export function cancelJob(cwd: string, jobId: string): { ok: boolean; message: string } {
	const job = loadJob(cwd, jobId);
	if (!job) throw new Error("任务不存在");
	if (job.stage === "applied") throw new Error("任务已入库，无法取消");
	if (job.stage === "ready" || job.stage === "awaiting_cast") {
		return { ok: false, message: "当前阶段无需取消，可直接升华或删除任务" };
	}
	if (job.stage === "cancelled") return { ok: true, message: "任务已是取消态" };
	cancelRequested.add(jobId);
	if (!running.has(jobId)) {
		// 未在跑但卡在中间态
		if (
			job.stage === "queued" ||
			job.stage === "indexing" ||
			job.stage === "outlining" ||
			job.stage === "extracting" ||
			job.stage === "reducing" ||
			job.stage === "elevating" ||
			job.stage === "failed"
		) {
			setStage(cwd, jobId, "cancelled", {
				percent: 0,
				message: "任务已取消",
				failedStage: job.stage === "failed" ? loadProgress(cwd, jobId)?.failedStage : job.stage,
			});
			cancelRequested.delete(jobId);
			return { ok: true, message: "任务已取消" };
		}
	}
	return { ok: true, message: "已请求取消，将在当前步骤结束后停止" };
}

export function isJobRunning(jobId: string): boolean {
	return running.has(jobId);
}

export function startJob(cwd: string, jobId: string): { started: boolean; message: string } {
	if (running.has(jobId)) return { started: false, message: "任务已在运行" };
	const job = loadJob(cwd, jobId);
	if (!job) throw new Error("任务不存在");
	if (job.stage === "applied") throw new Error("任务已 apply，请新建任务");
	if (job.stage === "ready") return { started: false, message: "已就绪，可确认主角后 elevate 或 apply" };
	if (job.stage === "awaiting_cast") {
		return { started: false, message: "请确认角色名单后升华" };
	}
	cancelRequested.delete(jobId);

	const progress = loadProgress(cwd, jobId);
	// 升华阶段失败：只重跑 elevate
	if (job.stage === "failed" && progress?.failedStage === "elevating") {
		const p = elevateJob(cwd, jobId, job.options.protagonist)
			.then(() => undefined)
			.finally(() => running.delete(jobId));
		running.set(jobId, p);
		return { started: true, message: "从升华阶段重试" };
	}

	const p = runPipeline(cwd, jobId).finally(() => running.delete(jobId));
	running.set(jobId, p);
	return { started: true, message: "已启动" };
}

/**
 * 从失败阶段续跑或整段重跑。
 * - auto：按 progress.failedStage 决定
 * - full / indexing：重新分块 + extract + reduce
 * - extracting：保留 mapping，补跑未完成 chunk
 * - reducing：仅合并
 * - elevating：仅升华
 */
export function retryJob(
	cwd: string,
	jobId: string,
	opts?: { from?: RetryFrom; lowTemp?: boolean },
): { started: boolean; message: string } {
	if (running.has(jobId)) return { started: false, message: "任务已在运行" };
	const job = loadJob(cwd, jobId);
	if (!job) throw new Error("任务不存在");
	if (job.stage === "applied") throw new Error("任务已 apply，请新建任务");
	cancelRequested.delete(jobId);

	const progress = loadProgress(cwd, jobId);
	const from: RetryFrom = opts?.from ?? "auto";
	let target: RetryFrom = from;
	if (from === "auto") {
		if (job.stage === "failed" && progress?.failedStage) {
			const fs = progress.failedStage;
			if (fs === "elevating") target = "elevating";
			else if (fs === "reducing") target = "reducing";
			else if (fs === "extracting") target = "extracting";
			else if (fs === "outlining") target = "outlining";
			else if (fs === "indexing") target = "indexing";
			else target = "extracting";
		} else if (job.stage === "ready" || job.stage === "awaiting_cast") {
			target = "elevating";
		} else {
			target = "extracting";
		}
	}

	const lowTemp = opts?.lowTemp === true;
	const extractTemp = lowTemp ? 0 : undefined;
	const elevateTemp = lowTemp ? 0 : undefined;

	if (target === "elevating") {
		const p = elevateJob(cwd, jobId, job.options.protagonist, { temperature: elevateTemp })
			.then(() => undefined)
			.finally(() => running.delete(jobId));
		running.set(jobId, p);
		return { started: true, message: lowTemp ? "以降温度重试升华" : "从升华阶段重试" };
	}

	const pipelineOpts: PipelineOpts = {
		forceReindex: target === "full" || target === "indexing",
		reduceOnly: target === "reducing",
		extractTemperature: extractTemp,
		forceOutline: target === "outlining" || target === "full",
	};

	const p = runPipeline(cwd, jobId, pipelineOpts).finally(() => running.delete(jobId));
	running.set(jobId, p);
	const msg =
		target === "reducing"
			? "从合并阶段重试"
			: target === "outlining"
				? "从大纲阶段重试"
				: target === "full" || target === "indexing"
					? "整任务重跑（重新分块）"
					: lowTemp
						? "以降温度重试提取"
						: "从提取阶段续跑";
	return { started: true, message: msg };
}

export async function runPipeline(cwd: string, jobId: string, opts: PipelineOpts = {}): Promise<void> {
	const job = loadJob(cwd, jobId);
	if (!job) return;
	let currentStage: ForgeStage = job.stage === "failed" ? "extracting" : job.stage;
	try {
		throwIfCancelled(jobId);
		let target: ForgeLlmTarget | null = null;
		try {
			target = resolveExtractLlm(cwd, job);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			failJob(cwd, jobId, msg, "queued");
			return;
		}

		const existingMapping = loadMapping(cwd, jobId);
		const needIndex =
			opts.forceReindex === true ||
			existingMapping.length === 0 ||
			job.stage === "queued" ||
			job.stage === "indexing";

		// ---- index ----
		if (needIndex && !opts.reduceOnly) {
			currentStage = "indexing";
			setStage(cwd, jobId, "indexing", { percent: 5, message: "分块中…" });
			const source = readSource(cwd, jobId);
			const pieces = chunkNovel(source, {
				chunkChars: job.options.chunkChars,
				chunkOverlap: job.options.chunkOverlap,
			});
			if (pieces.length === 0) {
				failJob(cwd, jobId, "正文为空", "indexing");
				return;
			}
			for (const p of pieces) {
				writeChunkText(cwd, jobId, p.meta.id, p.text);
			}
			saveMapping(
				cwd,
				jobId,
				pieces.map((p) => p.meta),
			);
			job.stage = "extracting";
			saveJob(cwd, job);
			setStage(cwd, jobId, "extracting", {
				percent: 8,
				message: `已分 ${pieces.length} 块`,
				chunkTotal: pieces.length,
				chunkDone: 0,
			});
		}

		// ---- outlining（deep 默认 / enableOutline）----
		if (!opts.reduceOnly) {
			const wantOutline = shouldEnableOutline(job.options.mode, job.options.enableOutline);
			const existingOutline = loadOutline(cwd, jobId);
			const hasUserOutline = !!(job.options.outlineText && job.options.outlineText.trim());
			if (wantOutline && (opts.forceOutline || !existingOutline)) {
				currentStage = "outlining";
				setStage(cwd, jobId, "outlining", { percent: 12, message: "生成反向大纲…" });
				if (hasUserOutline && !opts.forceOutline) {
					saveOutline(cwd, jobId, parseUserOutlineText(job.options.outlineText!));
					setStage(cwd, jobId, "outlining", { percent: 15, message: "已载入用户大纲" });
				} else if (target) {
					const mapping = loadMapping(cwd, jobId);
					const indices = selectChunkIndices(
						mapping.length,
						job.options.mode === "quick" ? "quick" : "standard",
						Math.min(job.options.sampleChunks ?? 16, 16),
					);
					const pieces = indices
						.map((i) => {
							const meta = mapping[i];
							if (!meta) return null;
							return {
								index: i,
								title: meta.title,
								text: readChunkText(cwd, jobId, meta.id),
							};
						})
						.filter((x): x is { index: number; title?: string; text: string } => !!x);
					const outline = await buildReverseOutline({
						target,
						title: job.options.title,
						pieces,
						useLlm: true,
						temperature: opts.extractTemperature,
					});
					saveOutline(cwd, jobId, outline);
					setStage(cwd, jobId, "outlining", {
						percent: 18,
						message: `大纲完成：${outline.chapters.length} 节`,
					});
				}
			} else if (hasUserOutline && !existingOutline) {
				saveOutline(cwd, jobId, parseUserOutlineText(job.options.outlineText!));
			}
		}

		const outlineCtx = outlineToPromptContext(loadOutline(cwd, jobId));

		// ---- extract ----
		if (!opts.reduceOnly) {
			currentStage = "extracting";
			const mapping = loadMapping(cwd, jobId);
			if (mapping.length === 0) {
				failJob(cwd, jobId, "缺少分块 mapping，请整任务重跑", "indexing");
				return;
			}
			const indices = selectChunkIndices(
				mapping.length,
				job.options.mode,
				job.options.sampleChunks ?? 24,
			);
			const todo = indices.filter((i) => {
				const id = mapping[i]?.id;
				return id && !hasChunkExtract(cwd, jobId, id);
			});
			const concurrency = job.options.concurrency ?? 2;
			let doneBase = indices.length - todo.length;
			setStage(cwd, jobId, "extracting", {
				percent: 20 + Math.floor((doneBase / Math.max(1, indices.length)) * 45),
				message: `提取中 ${doneBase}/${indices.length}`,
				chunkTotal: indices.length,
				chunkDone: doneBase,
			});

			await mapPool(todo, concurrency, async (chunkIndex) => {
				throwIfCancelled(jobId);
				const meta = mapping[chunkIndex];
				if (!meta || !target) return;
				try {
					const text = readChunkText(cwd, jobId, meta.id);
					const result = await extractChunk(target, text, chunkIndex, job.options.title, {
						temperature: opts.extractTemperature,
						outlineContext: outlineCtx || undefined,
					});
					writeJson(castPath(cwd, jobId, meta.id), result);
					writeJson(lorePath(cwd, jobId, meta.id), { lore: result.lore, summary: result.summary });
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					if (msg === "任务已取消" || (e as { code?: string })?.code === "FORGE_CANCELLED") throw e;
					appendError(cwd, jobId, `chunk ${meta.id}: ${msg}`);
					const empty: ChunkExtractResult = { characters: [], lore: [], summary: "" };
					writeJson(castPath(cwd, jobId, meta.id), empty);
					writeJson(lorePath(cwd, jobId, meta.id), { lore: [], summary: "", error: msg });
				}
				doneBase += 1;
				setStage(cwd, jobId, "extracting", {
					percent: 20 + Math.floor((doneBase / Math.max(1, indices.length)) * 45),
					message: `提取中 ${doneBase}/${indices.length}`,
					chunkTotal: indices.length,
					chunkDone: doneBase,
				});
			});
		}

		throwIfCancelled(jobId);

		// ---- reduce ----
		currentStage = "reducing";
		setStage(cwd, jobId, "reducing", { percent: 65, message: "合并角色与设定…" });
		{
			const mapping = loadMapping(cwd, jobId);
			const indices = selectChunkIndices(
				mapping.length,
				job.options.mode,
				job.options.sampleChunks ?? 24,
			);
			const castLists: CastMention[][] = [];
			const loreLists: LoreDraftEntry[][] = [];
			const summaries: string[] = [];
			for (const i of indices) {
				const id = mapping[i]?.id;
				if (!id) continue;
				const p = castPath(cwd, jobId, id);
				if (!existsSync(p)) continue;
				try {
					const data = readJsonFile(p) as ChunkExtractResult;
					if (Array.isArray(data.characters)) castLists.push(data.characters);
					if (Array.isArray(data.lore)) loreLists.push(data.lore);
					if (data.summary) summaries.push(data.summary);
				} catch {
					/* skip */
				}
			}
			const cast = mergeCast(castLists);
			const lore = mergeLore(loreLists);
			saveMergedCast(cwd, jobId, cast);
			saveMergedLore(cwd, jobId, lore);
			writeJson(join(jobDir(cwd, jobId), "elevate", "summaries.json"), { summaries });
			// 若尚无 selection，写入默认名单
			if (!loadCastSelection(cwd, jobId) && cast.length) {
				saveCastSelection(cwd, jobId, defaultCastSelection(cast, job.options.protagonist));
			}
		}

		setStage(cwd, jobId, "awaiting_cast", {
			percent: 75,
			message: "请确认角色名单后继续升华",
		});
		const j = loadJob(cwd, jobId);
		if (j) {
			j.stage = "awaiting_cast";
			saveJob(cwd, j);
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		failJob(cwd, jobId, msg, currentStage);
	}
}

function resolveDisplayName(name: string, renames: Record<string, string>): string {
	const r = renames[name];
	return (r && r.trim()) || name;
}

function buildCastForElevate(cast: CastMention[], sel: CastSelection): CastMention[] {
	const byName = new Map(cast.map((c) => [c.name, c]));
	const out: CastMention[] = [];
	const seen = new Set<string>();
	const allNames = Array.from(
		new Set([...sel.selected, sel.protagonist, ...sel.manual].filter(Boolean)),
	);
	for (const raw of allNames) {
		const display = resolveDisplayName(raw, sel.renames);
		if (seen.has(display)) continue;
		seen.add(display);
		const src = byName.get(raw) || byName.get(display);
		if (src) {
			out.push({
				...src,
				name: display,
				aliases: Array.from(
					new Set([...(src.aliases || []), raw !== display ? raw : ""].filter(Boolean)),
				),
			});
		} else {
			out.push({
				name: display,
				aliases: raw !== display ? [raw] : [],
				roleHint: sel.manual.includes(raw) ? "手动添加" : "",
				traits: [],
				count: 1,
				chunks: [],
			});
		}
	}
	// 保留未入选角色作世界观上下文（不制卡，但 elevate 可见）
	for (const c of cast) {
		const display = resolveDisplayName(c.name, sel.renames);
		if (seen.has(display)) continue;
		out.push({ ...c, name: display });
		seen.add(display);
	}
	return out;
}

export async function elevateJob(
	cwd: string,
	jobId: string,
	protagonist?: string,
	opts?: {
		multiCard?: boolean;
		multiCardLimit?: number;
		sideNames?: string[];
		selection?: CastSelection;
		temperature?: number;
	},
): Promise<ForgeJobMeta> {
	const job0 = loadJob(cwd, jobId);
	if (!job0) throw new Error("任务不存在");
	const prev = running.get(jobId);
	if (prev) {
		try {
			await prev;
		} catch {
			/* 前序失败不阻断升华，由 stage 判定 */
		}
	}
	const job = loadJob(cwd, jobId);
	if (!job) throw new Error("任务不存在");
	if (
		job.stage !== "awaiting_cast" &&
		job.stage !== "ready" &&
		job.stage !== "elevating" &&
		job.stage !== "failed"
	) {
		throw new Error(`当前阶段 ${job.stage} 不可升华，请先完成提取`);
	}
	// failed 仅允许 failedStage=elevating 或已有 merged cast
	if (job.stage === "failed") {
		const progress = loadProgress(cwd, jobId);
		const castOk = loadMergedCast(cwd, jobId).length > 0;
		if (progress?.failedStage && progress.failedStage !== "elevating" && !castOk) {
			throw new Error("提取未完成，请先从失败阶段续跑");
		}
	}
	if (running.has(jobId)) throw new Error("任务运行中，请稍候");

	if (typeof opts?.multiCard === "boolean") job.options.multiCard = opts.multiCard;
	if (typeof opts?.multiCardLimit === "number") job.options.multiCardLimit = opts.multiCardLimit;

	const run = async () => {
		throwIfCancelled(jobId);
		setStage(cwd, jobId, "elevating", { percent: 80, message: "升华角色卡与世界书…" });
		const cast = loadMergedCast(cwd, jobId);
		const lore = loadMergedLore(cwd, jobId);
		const sumPath = join(jobDir(cwd, jobId), "elevate", "summaries.json");
		const summaries = existsSync(sumPath)
			? ((readJsonFile(sumPath) as { summaries?: string[] }).summaries ?? [])
			: [];

		let sel: CastSelection =
			opts?.selection ||
			loadCastSelection(cwd, jobId) ||
			defaultCastSelection(
				cast,
				protagonist || job.options.protagonist || pickDefaultProtagonist(cast),
			);
		if (protagonist?.trim()) {
			sel = {
				...sel,
				protagonist: protagonist.trim(),
				selected: Array.from(new Set([protagonist.trim(), ...sel.selected])),
			};
		}
		if (!sel.protagonist) {
			sel.protagonist = pickDefaultProtagonist(cast) || cast[0]?.name || "主角";
		}
		if (!sel.selected.length) {
			sel.selected = [sel.protagonist];
		}
		if (!sel.selected.includes(sel.protagonist)) {
			sel.selected = [sel.protagonist, ...sel.selected];
		}
		saveCastSelection(cwd, jobId, sel);

		const castForElevate = buildCastForElevate(cast, sel);
		const name = resolveDisplayName(sel.protagonist, sel.renames);
		job.options.protagonist = name;
		saveJob(cwd, job);

		let target: ForgeLlmTarget | null = null;
		try {
			target = resolveElevateLlm(cwd, job);
		} catch {
			target = null;
		}
		const dummy: ForgeLlmTarget = {
			provider: "",
			model: "",
			baseUrl: "",
			apiKey: "",
			headers: {},
		};
		const outlineCtx = outlineToPromptContext(loadOutline(cwd, jobId));
		const elevated = await elevateAssets({
			target: target ?? dummy,
			protagonist: name,
			cast: castForElevate,
			lore,
			summaries,
			title: job.options.title,
			useLlm: !!target,
			temperature: opts?.temperature,
			outlineContext: outlineCtx || undefined,
		});
		writeJson(join(jobDir(cwd, jobId), "elevate", "card.json"), elevated.card);
		writeJson(join(jobDir(cwd, jobId), "elevate", "lorebook.json"), { entries: elevated.loreEntries });

		// 配角：优先 selection.selected；否则 multiCard + limit
		const sideFromSel = sel.selected
			.filter((n) => resolveDisplayName(n, sel.renames) !== name)
			.map((n) => resolveDisplayName(n, sel.renames));
		const multi = job.options.multiCard === true || sideFromSel.length > 0;
		const limit = Math.max(
			0,
			Math.min(12, sideFromSel.length || (job.options.multiCardLimit ?? 4)),
		);
		if (multi && limit > 0) {
			setStage(cwd, jobId, "elevating", { percent: 88, message: "生成配角角色卡…" });
			const sideNames =
				opts?.sideNames?.filter(Boolean) ??
				(sideFromSel.length
					? sideFromSel.slice(0, limit)
					: cast
							.map((c) => c.name)
							.filter((n) => n !== name)
							.slice(0, limit));
			const extras = await elevateSideCards({
				target: target ?? dummy,
				names: sideNames,
				cast: castForElevate,
				summaries,
				title: job.options.title,
				useLlm: !!target,
				temperature: opts?.temperature,
			});
			saveExtraCards(cwd, jobId, extras);
		} else {
			saveExtraCards(cwd, jobId, []);
		}

		if (job.options.mode === "deep") {
			setStage(cwd, jobId, "elevating", { percent: 92, message: "构建事件时间线…" });
			const timeline = await buildTimeline({
				target: target ?? dummy,
				summaries,
				title: job.options.title,
				useLlm: !!target,
			});
			saveTimeline(cwd, jobId, timeline);
			const loreWithTl = [
				...elevated.loreEntries,
				...timeline.map((ev) => ({
					title: `时间线·${ev.title}`,
					keys: ev.keys.length ? ev.keys : [ev.title],
					content: [ev.chapterHint ? `章节提示：${ev.chapterHint}` : "", ev.summary]
						.filter(Boolean)
						.join("\n"),
					constant: false,
					order: 50 + ev.order,
				})),
			];
			writeJson(join(jobDir(cwd, jobId), "elevate", "lorebook.json"), { entries: loreWithTl });
		}

		job.stage = "ready";
		saveJob(cwd, job);
		setStage(cwd, jobId, "ready", { percent: 95, message: "已生成草稿，请审阅后 Apply 入库" });
	};

	const p = run()
		.catch((e) => {
			const msg = e instanceof Error ? e.message : String(e);
			failJob(cwd, jobId, msg, "elevating");
			throw e;
		})
		.finally(() => running.delete(jobId));
	running.set(jobId, p);
	await p;
	return loadJob(cwd, jobId)!;
}

export function loadElevateDraft(cwd: string, jobId: string): {
	card: CharacterCard | null;
	lore: LoreDraftEntry[];
} {
	const full = loadElevateDraftFull(cwd, jobId);
	return { card: full.card, lore: full.lore };
}

/** 保存用户编辑后的草稿（ready 阶段） */
export function saveDraft(
	cwd: string,
	jobId: string,
	draft: {
		card?: Partial<CharacterCard> & { name?: string };
		lore?: LoreDraftEntry[];
		extraCards?: CharacterCard[];
	},
): { ok: boolean; stage: string } {
	const job = loadJob(cwd, jobId);
	if (!job) throw new Error("任务不存在");
	if (job.stage !== "ready" && job.stage !== "applied") {
		throw new Error("仅就绪或已入库任务可编辑草稿");
	}
	const existing = loadElevateDraftFull(cwd, jobId);
	let card = existing.card;
	if (draft.card) {
		const base: CharacterCard = card ?? {
			name: draft.card.name || "未命名",
			description: "",
			personality: "",
			scenario: "",
			firstMes: "",
			mesExample: "",
			systemPrompt: "",
			postHistoryInstructions: "",
			creatorNotes: "由工坊从小说生成",
			alternateGreetings: [],
			tags: ["novel-forge"],
			book: [],
		};
		card = {
			...base,
			...draft.card,
			name: (draft.card.name ?? base.name).trim() || base.name,
			description: draft.card.description ?? base.description,
			personality: draft.card.personality ?? base.personality,
			scenario: draft.card.scenario ?? base.scenario,
			firstMes: draft.card.firstMes ?? base.firstMes,
			systemPrompt: draft.card.systemPrompt ?? base.systemPrompt,
			tags: Array.isArray(draft.card.tags) ? draft.card.tags : base.tags,
		};
	}
	saveElevateDraftFull(cwd, jobId, {
		card: card ?? undefined,
		lore: draft.lore,
		extraCards: draft.extraCards,
	});
	if (job.stage === "applied") {
		job.stage = "ready";
		saveJob(cwd, job);
		setStage(cwd, jobId, "ready", { percent: 95, message: "草稿已更新，可重新 Apply" });
	}
	return { ok: true, stage: loadJob(cwd, jobId)?.stage || "ready" };
}

/** 保存/覆盖反向大纲草稿（可在 awaiting_cast 前轻量编辑） */
export function updateOutline(
	cwd: string,
	jobId: string,
	patch: {
		blurb?: string;
		themes?: string[];
		conflicts?: string[];
		chapters?: { title: string; summary: string; castHints?: string[]; beats?: string[] }[];
	},
): { ok: boolean; outline: ReturnType<typeof loadOutline> } {
	const job = loadJob(cwd, jobId);
	if (!job) throw new Error("任务不存在");
	const prev = loadOutline(cwd, jobId);
	const chapters = Array.isArray(patch.chapters)
		? patch.chapters
				.map((c) => ({
					title: String(c.title || "").trim() || "未命名",
					summary: String(c.summary || "").trim(),
					castHints: Array.isArray(c.castHints)
						? c.castHints.filter((x): x is string => typeof x === "string")
						: [],
					beats: Array.isArray(c.beats)
						? c.beats.filter((x): x is string => typeof x === "string")
						: [],
				}))
				.filter((c) => c.title || c.summary)
		: prev?.chapters || [];
	if (!chapters.length) throw new Error("大纲章节不能为空");
	const next = {
		blurb: typeof patch.blurb === "string" ? patch.blurb.trim() : prev?.blurb,
		themes: Array.isArray(patch.themes)
			? patch.themes.filter((x): x is string => typeof x === "string")
			: prev?.themes || [],
		conflicts: Array.isArray(patch.conflicts)
			? patch.conflicts.filter((x): x is string => typeof x === "string")
			: prev?.conflicts || [],
		chapters,
		source: (prev?.source || "user") as "auto" | "user",
		updatedAt: Date.now(),
	};
	saveOutline(cwd, jobId, next);
	return { ok: true, outline: loadOutline(cwd, jobId) };
}

/** 保存 cast 勾选名单 */
export function updateCastSelection(
	cwd: string,
	jobId: string,
	sel: CastSelection,
): { ok: boolean; selection: CastSelection } {
	const job = loadJob(cwd, jobId);
	if (!job) throw new Error("任务不存在");
	if (job.stage !== "awaiting_cast" && job.stage !== "ready" && job.stage !== "failed") {
		throw new Error("当前阶段不可编辑角色名单");
	}
	const cast = loadMergedCast(cwd, jobId);
	const next: CastSelection = {
		protagonist: (sel.protagonist || "").trim() || pickDefaultProtagonist(cast) || cast[0]?.name || "",
		selected: Array.isArray(sel.selected) ? sel.selected : [],
		renames: sel.renames && typeof sel.renames === "object" ? sel.renames : {},
		manual: Array.isArray(sel.manual) ? sel.manual : [],
	};
	saveCastSelection(cwd, jobId, next);
	const saved = loadCastSelection(cwd, jobId)!;
	if (saved.protagonist) {
		job.options.protagonist = resolveDisplayName(saved.protagonist, saved.renames);
		saveJob(cwd, job);
	}
	return { ok: true, selection: saved };
}

export async function refineJob(
	cwd: string,
	jobId: string,
	instruction: string,
): Promise<ForgeJobMeta> {
	const job = loadJob(cwd, jobId);
	if (!job) throw new Error("任务不存在");
	if (job.stage !== "ready" && job.stage !== "applied") {
		throw new Error("请先完成升华再修订");
	}
	if (running.has(jobId)) throw new Error("任务运行中，请稍候");
	const text = instruction.trim();
	if (!text) throw new Error("修订指令为空");

	const run = async () => {
		setStage(cwd, jobId, "elevating", { percent: 90, message: "按指令修订草稿…" });
		const { card, lore } = loadElevateDraft(cwd, jobId);
		if (!card) throw new Error("缺少 elevate/card.json");
		const ver = snapshotElevateVersion(cwd, jobId);
		let target: ForgeLlmTarget | null = null;
		try {
			target = resolveElevateLlm(cwd, job);
		} catch {
			target = null;
		}
		const refined = await refineElevateDraft({
			target: target ?? { provider: "", model: "", baseUrl: "", apiKey: "", headers: {} },
			instruction: text,
			card,
			lore,
			useLlm: !!target,
		});
		writeJson(join(jobDir(cwd, jobId), "elevate", "card.json"), refined.card);
		writeJson(join(jobDir(cwd, jobId), "elevate", "lorebook.json"), { entries: refined.lore });
		job.stage = "ready";
		saveJob(cwd, job);
		setStage(cwd, jobId, "ready", {
			percent: 95,
			message: `修订完成（已存档 v${ver}），可重新 Apply`,
		});
	};

	const p = run()
		.catch((e) => {
			const msg = e instanceof Error ? e.message : String(e);
			failJob(cwd, jobId, msg, "elevating");
			throw e;
		})
		.finally(() => running.delete(jobId));
	running.set(jobId, p);
	await p;
	return loadJob(cwd, jobId)!;
}

export function applyJob(
	cwd: string,
	jobId: string,
	config: RpConfig,
	opts?: { switchCard?: boolean; mountLore?: boolean },
): {
	cardPath: string;
	lorebookPath: string;
	cardName: string;
	entryCount: number;
	extraCardPaths: string[];
	config: RpConfig;
} {
	const job = loadJob(cwd, jobId);
	if (!job) throw new Error("任务不存在");
	if (job.stage !== "ready" && job.stage !== "applied") {
		throw new Error("请先完成升华（ready）再 Apply");
	}
	const { card, lore } = loadElevateDraft(cwd, jobId);
	if (!card) throw new Error("缺少 elevate/card.json");
	const extras = loadExtraCards(cwd, jobId);
	const result = materializeForgeAssets({
		cwd,
		card,
		loreDrafts: lore,
		config,
		switchCard: opts?.switchCard ?? job.options.switchCard,
		mountLore: opts?.mountLore ?? job.options.mountLore,
		bookName: job.options.title ? `${job.options.title}-世界书` : undefined,
		extraCards: extras,
	});
	job.stage = "applied";
	job.result = {
		cardPath: result.cardPath,
		lorebookPath: result.lorebookPath,
		cardName: result.cardName,
	};
	saveJob(cwd, job);
	setStage(cwd, jobId, "applied", { percent: 100, message: "已写入资产并挂载" });
	return result;
}

export function removeJob(cwd: string, jobId: string): { ok: boolean } {
	if (running.has(jobId)) throw new Error("任务运行中，无法删除");
	const ok = deleteJobDir(cwd, jobId);
	if (!ok) throw new Error("任务不存在");
	return { ok: true };
}

export function jobPublicView(cwd: string, jobId: string) {
	const job = loadJob(cwd, jobId);
	if (!job) return null;
	const progress = loadProgress(cwd, jobId);
	const cast = loadMergedCast(cwd, jobId);
	const full = loadElevateDraftFull(cwd, jobId);
	const extras = full.extraCards;
	const timeline = loadTimeline(cwd, jobId);
	const selection =
		loadCastSelection(cwd, jobId) ||
		(cast.length ? defaultCastSelection(cast, job.options.protagonist) : null);
	const outline = loadOutline(cwd, jobId);
	const estimate = estimateForgeJob({
		sourceChars: job.sourceChars,
		mode: job.options.mode,
		sampleChunks: job.options.sampleChunks,
		chunkChars: job.options.chunkChars,
		extraCards: job.options.multiCard ? (job.options.multiCardLimit ?? 4) : 0,
		enableOutline: shouldEnableOutline(job.options.mode, job.options.enableOutline),
		hasUserOutline: !!(job.options.outlineText && job.options.outlineText.trim()) || !!outline,
	});
	return {
		job,
		progress,
		running: isJobRunning(jobId),
		cast: cast.slice(0, 40).map((c) => ({
			name: c.name,
			aliases: c.aliases,
			roleHint: c.roleHint,
			traits: c.traits.slice(0, 8),
			count: c.count,
			chunkSpan: c.chunks.length,
		})),
		selection,
		outline: outline
			? {
					blurb: outline.blurb,
					themes: outline.themes,
					conflicts: outline.conflicts,
					chapterCount: outline.chapters.length,
					chapters: outline.chapters.slice(0, 30).map((c) => ({
						title: c.title,
						summary: c.summary.slice(0, 240),
						castHints: c.castHints.slice(0, 8),
					})),
					source: outline.source,
				}
			: null,
		draft: full.card
			? {
					cardName: full.card.name,
					descriptionPreview: full.card.description.slice(0, 200),
					loreCount: full.lore.length,
					extraCardNames: extras.map((c) => c.name),
					card: full.card,
					lore: full.lore,
					extraCards: extras,
				}
			: null,
		...(() => {
			const versions = listElevateVersions(cwd, jobId);
			return {
				versions,
				stats: {
					sourceChars: job.sourceChars,
					mode: job.options.mode,
					castCount: cast.length,
					selectedCount: selection?.selected?.length ?? 0,
					outlineChapters: outline?.chapters.length ?? 0,
					loreCount: full.lore.length,
					extraCards: extras.length,
					versionCount: versions.length,
					enableOutline: shouldEnableOutline(job.options.mode, job.options.enableOutline),
				},
			};
		})(),
		timeline: timeline.slice(0, 40),
		estimate,
		result: job.result ?? null,
	};
}

export function restoreDraftVersion(
	cwd: string,
	jobId: string,
	version: number,
): { ok: boolean; stage: string; version: number } {
	const job = loadJob(cwd, jobId);
	if (!job) throw new Error("任务不存在");
	if (job.stage !== "ready" && job.stage !== "applied") {
		throw new Error("仅就绪或已入库任务可回滚草稿版本");
	}
	restoreElevateVersion(cwd, jobId, version, { snapshotCurrent: true });
	if (job.stage === "applied") {
		job.stage = "ready";
		saveJob(cwd, job);
		setStage(cwd, jobId, "ready", {
			percent: 95,
			message: `已回滚到 v${version}，可重新 Apply`,
		});
	} else {
		setStage(cwd, jobId, "ready", {
			percent: 95,
			message: `已回滚到 v${version}`,
		});
	}
	return { ok: true, stage: "ready", version };
}

export function exportJobPack(cwd: string, jobId: string): Record<string, unknown> {
	return buildExportPack(cwd, jobId);
}
