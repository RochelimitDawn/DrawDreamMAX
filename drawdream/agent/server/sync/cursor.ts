/**
 * 本地同步游标：.drawdream-sync/cursor.json
 * 游标只增不减（lastSeq 单调），断电/重启后从持久化状态恢复。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class SyncCursor {
	private readonly path: string;
	private value = 0;

	constructor(workspaceCwd: string) {
		this.path = join(workspaceCwd, ".drawdream-sync", "cursor.json");
		this.value = this.load();
	}

	private load(): number {
		if (existsSync(this.path)) {
			try {
				const raw = JSON.parse(readFileSync(this.path, "utf8")) as { lastSeq?: number };
				if (typeof raw.lastSeq === "number" && Number.isFinite(raw.lastSeq) && raw.lastSeq >= 0) {
					return Math.floor(raw.lastSeq);
				}
			} catch {
				// 损坏游标归零，重新全量拉取（安全方向）
			}
		}
		return 0;
	}

	get lastSeq(): number {
		return this.value;
	}

	/** 单调推进游标并持久化。传入小于等于当前值的 seq 会被忽略。 */
	advance(seq: number): void {
		if (seq <= this.value) return;
		this.value = seq;
		const dir = this.path.replace(/cursor\.json$/, "");
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		const tmp = this.path + ".tmp";
		writeFileSync(tmp, JSON.stringify({ lastSeq: this.value }, null, 2), { mode: 0o600 });
		renameSync(tmp, this.path);
	}

	reset(): void {
		this.value = 0;
		const dir = this.path.replace(/cursor\.json$/, "");
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		writeFileSync(this.path, JSON.stringify({ lastSeq: 0 }, null, 2), { mode: 0o600 });
	}
}
