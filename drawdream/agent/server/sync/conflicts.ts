/**
 * 冲突记录持久化：.drawdream-sync/conflicts/<entityType>--<hash>.json
 * 合并产生的 MergeConflict 在此登记；用户解决后写回云端作为新版本。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import type { MergeConflict } from "./types.ts";

export class ConflictStore {
	private readonly dir: string;

	constructor(workspaceCwd: string) {
		this.dir = join(workspaceCwd, ".drawdream-sync", "conflicts");
	}

	private ensure(): void {
		mkdirSync(this.dir, { recursive: true, mode: 0o700 });
	}

	private fileName(c: MergeConflict): string {
		const hash = createHash("sha1").update(`${c.entityType}|${c.entityId}|${c.fieldPath}`).digest("hex").slice(0, 16);
		return `${c.entityType}--${hash}.json`;
	}

	/** 登记或更新一条冲突（同 entity+fieldPath 去重）。 */
	upsert(c: MergeConflict): void {
		this.ensure();
		writeFileSync(join(this.dir, this.fileName(c)), JSON.stringify(c, null, 2), { mode: 0o600 });
	}

	/** 全部未解决冲突。 */
	list(): MergeConflict[] {
		if (!existsSync(this.dir)) return [];
		const out: MergeConflict[] = [];
		for (const name of readdirSync(this.dir).filter((n) => n.endsWith(".json"))) {
			try {
				out.push(JSON.parse(readFileSync(join(this.dir, name), "utf8")) as MergeConflict);
			} catch {
				/* ignore */
			}
		}
		return out.filter((c) => !c.resolved);
	}

	/** 按 entityType+entityId 查找冲突（供合并器写入前查重）。 */
	findByEntity(entityType: string, entityId: string): MergeConflict[] {
		return this.list().filter((c) => c.entityType === entityType && c.entityId === entityId);
	}

	/** 标记冲突为已解决（用户选择的结果值）。 */
	resolve(c: MergeConflict, resolvedValue: unknown): void {
		this.ensure();
		const updated: MergeConflict = { ...c, resolved: true, resolvedValue };
		writeFileSync(join(this.dir, this.fileName(c)), JSON.stringify(updated, null, 2), { mode: 0o600 });
	}

	get count(): number {
		return this.list().length;
	}
}
