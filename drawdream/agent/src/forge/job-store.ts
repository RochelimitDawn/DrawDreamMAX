/**
 * Forge 作业目录：.drawdream-forge/<jobId>/
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { readJsonFile } from "../jsonio.ts";
import type {
	CastMention,
	CastSelection,
	ForgeChunkMeta,
	ForgeJobMeta,
	ForgeJobOptions,
	ForgeProgress,
	ForgeStage,
	LoreDraftEntry,
	OutlineDraft,
	TimelineEvent,
} from "./types.ts";
import { DEFAULT_FORGE_OPTIONS } from "./types.ts";
import type { CharacterCard } from "../types.ts";

/** 进度落盘后的可选广播钩子（按 cwd 注册，多用户互不覆盖） */
type ProgressListener = (cwd: string, jobId: string, progress: ForgeProgress) => void;
const progressListeners = new Map<string, ProgressListener>();

export function setForgeProgressListener(cwd: string, fn: ProgressListener | null): void {
	if (!fn) progressListeners.delete(cwd);
	else progressListeners.set(cwd, fn);
}

export const FORGE_ROOT = ".drawdream-forge";

export function forgeRoot(cwd: string): string {
	return join(cwd, FORGE_ROOT);
}

export function jobDir(cwd: string, jobId: string): string {
	return join(forgeRoot(cwd), jobId);
}

function newId(): string {
	const t = Date.now().toString(36);
	const r = Math.random().toString(36).slice(2, 8);
	return `${t}-${r}`;
}

export function ensureJobDirs(cwd: string, jobId: string): string {
	const dir = jobDir(cwd, jobId);
	for (const sub of ["", "chunks", "cast", "lore", "elevate"]) {
		mkdirSync(join(dir, sub), { recursive: true });
	}
	return dir;
}

export function writeJson(path: string, data: unknown): void {
	writeFileSync(path, `${JSON.stringify(data, null, "\t")}\n`, "utf8");
}

export function readJsonSafe<T>(path: string, fallback: T): T {
	if (!existsSync(path)) return fallback;
	try {
		return readJsonFile(path) as T;
	} catch {
		return fallback;
	}
}

export function createJob(
	cwd: string,
	input: {
		sourceName: string;
		sourceText: string;
		options?: Partial<ForgeJobOptions>;
	},
): ForgeJobMeta {
	const id = newId();
	const dir = ensureJobDirs(cwd, id);
	const now = Date.now();
	const options: ForgeJobOptions = {
		...DEFAULT_FORGE_OPTIONS,
		...input.options,
		title: input.options?.title || input.sourceName.replace(/\.[^.]+$/, ""),
	};
	const meta: ForgeJobMeta = {
		id,
		createdAt: now,
		updatedAt: now,
		sourceName: input.sourceName,
		sourceChars: input.sourceText.length,
		options,
		stage: "queued",
	};
	writeFileSync(join(dir, "source.txt"), input.sourceText, "utf8");
	writeJson(join(dir, "job.json"), meta);
	writeProgress(cwd, id, {
		stage: "queued",
		percent: 0,
		message: "已创建，等待执行",
		chunkTotal: 0,
		chunkDone: 0,
		updatedAt: now,
	});
	return meta;
}

export function loadJob(cwd: string, jobId: string): ForgeJobMeta | null {
	const p = join(jobDir(cwd, jobId), "job.json");
	if (!existsSync(p)) return null;
	return readJsonFile(p) as ForgeJobMeta;
}

export function saveJob(cwd: string, meta: ForgeJobMeta): void {
	meta.updatedAt = Date.now();
	writeJson(join(jobDir(cwd, meta.id), "job.json"), meta);
}

export function writeProgress(cwd: string, jobId: string, progress: ForgeProgress): void {
	writeJson(join(jobDir(cwd, jobId), "progress.json"), progress);
	try {
		progressListeners.get(cwd)?.(cwd, jobId, progress);
	} catch {
		/* 广播失败不影响主流程 */
	}
}

export function loadProgress(cwd: string, jobId: string): ForgeProgress | null {
	const p = join(jobDir(cwd, jobId), "progress.json");
	if (!existsSync(p)) return null;
	return readJsonFile(p) as ForgeProgress;
}

export function setStage(
	cwd: string,
	jobId: string,
	stage: ForgeStage,
	patch: Partial<ForgeProgress> = {},
): void {
	const prev = loadProgress(cwd, jobId);
	const progress: ForgeProgress = {
		stage,
		percent: patch.percent ?? prev?.percent ?? 0,
		message: patch.message ?? prev?.message ?? stage,
		chunkTotal: patch.chunkTotal ?? prev?.chunkTotal ?? 0,
		chunkDone: patch.chunkDone ?? prev?.chunkDone ?? 0,
		error: patch.error,
		errorClass: patch.errorClass ?? (patch.error ? prev?.errorClass : undefined),
		failedStage: patch.failedStage ?? (stage === "failed" ? prev?.failedStage : undefined),
		updatedAt: Date.now(),
	};
	if (stage !== "failed") {
		// 成功推进时清掉失败字段
		if (patch.error === undefined) progress.error = undefined;
		if (patch.errorClass === undefined) progress.errorClass = undefined;
		if (patch.failedStage === undefined) progress.failedStage = undefined;
	}
	writeProgress(cwd, jobId, progress);
	const job = loadJob(cwd, jobId);
	if (job) {
		job.stage = stage;
		saveJob(cwd, job);
	}
}

export function selectionPath(cwd: string, jobId: string): string {
	return join(jobDir(cwd, jobId), "cast", "selection.json");
}

export function saveCastSelection(cwd: string, jobId: string, sel: CastSelection): void {
	const protagonist = (sel.protagonist || "").trim();
	const selected = Array.from(
		new Set(
			(sel.selected ?? [])
				.map((s) => String(s).trim())
				.filter(Boolean),
		),
	);
	if (protagonist && !selected.includes(protagonist)) selected.unshift(protagonist);
	const renames: Record<string, string> = {};
	if (sel.renames && typeof sel.renames === "object") {
		for (const [k, v] of Object.entries(sel.renames)) {
			const key = k.trim();
			const val = typeof v === "string" ? v.trim() : "";
			if (key && val && key !== val) renames[key] = val;
		}
	}
	const manual = Array.from(
		new Set(
			(sel.manual ?? [])
				.map((s) => String(s).trim())
				.filter(Boolean),
		),
	);
	const out: CastSelection = { protagonist, selected, renames, manual };
	writeJson(selectionPath(cwd, jobId), out);
}

export function loadCastSelection(cwd: string, jobId: string): CastSelection | null {
	const p = selectionPath(cwd, jobId);
	if (!existsSync(p)) return null;
	const data = readJsonSafe<Partial<CastSelection>>(p, {});
	const protagonist = typeof data.protagonist === "string" ? data.protagonist.trim() : "";
	const selected = Array.isArray(data.selected)
		? data.selected.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean)
		: [];
	const renames: Record<string, string> = {};
	if (data.renames && typeof data.renames === "object") {
		for (const [k, v] of Object.entries(data.renames)) {
			if (typeof v === "string" && k.trim() && v.trim()) renames[k.trim()] = v.trim();
		}
	}
	const manual = Array.isArray(data.manual)
		? data.manual.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean)
		: [];
	return { protagonist, selected, renames, manual };
}

export function defaultCastSelection(cast: CastMention[], protagonist?: string): CastSelection {
	const names = cast.map((c) => c.name).filter(Boolean);
	const pro = (protagonist || names[0] || "").trim();
	const selected = names.slice(0, Math.max(1, Math.min(8, names.length || 1)));
	if (pro && !selected.includes(pro)) selected.unshift(pro);
	return { protagonist: pro, selected: Array.from(new Set(selected)), renames: {}, manual: [] };
}

/** 可编辑草稿全量（主卡 + 配角 + 世界书） */
export interface ElevateDraftFull {
	card: CharacterCard | null;
	lore: LoreDraftEntry[];
	extraCards: CharacterCard[];
}

export function loadElevateDraftFull(cwd: string, jobId: string): ElevateDraftFull {
	const cardP = join(jobDir(cwd, jobId), "elevate", "card.json");
	const loreP = join(jobDir(cwd, jobId), "elevate", "lorebook.json");
	const card = existsSync(cardP) ? (readJsonFile(cardP) as CharacterCard) : null;
	const lore = existsSync(loreP)
		? ((readJsonFile(loreP) as { entries?: LoreDraftEntry[] }).entries ?? [])
		: [];
	const extraCards = loadExtraCards(cwd, jobId);
	return { card, lore: Array.isArray(lore) ? lore : [], extraCards };
}

export function saveElevateDraftFull(
	cwd: string,
	jobId: string,
	draft: { card?: CharacterCard; lore?: LoreDraftEntry[]; extraCards?: CharacterCard[] },
): ElevateDraftFull {
	ensureJobDirs(cwd, jobId);
	if (draft.card) {
		writeJson(join(jobDir(cwd, jobId), "elevate", "card.json"), draft.card);
	}
	if (Array.isArray(draft.lore)) {
		writeJson(join(jobDir(cwd, jobId), "elevate", "lorebook.json"), { entries: draft.lore });
	}
	if (Array.isArray(draft.extraCards)) {
		saveExtraCards(cwd, jobId, draft.extraCards);
	}
	return loadElevateDraftFull(cwd, jobId);
}

export function listJobs(cwd: string): ForgeJobMeta[] {
	const root = forgeRoot(cwd);
	if (!existsSync(root)) return [];
	const ids = readdirSync(root, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name);
	const jobs: ForgeJobMeta[] = [];
	for (const id of ids) {
		const j = loadJob(cwd, id);
		if (j) jobs.push(j);
	}
	jobs.sort((a, b) => b.createdAt - a.createdAt);
	return jobs;
}

export function saveMapping(cwd: string, jobId: string, chunks: ForgeChunkMeta[]): void {
	writeJson(join(jobDir(cwd, jobId), "mapping.json"), { chunks });
}

export function loadMapping(cwd: string, jobId: string): ForgeChunkMeta[] {
	const data = readJsonSafe<{ chunks?: ForgeChunkMeta[] }>(join(jobDir(cwd, jobId), "mapping.json"), {});
	return Array.isArray(data.chunks) ? data.chunks : [];
}

export function writeChunkText(cwd: string, jobId: string, id: string, text: string): void {
	writeFileSync(join(jobDir(cwd, jobId), "chunks", `${id}.txt`), text, "utf8");
}

export function readChunkText(cwd: string, jobId: string, id: string): string {
	return readFileSync(join(jobDir(cwd, jobId), "chunks", `${id}.txt`), "utf8");
}

export function castPath(cwd: string, jobId: string, chunkId: string): string {
	return join(jobDir(cwd, jobId), "cast", `${chunkId}.json`);
}

export function lorePath(cwd: string, jobId: string, chunkId: string): string {
	return join(jobDir(cwd, jobId), "lore", `${chunkId}.json`);
}

export function hasChunkExtract(cwd: string, jobId: string, chunkId: string): boolean {
	return existsSync(castPath(cwd, jobId, chunkId));
}

export function saveMergedCast(cwd: string, jobId: string, cast: CastMention[]): void {
	writeJson(join(jobDir(cwd, jobId), "cast", "merged.json"), { characters: cast });
}

export function loadMergedCast(cwd: string, jobId: string): CastMention[] {
	const data = readJsonSafe<{ characters?: CastMention[] }>(
		join(jobDir(cwd, jobId), "cast", "merged.json"),
		{},
	);
	return Array.isArray(data.characters) ? data.characters : [];
}

export function saveMergedLore(cwd: string, jobId: string, lore: LoreDraftEntry[]): void {
	writeJson(join(jobDir(cwd, jobId), "lore", "merged.json"), { entries: lore });
}

export function loadMergedLore(cwd: string, jobId: string): LoreDraftEntry[] {
	const data = readJsonSafe<{ entries?: LoreDraftEntry[] }>(
		join(jobDir(cwd, jobId), "lore", "merged.json"),
		{},
	);
	return Array.isArray(data.entries) ? data.entries : [];
}

export function appendError(cwd: string, jobId: string, line: string): void {
	const p = join(jobDir(cwd, jobId), "errors.jsonl");
	writeFileSync(p, `${JSON.stringify({ t: Date.now(), line })}\n`, { flag: "a" });
}

export function readSource(cwd: string, jobId: string): string {
	return readFileSync(join(jobDir(cwd, jobId), "source.txt"), "utf8");
}

export function deleteJob(cwd: string, jobId: string): boolean {
	const dir = jobDir(cwd, jobId);
	if (!existsSync(dir)) return false;
	// 安全：仅允许删除 .drawdream-forge 下单层 job 目录
	const id = jobId.replace(/[/\\]/g, "");
	if (!id || id !== jobId || id.includes("..")) throw new Error("非法任务 id");
	rmSync(dir, { recursive: true, force: true });
	return true;
}

export function saveTimeline(cwd: string, jobId: string, events: TimelineEvent[]): void {
	writeJson(join(jobDir(cwd, jobId), "elevate", "timeline.json"), { events });
}

export function loadTimeline(cwd: string, jobId: string): TimelineEvent[] {
	const data = readJsonSafe<{ events?: TimelineEvent[] }>(
		join(jobDir(cwd, jobId), "elevate", "timeline.json"),
		{},
	);
	return Array.isArray(data.events) ? data.events : [];
}

export function saveExtraCards(
	cwd: string,
	jobId: string,
	cards: import("../types.ts").CharacterCard[],
): void {
	writeJson(join(jobDir(cwd, jobId), "elevate", "extra-cards.json"), { cards });
}

export function loadExtraCards(cwd: string, jobId: string): import("../types.ts").CharacterCard[] {
	const data = readJsonSafe<{ cards?: import("../types.ts").CharacterCard[] }>(
		join(jobDir(cwd, jobId), "elevate", "extra-cards.json"),
		{},
	);
	return Array.isArray(data.cards) ? data.cards : [];
}

export function outlinePath(cwd: string, jobId: string): string {
	return join(jobDir(cwd, jobId), "outline.json");
}

export function saveOutline(cwd: string, jobId: string, outline: OutlineDraft): void {
	const out: OutlineDraft = {
		...outline,
		updatedAt: Date.now(),
	};
	writeJson(outlinePath(cwd, jobId), out);
}

export function loadOutline(cwd: string, jobId: string): OutlineDraft | null {
	const p = outlinePath(cwd, jobId);
	if (!existsSync(p)) return null;
	const data = readJsonSafe<Partial<OutlineDraft>>(p, {});
	if (!Array.isArray(data.chapters) || data.chapters.length === 0) return null;
	return {
		blurb: typeof data.blurb === "string" ? data.blurb : undefined,
		themes: Array.isArray(data.themes) ? data.themes.filter((x): x is string => typeof x === "string") : [],
		conflicts: Array.isArray(data.conflicts)
			? data.conflicts.filter((x): x is string => typeof x === "string")
			: [],
		chapters: data.chapters as OutlineDraft["chapters"],
		source: data.source === "user" ? "user" : "auto",
		updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : undefined,
	};
}

/** 将当前 elevate 草稿快照为 vN，返回版本号 */
export function snapshotElevateVersion(cwd: string, jobId: string): number {
	const elevDir = join(jobDir(cwd, jobId), "elevate");
	mkdirSync(elevDir, { recursive: true });
	let max = 0;
	try {
		for (const name of readdirSync(elevDir)) {
			const m = /^v(\d+)\.json$/.exec(name);
			if (m) max = Math.max(max, Number(m[1]));
		}
	} catch {
		/* ignore */
	}
	const next = max + 1;
	const full = loadElevateDraftFull(cwd, jobId);
	writeJson(join(elevDir, `v${next}.json`), {
		version: next,
		savedAt: Date.now(),
		card: full.card,
		lore: full.lore,
		extraCards: full.extraCards,
	});
	return next;
}

export interface ElevateVersionMeta {
	version: number;
	savedAt: number;
	cardName?: string;
	loreCount: number;
	extraCount: number;
}

export function listElevateVersions(cwd: string, jobId: string): ElevateVersionMeta[] {
	const elevDir = join(jobDir(cwd, jobId), "elevate");
	if (!existsSync(elevDir)) return [];
	const out: ElevateVersionMeta[] = [];
	for (const name of readdirSync(elevDir)) {
		const m = /^v(\d+)\.json$/.exec(name);
		if (!m) continue;
		const version = Number(m[1]);
		const data = readJsonSafe<{
			version?: number;
			savedAt?: number;
			card?: { name?: string };
			lore?: unknown[];
			extraCards?: unknown[];
		}>(join(elevDir, name), {});
		out.push({
			version,
			savedAt: typeof data.savedAt === "number" ? data.savedAt : 0,
			cardName: typeof data.card?.name === "string" ? data.card.name : undefined,
			loreCount: Array.isArray(data.lore) ? data.lore.length : 0,
			extraCount: Array.isArray(data.extraCards) ? data.extraCards.length : 0,
		});
	}
	out.sort((a, b) => b.version - a.version);
	return out;
}

/** 将 vN 写回当前 elevate 草稿，并可选再快照当前为新版本 */
export function restoreElevateVersion(
	cwd: string,
	jobId: string,
	version: number,
	opts?: { snapshotCurrent?: boolean },
): ElevateDraftFull {
	const p = join(jobDir(cwd, jobId), "elevate", `v${version}.json`);
	if (!existsSync(p)) throw new Error(`版本 v${version} 不存在`);
	if (opts?.snapshotCurrent !== false) {
		const cur = loadElevateDraftFull(cwd, jobId);
		if (cur.card) snapshotElevateVersion(cwd, jobId);
	}
	const data = readJsonFile(p) as {
		card?: CharacterCard;
		lore?: LoreDraftEntry[];
		extraCards?: CharacterCard[];
	};
	if (!data.card) throw new Error(`版本 v${version} 缺少角色卡`);
	return saveElevateDraftFull(cwd, jobId, {
		card: data.card,
		lore: Array.isArray(data.lore) ? data.lore : [],
		extraCards: Array.isArray(data.extraCards) ? data.extraCards : [],
	});
}

/** 导出素材包（大纲 + cast + 草稿） */
export function buildExportPack(cwd: string, jobId: string): Record<string, unknown> {
	const job = loadJob(cwd, jobId);
	if (!job) throw new Error("任务不存在");
	const full = loadElevateDraftFull(cwd, jobId);
	const cast = loadMergedCast(cwd, jobId);
	const outline = loadOutline(cwd, jobId);
	const selection = loadCastSelection(cwd, jobId);
	const timeline = loadTimeline(cwd, jobId);
	return {
		format: "drawdream-forge-pack",
		version: 1,
		exportedAt: Date.now(),
		job: {
			id: job.id,
			title: job.options.title,
			mode: job.options.mode,
			sourceName: job.sourceName,
			sourceChars: job.sourceChars,
			stage: job.stage,
			protagonist: job.options.protagonist,
		},
		selection,
		outline,
		cast: cast.slice(0, 80),
		draft: {
			card: full.card,
			lore: full.lore,
			extraCards: full.extraCards,
		},
		timeline,
		versions: listElevateVersions(cwd, jobId),
	};
}
