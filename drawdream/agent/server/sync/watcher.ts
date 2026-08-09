/**
 * 本地同步文件监听：识别会话 JSONL 追加行与版本类文件替换。
 *
 * 采用 fs.watch 触发 + 读取差异的混合策略：
 * - 增量类（会话 JSONL、palace JSONL、summary JSONL）：记录已读行数，追加时从文件尾部读新行。
 * - 版本类（config/card/preset/persona/lorebook/state/artifacts 等 JSON）：整体读文件并算 sha256，
 *   哈希变化即产生 replace 变更。
 *
 * fs.watch 在部分平台（Android WebView 内嵌 Node）事件可能丢失，因此附带定期全量比对兜底。
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, watch } from "node:fs";
import { join, relative, sep } from "node:path";

import type { ChangeBatch, ChangeKind, EntityType } from "./types.ts";

export interface WatchTarget {
	/** 目录绝对路径 */
	dir: string;
	/** 该目录下文件的实体类型 */
	entityType: EntityType;
	/** 该目录的文件是否按"追加"同步（true=JSONL 增量类，false=整体替换版本类） */
	appendOnly: boolean;
	/** 追加类文件扩展名（如 .jsonl）；版本类为 .json/.jsonl/.png 等 */
	extensions: string[];
}

export interface WatcherOptions {
	/** 去抖窗口，默认 300ms */
	debounceMs?: number;
	/** 兜底全量比对间隔，默认 10s；0 表示禁用 */
	sweepMs?: number;
}

interface FileState {
	kind: "append" | "replace";
	lineCount: number;
	hash: string;
	mtimeMs: number;
}

export class SyncFileWatcher {
	private readonly targets: WatchTarget[];
	private readonly debounceMs: number;
	private readonly sweepMs: number;
	private readonly state = new Map<string, FileState>();
	private timers = new Map<string, ReturnType<typeof setTimeout>>();
	private watchers: ReturnType<typeof watch>[] = [];
	private sweepTimer: ReturnType<typeof setInterval> | null = null;
	private stopped = false;
	private onChange: ((batch: ChangeBatch) => void) | null = null;

	constructor(targets: WatchTarget[], options: WatcherOptions = {}) {
		this.targets = targets;
		this.debounceMs = options.debounceMs ?? 300;
		this.sweepMs = options.sweepMs ?? 10_000;
	}

	watch(onChange: (batch: ChangeBatch) => void): void {
		this.onChange = onChange;
		// 初始快照：记录所有现存文件的当前状态
		for (const t of this.targets) {
			this.scanDir(t);
		}
		// fs.watch 逐目录监听
		for (const t of this.targets) {
			try {
				const w = watch(t.dir, { persistent: false }, (_event, name) => {
					if (this.stopped || !name) return;
					const p = join(t.dir, String(name));
					this.schedule(t, p);
				});
				this.watchers.push(w);
			} catch {
				// 目录不存在或权限不足：交给 sweep 兜底
			}
		}
		if (this.sweepMs > 0) {
			this.sweepTimer = setInterval(() => {
				if (this.stopped) return;
				for (const t of this.targets) this.scanDir(t);
			}, this.sweepMs);
		}
	}

	stop(): void {
		this.stopped = true;
		for (const w of this.watchers) {
			try {
				w.close();
			} catch {
				/* ignore */
			}
		}
		this.watchers = [];
		if (this.sweepTimer) clearInterval(this.sweepTimer);
		this.sweepTimer = null;
		for (const t of this.timers.values()) clearTimeout(t);
		this.timers.clear();
	}

	private schedule(t: WatchTarget, p: string): void {
		const key = `${t.entityType}:${p}`;
		const existing = this.timers.get(key);
		if (existing) clearTimeout(existing);
		this.timers.set(
			key,
			setTimeout(() => {
				this.timers.delete(key);
				this.scanFile(t, p);
			}, this.debounceMs),
		);
	}

	private fileKey(t: WatchTarget, p: string): string {
		return `${t.entityType}:${p}`;
	}

	private scanDir(t: WatchTarget): void {
		let names: string[];
		try {
			names = readdirSync(t.dir);
		} catch {
			return;
		}
		for (const name of names) {
			const p = join(t.dir, name);
			if (!this.matchesExtension(t, name)) continue;
			this.scanFile(t, p);
		}
	}

	private matchesExtension(t: WatchTarget, name: string): boolean {
		return t.extensions.some((ext) => name.endsWith(ext));
	}

	private scanFile(t: WatchTarget, p: string): void {
		let st: ReturnType<typeof statSync>;
		try {
			st = statSync(p);
		} catch {
			return;
		}
		if (!st.isFile()) return;
		const key = this.fileKey(t, p);
		const prev = this.state.get(key);
		const kind: ChangeKind = t.appendOnly ? "append" : "replace";
		if (kind === "append") {
			let lineCount = 0;
			let hash = "";
			try {
				const raw = readFileSync(p, "utf8");
				lineCount = countLines(raw);
				hash = createHash("sha256").update(raw).digest("hex");
			} catch {
				return;
			}
			if (!prev) {
				// 首次发现：初始快照，不产生变更
				this.state.set(key, { kind, lineCount, hash, mtimeMs: st.mtimeMs });
				return;
			}
			if (lineCount > prev.lineCount) {
				const newLines = readTailLines(p, prev.lineCount, lineCount);
				this.state.set(key, { kind, lineCount, hash, mtimeMs: st.mtimeMs });
				this.emit({
					entityType: t.entityType,
					entityId: this.entityId(t, p),
					kind: "append",
					payload: newLines,
					fromSeq: prev.lineCount,
					ts: Date.now(),
				});
			} else if (hash !== prev.hash) {
				// 行数没变但内容变了（理论上 append-only 不会发生；兜底降级为 replace）
				this.state.set(key, { kind, lineCount, hash, mtimeMs: st.mtimeMs });
				this.emit({
					entityType: t.entityType,
					entityId: this.entityId(t, p),
					kind: "replace",
					payload: readFileSync(p, "utf8"),
					ts: Date.now(),
				});
			}
		} else {
			let hash = "";
			let content = "";
			try {
				content = readFileSync(p, "utf8");
				hash = createHash("sha256").update(content).digest("hex");
			} catch {
				return;
			}
			if (!prev) {
				this.state.set(key, { kind, lineCount: 0, hash, mtimeMs: st.mtimeMs });
				return;
			}
			if (hash !== prev.hash) {
				this.state.set(key, { kind, lineCount: 0, hash, mtimeMs: st.mtimeMs });
				this.emit({
					entityType: t.entityType,
					entityId: this.entityId(t, p),
					kind: "replace",
					payload: parseJsonOrRaw(content),
					ts: Date.now(),
				});
			}
		}
	}

	private entityId(t: WatchTarget, p: string): string {
		// 相对 target 目录的相对路径作为 entity_id 的稳定标识
		const rel = relative(t.dir, p).split(sep).join("/");
		return `${t.entityType}:${rel}`;
	}

	private emit(batch: ChangeBatch): void {
		if (this.stopped) return;
		// 广播后由 engine 聚合去抖
		this.onChange?.(batch);
	}
}

function countLines(s: string): number {
	if (s.length === 0) return 0;
	let n = 0;
	for (let i = 0; i < s.length; i++) {
		if (s.charCodeAt(i) === 10) n++;
	}
	if (s.charCodeAt(s.length - 1) !== 10) n++;
	return n;
}

function readTailLines(p: string, fromLine: number, toLine: number): string[] {
	const raw = readFileSync(p, "utf8");
	const lines = raw.split("\n");
	// fromLine 是 1-based 行号；读 (fromLine..toLine] 行（不含已读的 fromLine）
	const out: string[] = [];
	for (let i = fromLine; i < toLine && i < lines.length; i++) {
		const line = lines[i].trim();
		if (line) out.push(line);
	}
	return out;
}

function parseJsonOrRaw(content: string): unknown {
	try {
		return JSON.parse(content);
	} catch {
		return content;
	}
}

/** 构建默认监听目标（会话目录 + workspace 同步相关目录）。 */
export function defaultTargets(workspaceCwd: string, sessionDir: string): WatchTarget[] {
	const targets: WatchTarget[] = [];
	const addDir = (dir: string, entityType: EntityType, appendOnly: boolean, extensions: string[]) => {
		if (!dir) return;
		targets.push({ dir, entityType, appendOnly, extensions });
	};
	// 会话：append-only JSONL
	addDir(sessionDir, "session", true, [".jsonl"]);
	// 记忆 palace：append-only JSONL
	addDir(join(workspaceCwd, ".drawdream-palace"), "palace", true, [".jsonl", ".json"]);
	// 摘要：append-only JSONL
	addDir(join(workspaceCwd, ".drawdream-summaries"), "summary", true, [".jsonl"]);
	// 版本类：workspace 根 JSON 配置文件
	const rootJsons = [".drawdream-state", ".drawdream-artifacts", ".drawdream-worldline", ".drawdream-lore"];
	for (const d of rootJsons) {
		addDir(join(workspaceCwd, d), mapDirToEntity(d), false, [".json", ".jsonl"]);
	}
	// assets：卡片/预设/世界书/人设
	addDir(join(workspaceCwd, "assets", "cards"), "card", false, [".json", ".png"]);
	addDir(join(workspaceCwd, "assets", "presets"), "preset", false, [".json"]);
	addDir(join(workspaceCwd, "assets", "lorebooks"), "lorebook", false, [".json"]);
	// 根配置文件（单文件）
	addDir(workspaceCwd, "config", false, [".drawdream-personas.json"]);
	// 媒体：仅元数据（V1 不传内容）
	addDir(join(workspaceCwd, ".drawdream-uploads"), "media", false, [".png", ".jpg", ".webp", ".gif", ".mp4", ".json"]);
	addDir(join(workspaceCwd, ".drawdream-media"), "media", false, [".png", ".jpg", ".webp", ".gif", ".mp4", ".json"]);
	addDir(join(workspaceCwd, ".drawdream-audio"), "media", false, [".mp3", ".wav", ".ogg", ".json"]);
	return targets;
}

function mapDirToEntity(dirName: string): EntityType {
	switch (dirName) {
		case ".drawdream-state":
			return "state";
		case ".drawdream-artifacts":
			return "artifacts";
		case ".drawdream-worldline":
			return "worldline";
		case ".drawdream-lore":
			return "lorebook";
		default:
			return "state";
	}
}

export function fileEntityId(entityType: EntityType, relPath: string): string {
	return `${entityType}:${relPath.split(sep).join("/")}`;
}
