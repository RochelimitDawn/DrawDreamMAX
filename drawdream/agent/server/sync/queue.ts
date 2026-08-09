/**
 * 本地持久化待同步队列（outbox）：上行失败时的可靠重放。
 * 存储于 .drawdream-sync/outbox/<seq>.json，按写入顺序重放，成功后删除。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ChangeBatch } from "./types.ts";

export class PendingQueue {
	private readonly dir: string;

	constructor(workspaceCwd: string) {
		this.dir = join(workspaceCwd, ".drawdream-sync", "outbox");
	}

	private ensure(): void {
		mkdirSync(this.dir, { recursive: true, mode: 0o700 });
	}

	enqueue(batch: ChangeBatch): void {
		this.ensure();
		const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.json`;
		writeFileSync(join(this.dir, name), JSON.stringify(batch), { mode: 0o600 });
	}

	/** 返回所有待重放批次（按文件名即时间顺序）。 */
	peek(): ChangeBatch[] {
		if (!existsSync(this.dir)) return [];
		const names = readdirSync(this.dir).filter((n) => n.endsWith(".json")).sort();
		const out: ChangeBatch[] = [];
		for (const n of names) {
			try {
				out.push(JSON.parse(readFileSync(join(this.dir, n), "utf8")) as ChangeBatch);
			} catch {
				// 损坏条目跳过并删除
				try {
					rmSync(join(this.dir, n));
				} catch {
					/* ignore */
				}
			}
		}
		return out;
	}

	/** 删除一条已成功重放的批次。 */
	ack(batch: ChangeBatch): void {
		if (!existsSync(this.dir)) return;
		const names = readdirSync(this.dir).filter((n) => n.endsWith(".json"));
		for (const n of names) {
			try {
				const b = JSON.parse(readFileSync(join(this.dir, n), "utf8")) as ChangeBatch;
				if (
					b.entityType === batch.entityType &&
					b.entityId === batch.entityId &&
					JSON.stringify(b.payload) === JSON.stringify(batch.payload)
				) {
					rmSync(join(this.dir, n));
					return;
				}
			} catch {
				/* ignore */
			}
		}
	}

	get count(): number {
		if (!existsSync(this.dir)) return 0;
		return readdirSync(this.dir).filter((n) => n.endsWith(".json")).length;
	}
}
