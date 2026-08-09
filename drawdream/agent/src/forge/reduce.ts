/**
 * Reduce：合并分块角色与设定，别名归一、频次排序、条目去重。
 */

import type { CastMention, LoreDraftEntry } from "./types.ts";

function normName(s: string): string {
	return s.replace(/\s+/g, "").toLowerCase();
}

/** 判断 a 是否可作为 b 的别名/子串名 */
function nameRelated(a: string, b: string): boolean {
	const x = normName(a);
	const y = normName(b);
	if (!x || !y) return false;
	if (x === y) return true;
	if (x.length >= 2 && y.includes(x)) return true;
	if (y.length >= 2 && x.includes(y)) return true;
	return false;
}

export function mergeCast(lists: CastMention[][]): CastMention[] {
	const groups: CastMention[] = [];
	for (const list of lists) {
		for (const m of list) {
			const names = [m.name, ...m.aliases].filter(Boolean);
			let hit = groups.find((g) =>
				[g.name, ...g.aliases].some((gn) => names.some((n) => nameRelated(gn, n))),
			);
			if (!hit) {
				groups.push({
					name: m.name,
					aliases: [...m.aliases],
					roleHint: m.roleHint,
					traits: [...m.traits],
					count: m.count,
					chunks: [...m.chunks],
				});
				continue;
			}
			// 选更长/更规范的主名
			if (m.name.length > hit.name.length) {
				if (!hit.aliases.includes(hit.name)) hit.aliases.push(hit.name);
				hit.name = m.name;
			}
			for (const a of names) {
				if (normName(a) === normName(hit.name)) continue;
				if (!hit.aliases.some((x) => normName(x) === normName(a))) hit.aliases.push(a);
			}
			hit.count += m.count;
			for (const c of m.chunks) {
				if (!hit.chunks.includes(c)) hit.chunks.push(c);
			}
			for (const t of m.traits) {
				if (!hit.traits.includes(t)) hit.traits.push(t);
			}
			if (!hit.roleHint && m.roleHint) hit.roleHint = m.roleHint;
			else if (m.roleHint.includes("主") && !hit.roleHint.includes("主")) hit.roleHint = m.roleHint;
		}
	}
	for (const g of groups) {
		g.chunks.sort((a, b) => a - b);
		g.aliases = g.aliases.filter((a) => normName(a) !== normName(g.name)).slice(0, 12);
		g.traits = g.traits.slice(0, 16);
	}
	// 跨度 + 频次
	groups.sort((a, b) => {
		const spanA = a.chunks.length;
		const spanB = b.chunks.length;
		if (spanB !== spanA) return spanB - spanA;
		return b.count - a.count;
	});
	return groups;
}

export function mergeLore(lists: LoreDraftEntry[][]): LoreDraftEntry[] {
	const out: LoreDraftEntry[] = [];
	const seen = new Set<string>();
	for (const list of lists) {
		for (const e of list) {
			const key = `${e.title.trim()}|${e.content.trim().slice(0, 80)}`;
			const fp = key.replace(/\s+/g, "");
			if (seen.has(fp)) continue;
			// 标题近似去重
			const titleN = normName(e.title);
			if (out.some((x) => normName(x.title) === titleN && x.content.slice(0, 40) === e.content.slice(0, 40))) {
				continue;
			}
			seen.add(fp);
			out.push({
				title: e.title.trim(),
				keys: [...new Set(e.keys.map((k) => k.trim()).filter(Boolean))].slice(0, 12),
				content: e.content.trim(),
				constant: e.constant === true,
				order: e.constant ? Math.min(e.order, 50) : e.order,
			});
		}
	}
	out.sort((a, b) => {
		if (a.constant !== b.constant) return a.constant ? -1 : 1;
		return a.order - b.order;
	});
	return out.slice(0, 80);
}

export function pickDefaultProtagonist(cast: CastMention[]): string {
	if (!cast.length) return "主角";
	const main = cast.find((c) => /主|protagonist|mc/i.test(c.roleHint));
	return (main ?? cast[0]).name;
}
