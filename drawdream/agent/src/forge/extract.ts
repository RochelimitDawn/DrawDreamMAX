/**
 * Map 阶段：单块角色 / 设定提取。
 */

import { extractJsonBlock, forgeChat, type ForgeLlmTarget } from "./llm.ts";
import type { CastMention, LoreDraftEntry } from "./types.ts";

export interface ChunkExtractResult {
	characters: CastMention[];
	lore: LoreDraftEntry[];
	summary: string;
}

function asStringArray(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	return v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean);
}

function normalizeExtract(raw: unknown, chunkIndex: number): ChunkExtractResult {
	const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const characters: CastMention[] = [];
	const list = Array.isArray(obj.characters) ? obj.characters : [];
	for (const c of list) {
		if (!c || typeof c !== "object") continue;
		const r = c as Record<string, unknown>;
		const name = typeof r.name === "string" ? r.name.trim() : "";
		if (!name) continue;
		characters.push({
			name,
			aliases: asStringArray(r.aliases),
			roleHint: typeof r.roleHint === "string" ? r.roleHint.trim() : "",
			traits: asStringArray(r.traits),
			count: typeof r.count === "number" && r.count > 0 ? Math.floor(r.count) : 1,
			chunks: [chunkIndex],
		});
	}
	const lore: LoreDraftEntry[] = [];
	const loreList = Array.isArray(obj.lore) ? obj.lore : [];
	for (const e of loreList) {
		if (!e || typeof e !== "object") continue;
		const r = e as Record<string, unknown>;
		const title = typeof r.title === "string" ? r.title.trim() : "";
		const content = typeof r.content === "string" ? r.content.trim() : "";
		if (!title || !content) continue;
		const keys = asStringArray(r.keys);
		lore.push({
			title,
			keys: keys.length ? keys : [title],
			content,
			constant: r.constant === true,
			order: typeof r.order === "number" ? r.order : 100,
		});
	}
	const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
	return { characters, lore, summary };
}

const SYSTEM = `你是小说设定提取助手。只根据给定正文片段提取信息，不要编造片段外情节。
严格输出一个 JSON 对象（不要 markdown 解释），结构：
{
  "summary": "本段 1-3 句摘要",
  "characters": [
    {"name":"规范名","aliases":["别名"],"roleHint":"主角/配角/反派/路人","traits":["特征"],"count":出现次数估计}
  ],
  "lore": [
    {"title":"条目标题","keys":["触发词"],"content":"2-6句设定","constant":false,"order":100}
  ]
}
规则：
- characters 只收录有姓名的角色，最多 12 个
- lore 收录地点、势力、功法、重要物品、世界规则，最多 10 条；总纲类可 constant=true
- content 用中文，客观、可挂载进角色扮演世界书`;

export async function extractChunk(
	target: ForgeLlmTarget,
	chunkText: string,
	chunkIndex: number,
	novelTitle?: string,
	opts?: { temperature?: number; outlineContext?: string },
): Promise<ChunkExtractResult> {
	const user = [
		novelTitle ? `小说标题：${novelTitle}` : "",
		`片段序号：${chunkIndex}`,
		opts?.outlineContext ? `【全书大纲参考】\n${opts.outlineContext}` : "",
		"---正文开始---",
		chunkText.slice(0, 12000),
		"---正文结束---",
		"请输出 JSON。",
	]
		.filter(Boolean)
		.join("\n");
	const content = await forgeChat(
		target,
		[
			{ role: "system", content: SYSTEM },
			{ role: "user", content: user },
		],
		{ temperature: opts?.temperature ?? 0.2, maxTokens: 3000 },
	);
	try {
		return normalizeExtract(extractJsonBlock(content), chunkIndex);
	} catch {
		return { characters: [], lore: [], summary: content.slice(0, 200) };
	}
}
