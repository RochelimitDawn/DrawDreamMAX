/**
 * 小说分块：优先按章节标题切分，否则按字数窗口 + 重叠。
 */

import type { ForgeChunkMeta, ForgeMode } from "./types.ts";

const CHAPTER_RE =
	/^(?:第[零〇一二三四五六七八九十百千两\d]+[章节回卷部集]|Chapter\s+\d+|CHAPTER\s+\d+|[卷部][零〇一二三四五六七八九十百千两\d]+).{0,40}$/gm;

export function stripBomText(s: string): string {
	return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function cleanNovelText(raw: string): string {
	let t = stripBomText(raw).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	// 压缩过多空行
	t = t.replace(/\n{4,}/g, "\n\n\n");
	return t.trim();
}

export interface ChunkPiece {
	meta: ForgeChunkMeta;
	text: string;
}

function previewOf(text: string, n = 80): string {
	const one = text.replace(/\s+/g, " ").trim();
	return one.length <= n ? one : `${one.slice(0, n)}…`;
}

function splitByChapters(text: string): { title?: string; body: string }[] {
	const matches = [...text.matchAll(CHAPTER_RE)];
	if (matches.length < 3) return [{ body: text }];
	const parts: { title?: string; body: string }[] = [];
	// 前言
	const first = matches[0].index ?? 0;
	if (first > 80) {
		parts.push({ body: text.slice(0, first).trim() });
	}
	for (let i = 0; i < matches.length; i++) {
		const start = matches[i].index ?? 0;
		const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
		const title = matches[i][0].trim();
		const body = text.slice(start, end).trim();
		if (body.length > 20) parts.push({ title, body });
	}
	return parts.length ? parts : [{ body: text }];
}

function windowSplit(body: string, maxChars: number, overlap: number): string[] {
	if (body.length <= maxChars) return [body];
	const out: string[] = [];
	let i = 0;
	const step = Math.max(200, maxChars - overlap);
	while (i < body.length) {
		let end = Math.min(body.length, i + maxChars);
		// 尽量在段落边界断开
		if (end < body.length) {
			const slice = body.slice(i, end);
			const para = slice.lastIndexOf("\n\n");
			const nl = slice.lastIndexOf("\n");
			const cut = para > maxChars * 0.4 ? para : nl > maxChars * 0.5 ? nl : -1;
			if (cut > 0) end = i + cut;
		}
		const piece = body.slice(i, end).trim();
		if (piece) out.push(piece);
		if (end >= body.length) break;
		i = Math.max(i + 1, end - overlap);
	}
	return out;
}

export function chunkNovel(
	raw: string,
	opts: { chunkChars?: number; chunkOverlap?: number } = {},
): ChunkPiece[] {
	const maxChars = opts.chunkChars ?? 3500;
	const overlap = opts.chunkOverlap ?? 200;
	const text = cleanNovelText(raw);
	if (!text) return [];
	const sections = splitByChapters(text);
	const pieces: ChunkPiece[] = [];
	let index = 0;
	for (const sec of sections) {
		const windows = windowSplit(sec.body, maxChars, overlap);
		for (const w of windows) {
			const id = `chunk_${String(index).padStart(4, "0")}`;
			pieces.push({
				meta: {
					id,
					index,
					chars: w.length,
					preview: previewOf(w),
					title: sec.title,
				},
				text: w,
			});
			index += 1;
		}
	}
	return pieces;
}

/**
 * 按模式选择参与 Map 的 chunk 下标：quick 均匀采样，standard/deep 全量。
 */
export function selectChunkIndices(
	total: number,
	mode: ForgeMode,
	sampleChunks = 24,
): number[] {
	if (total <= 0) return [];
	if (mode !== "quick" || total <= sampleChunks) {
		return Array.from({ length: total }, (_, i) => i);
	}
	const n = Math.min(sampleChunks, total);
	if (n === 1) return [0];
	const out: number[] = [];
	for (let i = 0; i < n; i++) {
		out.push(Math.min(total - 1, Math.round((i * (total - 1)) / (n - 1))));
	}
	return [...new Set(out)].sort((a, b) => a - b);
}
