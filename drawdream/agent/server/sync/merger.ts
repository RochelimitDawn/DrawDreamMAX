/**
 * 字段级合并器（field-level merge）。
 *
 * 三方语义（base + local + remote），按 key 存在性 + 值变化判定：
 * - 双方均未修改（值与 base 一致）→ 保留 base 值。
 * - 仅 local 修改 / 仅 local 存在该键 → 取 local。
 * - 仅 remote 修改 / 仅 remote 存在该键 → 取 remote。
 * - 双方修改且值不同：
 *   - 嵌套对象 → 递归合并。
 *   - 标量/数组 → 更新时间晚者胜，生成 MergeConflict。
 * - 双方修改为相同值 → 取该值。
 * - 一方有键另一方无键：
 *   - base 也无该键 → 视为"新增字段"，取有键方（不冲突）。
 *   - base 有该键 → 有键方修改了值、无键方删除了键 → 视为冲突，晚者胜。
 */

import type { MergeConflict, MergeInput, MergeResult } from "./types.ts";

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const changed = (a: unknown, b: unknown): boolean => JSON.stringify(a) !== JSON.stringify(b);

export function fieldMerge(input: MergeInput): MergeResult {
	const conflicts: MergeConflict[] = [];
	const base = input.base ?? ({} as Record<string, unknown>);
	const merged = mergeNode(
		base,
		input.local,
		input.remote,
		input.entityType,
		input.entityId,
		input.localTs,
		input.remoteTs,
		conflicts,
		"",
	);
	return { merged, conflicts };
}

function mergeNode(
	base: Record<string, unknown>,
	local: Record<string, unknown>,
	remote: Record<string, unknown>,
	entityType: MergeConflict["entityType"],
	entityId: string,
	localTs: number,
	remoteTs: number,
	conflicts: MergeConflict[],
	path: string,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
	for (const key of keys) {
		const baseValue = base[key];
		const localValue = local[key];
		const remoteValue = remote[key];
		const localHas = key in local;
		const remoteHas = key in remote;
		const baseHas = key in base;
		const childPath = path ? `${path}.${key}` : key;
		// 相对 base 的变化标记（base 无键时视为无基准）
		const localChanged = !baseHas || changed(localValue, baseValue);
		const remoteChanged = !baseHas || changed(remoteValue, baseValue);

		// 键存在性情况
		if (localHas && !remoteHas) {
			// 仅 local 有该键
			if (!baseHas) {
				// 双方均为新增但仅 local 有 → 保留 local
				out[key] = localValue;
			} else if (!changed(localValue, baseValue)) {
				// local 未改、remote 删除了键 → remote 删，取 base（视为 remote 删除胜）
				out[key] = baseValue;
			} else {
				// local 改了值、remote 删了键 → 冲突，晚者胜
				const winner = remoteTs >= localTs ? undefined : localValue;
				if (winner === undefined) delete out[key];
				else out[key] = winner;
				conflicts.push({
					entityType, entityId, fieldPath: childPath,
					localValue, remoteValue: undefined,
					localTs, remoteTs, resolved: false,
				});
			}
		} else if (!localHas && remoteHas) {
			if (!baseHas) {
				out[key] = remoteValue;
			} else if (!changed(remoteValue, baseValue)) {
				out[key] = baseValue;
			} else {
				const winner = localTs >= remoteTs ? undefined : remoteValue;
				if (winner === undefined) delete out[key];
				else out[key] = winner;
				conflicts.push({
					entityType, entityId, fieldPath: childPath,
					localValue: undefined, remoteValue,
					localTs, remoteTs, resolved: false,
				});
			}
		} else if (!localHas && !remoteHas) {
			out[key] = baseValue;
		} else if (!localChanged && !remoteChanged) {
			out[key] = baseValue;
		} else if (localChanged && !remoteChanged) {
			out[key] = localValue;
		} else if (!localChanged && remoteChanged) {
			out[key] = remoteValue;
		} else if (isPlainObject(localValue) && isPlainObject(remoteValue) && isPlainObject(baseValue)) {
			out[key] = mergeNode(
				baseValue, localValue, remoteValue,
				entityType, entityId, localTs, remoteTs, conflicts, childPath,
			);
		} else if (!changed(localValue, remoteValue)) {
			out[key] = localValue;
		} else {
			const winner = remoteTs >= localTs ? remoteValue : localValue;
			out[key] = winner;
			conflicts.push({
				entityType, entityId, fieldPath: childPath,
				localValue, remoteValue,
				localTs, remoteTs, resolved: false,
			});
		}
	}
	return out;
}
