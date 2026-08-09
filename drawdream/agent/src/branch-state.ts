/** 按会话树分支保存和恢复世界状态快照。 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readJsonFile } from "./jsonio.ts";
import type { WorldState } from "./types.ts";

export interface BranchStateSnapshot {
	entryId: string | null;
	state: WorldState;
	updatedAt: number;
}

export interface BranchStateIndex {
	snapshots: BranchStateSnapshot[];
}

export function emptyBranchStateIndex(): BranchStateIndex {
	return { snapshots: [] };
}

export function loadBranchStateIndex(file: string): BranchStateIndex {
	try {
		const raw = readJsonFile(file) as Partial<BranchStateIndex>;
		const snapshots = Array.isArray(raw.snapshots)
			? raw.snapshots.filter((item): item is BranchStateSnapshot => {
					if (!item || typeof item !== "object") return false;
					const value = item as Partial<BranchStateSnapshot>;
					return (typeof value.entryId === "string" || value.entryId === null) && !!value.state && typeof value.updatedAt === "number";
				})
			: [];
		return { snapshots };
	} catch {
		return emptyBranchStateIndex();
	}
}

export function saveBranchStateIndex(file: string, index: BranchStateIndex): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(index, null, "\t")}\n`, "utf8");
}

export function recordBranchState(
	index: BranchStateIndex,
	entryId: string | null,
	state: WorldState,
	updatedAt = Date.now(),
): BranchStateIndex {
	const next = index.snapshots.filter((snapshot) => snapshot.entryId !== entryId);
	next.push({ entryId, state: structuredClone(state), updatedAt });
	return { snapshots: next };
}

export function restoreBranchState(
	index: BranchStateIndex,
	branchEntryIds: Iterable<string>,
	 fallback: WorldState,
): WorldState {
	const ids = new Set(branchEntryIds);
	const candidates = index.snapshots
		.filter((snapshot) => snapshot.entryId === null || ids.has(snapshot.entryId))
		.sort((a, b) => b.updatedAt - a.updatedAt);
	const selected = candidates[0];
	return selected ? structuredClone(selected.state) : structuredClone(fallback);
}
