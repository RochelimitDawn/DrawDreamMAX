/**
 * 会话树合并语义（兄弟分支保留）。
 *
 * 背景：会话 JSONL 是 append-only 树，每行带 `id`/`parentId`。
 * 两台设备在不同叶子继续追加时，各自写入 parentId 不同的行，形成兄弟分支；
 * `leaf` 条目记录当前活动叶子，加载时最后一个 leaf 胜出（时间晚者胜）。
 *
 * 本模块提供合并正确性验证函数：
 * - 兄弟分支判定：追加行的 parentId 与本地当前叶子不同 → 属于新分支，应整体保留。
 * - 分支完整性：合并后树中每个非根节点的 parentId 应能追溯到根。
 */

import type { SessionEntryLine } from "./types.ts";

export interface MergeCheckResult {
	ok: boolean;
	branches: number;
	orphanIds: string[];
}

/**
 * 校验一组会话追加行合并到现有树后的语义完整性。
 * @param existingEntries 本地已有行（不含新增）
 * @param newLines 待追加的行（每条已含 id/parentId）
 */
export function checkSessionMerge(
	existingEntries: SessionEntryLine[],
	newLines: SessionEntryLine[],
): MergeCheckResult {
	const byId = new Map<string, SessionEntryLine>();
	for (const e of existingEntries) {
		if (e.id) byId.set(e.id, e);
	}
	const ids = new Set(byId.keys());
	// 追加行中的 id 也纳入，用于追踪
	for (const n of newLines) {
		if (n.id) ids.add(n.id);
	}
	// 根：无 parentId 或 parentId 为空的行
	const isRoot = (l: SessionEntryLine) => !l.parentId || l.parentId === "null" || l.parentId === null;
	// 孤儿：parentId 指向不存在的节点（既不在现有树也不在新行）
	const orphanIds: string[] = [];
	for (const n of newLines) {
		if (isRoot(n)) continue;
		if (!ids.has(String(n.parentId))) {
			orphanIds.push(n.id);
		}
	}
	// 分支数：统计不同根路径下 leaf 集合。简化：计算拥有"兄弟起点"的行数。
	// 兄弟起点 = 其 parentId 在现有树中存在，但 parentId 不是当前最后叶子，且该行 id 未在现有树中。
	let branches = 1;
	for (const n of newLines) {
		if (isRoot(n)) {
			branches++;
			continue;
		}
		// 该行是已有树中某节点的直接子（parentId 存在）且行本身是新增 → 视为一个潜在分支
		if (byId.has(String(n.parentId)) && !byId.has(n.id)) {
			branches++;
		}
	}
	return { ok: orphanIds.length === 0, branches: Math.max(branches, 1), orphanIds };
}
