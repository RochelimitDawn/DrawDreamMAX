/**
 * 反向大纲：分段摘要 → 合并 OutlineDraft
 */

import { extractJsonBlock, forgeChat, type ForgeLlmTarget } from "./llm.ts";
import type { OutlineChapter, OutlineDraft } from "./types.ts";

function asStringArray(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	return v
		.filter((x): x is string => typeof x === "string")
		.map((s) => s.trim())
		.filter(Boolean);
}

function normalizeOutline(raw: unknown): OutlineDraft {
	const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const chapters: OutlineChapter[] = [];
	const list = Array.isArray(obj.chapters) ? obj.chapters : [];
	for (const c of list) {
		if (!c || typeof c !== "object") continue;
		const r = c as Record<string, unknown>;
		const title = typeof r.title === "string" ? r.title.trim() : "";
		const summary = typeof r.summary === "string" ? r.summary.trim() : "";
		if (!title && !summary) continue;
		chapters.push({
			title: title || `第${chapters.length + 1}段`,
			summary: summary || title,
			castHints: asStringArray(r.castHints),
			beats: asStringArray(r.beats),
		});
	}
	return {
		blurb: typeof obj.blurb === "string" ? obj.blurb.trim() : undefined,
		themes: asStringArray(obj.themes),
		conflicts: asStringArray(obj.conflicts),
		chapters,
		source: "auto",
		updatedAt: Date.now(),
	};
}

/** 从用户粘贴的大纲文本粗解析 */
export function parseUserOutlineText(text: string): OutlineDraft {
	const lines = text
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);
	const chapters: OutlineChapter[] = [];
	let current: OutlineChapter | null = null;
	for (const line of lines) {
		const m = /^(第[一二三四五六七八九十百千\d]+[章节回部卷]|Chapter\s+\d+|#{1,3}\s+)/i.exec(line);
		if (m || (line.length < 40 && /[章节回]/.test(line))) {
			if (current) chapters.push(current);
			current = {
				title: line.replace(/^#+\s*/, ""),
				summary: "",
				castHints: [],
				beats: [],
			};
		} else if (current) {
			current.summary = current.summary ? `${current.summary} ${line}` : line;
		} else {
			current = { title: `段${chapters.length + 1}`, summary: line, castHints: [], beats: [] };
		}
	}
	if (current) chapters.push(current);
	if (chapters.length === 0 && text.trim()) {
		chapters.push({
			title: "全文大纲",
			summary: text.trim().slice(0, 4000),
			castHints: [],
			beats: [],
		});
	}
	return {
		blurb: chapters[0]?.summary.slice(0, 120),
		themes: [],
		conflicts: [],
		chapters,
		source: "user",
		updatedAt: Date.now(),
	};
}

/** 将大纲压成注入 extract/elevate 的短文本 */
export function outlineToPromptContext(outline: OutlineDraft | null | undefined, maxChars = 3500): string {
	if (!outline || !outline.chapters?.length) return "";
	const parts: string[] = [];
	if (outline.blurb) parts.push(`全书：${outline.blurb}`);
	if (outline.themes?.length) parts.push(`主题：${outline.themes.join("、")}`);
	if (outline.conflicts?.length) parts.push(`冲突：${outline.conflicts.join("、")}`);
	for (const ch of outline.chapters.slice(0, 40)) {
		const cast = ch.castHints?.length ? `【角色：${ch.castHints.slice(0, 6).join("、")}】` : "";
		parts.push(`· ${ch.title}${cast}：${ch.summary}`);
	}
	const s = parts.join("\n");
	return s.length > maxChars ? `${s.slice(0, maxChars)}…` : s;
}

/**
 * 对采样后的 chunk 文本做反向大纲。
 * pieces: { index, title?, text }[]
 */
export async function buildReverseOutline(input: {
	target: ForgeLlmTarget;
	title?: string;
	pieces: { index: number; title?: string; text: string }[];
	useLlm: boolean;
	temperature?: number;
}): Promise<OutlineDraft> {
	if (!input.useLlm || !input.pieces.length) {
		return {
			blurb: input.title || "",
			themes: [],
			conflicts: [],
			chapters: input.pieces.slice(0, 20).map((p, i) => ({
				title: p.title || `片段${i + 1}`,
				summary: p.text.slice(0, 200).replace(/\s+/g, " "),
				castHints: [],
				beats: [],
			})),
			source: "auto",
			updatedAt: Date.now(),
		};
	}

	// 先对每块做短摘要（限制块数控制费用）
	const maxPieces = Math.min(input.pieces.length, 16);
	const partials: { title: string; summary: string; castHints: string[] }[] = [];
	for (let i = 0; i < maxPieces; i++) {
		const p = input.pieces[i];
		try {
			const content = await forgeChat(
				input.target,
				[
					{
						role: "system",
						content: `你是小说大纲助手。根据片段输出 JSON：
{"title":"小节标题","summary":"2-4句摘要","castHints":["角色名"]}
只输出 JSON，中文。`,
					},
					{
						role: "user",
						content: [
							input.title ? `书名：${input.title}` : "",
							p.title ? `章节提示：${p.title}` : `片段序号：${p.index}`,
							"---",
							p.text.slice(0, 6000),
						]
							.filter(Boolean)
							.join("\n"),
					},
				],
				{ temperature: input.temperature ?? 0.2, maxTokens: 800, timeoutMs: 90_000 },
			);
			const raw = extractJsonBlock(content) as Record<string, unknown>;
			partials.push({
				title:
					(typeof raw.title === "string" && raw.title.trim()) ||
					p.title ||
					`片段${p.index + 1}`,
				summary:
					(typeof raw.summary === "string" && raw.summary.trim()) ||
					p.text.slice(0, 160),
				castHints: asStringArray(raw.castHints),
			});
		} catch {
			partials.push({
				title: p.title || `片段${p.index + 1}`,
				summary: p.text.slice(0, 160).replace(/\s+/g, " "),
				castHints: [],
			});
		}
	}

	// 合并为全书大纲
	try {
		const content = await forgeChat(
			input.target,
			[
				{
					role: "system",
					content: `你是小说结构编辑。根据分节摘要合并为全书大纲 JSON：
{
  "blurb":"一句话简介",
  "themes":["主题"],
  "conflicts":["核心冲突"],
  "chapters":[{"title":"...","summary":"...","castHints":["..."],"beats":["情节点"]}]
}
章节可合并相近片段；中文；只输出 JSON。`,
				},
				{
					role: "user",
					content: JSON.stringify({
						title: input.title ?? "",
						sections: partials,
					}),
				},
			],
			{ temperature: input.temperature ?? 0.3, maxTokens: 4000, timeoutMs: 180_000 },
		);
		const draft = normalizeOutline(extractJsonBlock(content));
		if (draft.chapters.length === 0) {
			return {
				blurb: input.title,
				themes: [],
				conflicts: [],
				chapters: partials.map((p) => ({
					title: p.title,
					summary: p.summary,
					castHints: p.castHints,
					beats: [],
				})),
				source: "auto",
				updatedAt: Date.now(),
			};
		}
		return draft;
	} catch {
		return {
			blurb: input.title,
			themes: [],
			conflicts: [],
			chapters: partials.map((p) => ({
				title: p.title,
				summary: p.summary,
				castHints: p.castHints,
				beats: [],
			})),
			source: "auto",
			updatedAt: Date.now(),
		};
	}
}

export function shouldEnableOutline(mode: string, enableOutline?: boolean): boolean {
	if (typeof enableOutline === "boolean") return enableOutline;
	return mode === "deep";
}
