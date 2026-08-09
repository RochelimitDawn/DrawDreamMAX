/**
 * 升华：生成角色卡字段 + 分层世界书条目。
 */

import { extractJsonBlock, forgeChat, type ForgeLlmTarget } from "./llm.ts";
import type { CastMention, LoreDraftEntry, TimelineEvent } from "./types.ts";
import type { CharacterCard } from "../types.ts";

export interface ElevateResult {
	card: CharacterCard;
	loreEntries: LoreDraftEntry[];
	summaries: string[];
	extraCards?: CharacterCard[];
	timeline?: TimelineEvent[];
}

function emptyCard(name: string): CharacterCard {
	return {
		name,
		description: "",
		personality: "",
		scenario: "",
		firstMes: "",
		mesExample: "",
		systemPrompt: "",
		postHistoryInstructions: "",
		creatorNotes: "由工坊从小说生成",
		alternateGreetings: [],
		tags: ["novel-forge"],
		book: [],
	};
}

function fallbackCard(protagonist: string, cast: CastMention[], summaries: string[], title?: string): CharacterCard {
	const me = cast.find((c) => c.name === protagonist) ?? cast[0];
	const card = emptyCard(protagonist);
	const others = cast
		.filter((c) => c.name !== protagonist)
		.slice(0, 8)
		.map((c) => `${c.name}${c.roleHint ? `（${c.roleHint}）` : ""}`)
		.join("、");
	card.description = [
		title ? `出自《${title}》。` : "",
		me?.traits?.length ? `特征：${me.traits.slice(0, 8).join("、")}。` : "",
		others ? `相关人物：${others}。` : "",
		summaries.slice(0, 3).join(" "),
	]
		.filter(Boolean)
		.join("\n");
	card.personality = me?.traits?.slice(0, 6).join("、") || "沉稳、坚韧";
	card.scenario = title
		? `故事发生在《${title}》的世界中。{{user}} 与 ${protagonist} 相遇。`
		: `{{user}} 与 ${protagonist} 在故事世界中相遇。`;
	card.firstMes = `*${protagonist}抬眼望向你，神色平静。*\n「……你是？」`;
	card.systemPrompt = `你是${protagonist}。严格保持人设与世界观一致性，用中文叙述。不要跳出角色。`;
	card.tags = ["novel-forge", title || "imported"].filter(Boolean);
	return card;
}

function fallbackLore(
	title: string | undefined,
	cast: CastMention[],
	lore: LoreDraftEntry[],
	summaries: string[],
): LoreDraftEntry[] {
	const entries: LoreDraftEntry[] = [];
	entries.push({
		title: title ? `《${title}》总纲` : "世界总纲",
		keys: title ? [title, "世界观", "总纲"] : ["世界观", "总纲"],
		content: [
			title ? `本书世界基于《${title}》。` : "基于导入小说构建的世界。",
			summaries.slice(0, 5).join(" "),
			cast.length ? `主要人物：${cast.slice(0, 10).map((c) => c.name).join("、")}。` : "",
		]
			.filter(Boolean)
			.join("\n"),
		constant: true,
		order: 10,
	});
	for (const c of cast.slice(0, 20)) {
		entries.push({
			title: c.name,
			keys: [c.name, ...c.aliases].slice(0, 8),
			content: [
				c.roleHint ? `身份：${c.roleHint}。` : "",
				c.traits.length ? `特征：${c.traits.join("、")}。` : "",
				`在正文中约出现 ${c.count} 次，跨 ${c.chunks.length} 个片段。`,
			]
				.filter(Boolean)
				.join(""),
			constant: false,
			order: 100,
		});
	}
	for (const e of lore.slice(0, 40)) {
		if (entries.some((x) => x.title === e.title)) continue;
		entries.push(e);
	}
	return entries;
}

export async function elevateAssets(input: {
	target: ForgeLlmTarget;
	protagonist: string;
	cast: CastMention[];
	lore: LoreDraftEntry[];
	summaries: string[];
	title?: string;
	useLlm: boolean;
	/** 降温度重试时传 0 */
	temperature?: number;
	outlineContext?: string;
}): Promise<ElevateResult> {
	const { protagonist, cast, lore, summaries, title } = input;
	const temperature = input.temperature ?? 0.4;
	if (!input.useLlm) {
		return {
			card: fallbackCard(protagonist, cast, summaries, title),
			loreEntries: fallbackLore(title, cast, lore, summaries),
			summaries,
		};
	}

	const pack = {
		title: title ?? "",
		protagonist,
		outline: input.outlineContext || undefined,
		cast: cast.slice(0, 25).map((c) => ({
			name: c.name,
			aliases: c.aliases,
			roleHint: c.roleHint,
			traits: c.traits,
			count: c.count,
		})),
		lore: lore.slice(0, 30),
		summaries: summaries.slice(0, 40),
	};

	const system = `你是角色卡与世界书作者。根据提供的提取结果，为角色扮演生成可直接使用的卡与书。
只输出 JSON：
{
  "card": {
    "name": "角色名",
    "description": "外貌与背景 80-200字",
    "personality": "性格关键词或短段",
    "scenario": "开场情境，可含 {{user}} {{char}}",
    "first_mes": "开场白，可含叙述与对白",
    "mes_example": "可选示例对话",
    "system_prompt": "扮演指令",
    "tags": ["tag"]
  },
  "lore": [
    {"title":"...","keys":["..."],"content":"...","constant":true|false,"order":10}
  ]
}
要求：至少 1 条 constant 总纲；角色条目绿灯；中文；不要编造与 pack 严重冲突的设定。`;

	try {
		const content = await forgeChat(
			input.target,
			[
				{ role: "system", content: system },
				{ role: "user", content: JSON.stringify(pack) },
			],
			{ temperature, maxTokens: 5000, timeoutMs: 180_000 },
		);
		const raw = extractJsonBlock(content) as Record<string, unknown>;
		const c = (raw.card && typeof raw.card === "object" ? raw.card : {}) as Record<string, unknown>;
		const card = emptyCard(typeof c.name === "string" && c.name.trim() ? c.name.trim() : protagonist);
		const str = (k: string, alt?: string) =>
			typeof c[k] === "string" ? (c[k] as string) : alt ? (typeof c[alt] === "string" ? (c[alt] as string) : "") : "";
		card.description = str("description") || fallbackCard(protagonist, cast, summaries, title).description;
		card.personality = str("personality");
		card.scenario = str("scenario");
		card.firstMes = str("first_mes", "firstMes");
		card.mesExample = str("mes_example", "mesExample");
		card.systemPrompt = str("system_prompt", "systemPrompt");
		card.tags = Array.isArray(c.tags)
			? (c.tags as unknown[]).filter((x): x is string => typeof x === "string")
			: ["novel-forge"];
		if (!card.tags.includes("novel-forge")) card.tags.push("novel-forge");

		const loreEntries: LoreDraftEntry[] = [];
		const loreArr = Array.isArray(raw.lore) ? raw.lore : [];
		for (const e of loreArr) {
			if (!e || typeof e !== "object") continue;
			const r = e as Record<string, unknown>;
			const t = typeof r.title === "string" ? r.title.trim() : "";
			const contentL = typeof r.content === "string" ? r.content.trim() : "";
			if (!t || !contentL) continue;
			const keys = Array.isArray(r.keys)
				? (r.keys as unknown[]).filter((x): x is string => typeof x === "string" && !!x.trim())
				: [t];
			loreEntries.push({
				title: t,
				keys: keys.length ? keys : [t],
				content: contentL,
				constant: r.constant === true,
				order: typeof r.order === "number" ? r.order : 100,
			});
		}
		if (loreEntries.length === 0) {
			return {
				card,
				loreEntries: fallbackLore(title, cast, lore, summaries),
				summaries,
			};
		}
		return { card, loreEntries, summaries };
	} catch {
		return {
			card: fallbackCard(protagonist, cast, summaries, title),
			loreEntries: fallbackLore(title, cast, lore, summaries),
			summaries,
		};
	}
}

/** 为配角批量生成轻量角色卡（可无 LLM） */
export async function elevateSideCards(input: {
	target: ForgeLlmTarget;
	names: string[];
	cast: CastMention[];
	summaries: string[];
	title?: string;
	useLlm: boolean;
	temperature?: number;
}): Promise<CharacterCard[]> {
	const temperature = input.temperature ?? 0.4;
	const out: CharacterCard[] = [];
	for (const name of input.names) {
		const n = name.trim();
		if (!n) continue;
		if (!input.useLlm) {
			out.push(fallbackCard(n, input.cast, input.summaries, input.title));
			continue;
		}
		try {
			const me = input.cast.find((c) => c.name === n);
			const content = await forgeChat(
				input.target,
				[
					{
						role: "system",
						content: `为角色扮演生成单张角色卡 JSON（不要 markdown）：
{"name":"...","description":"...","personality":"...","scenario":"...","first_mes":"...","system_prompt":"...","tags":["novel-forge"]}
中文；与《${input.title || "原作"}》设定一致；角色名为 ${n}。`,
					},
					{
						role: "user",
						content: JSON.stringify({
							name: n,
							roleHint: me?.roleHint,
							traits: me?.traits,
							summaries: input.summaries.slice(0, 12),
						}),
					},
				],
				{ temperature, maxTokens: 2000, timeoutMs: 120_000 },
			);
			const raw = extractJsonBlock(content) as Record<string, unknown>;
			const card = emptyCard(typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : n);
			const str = (k: string, alt?: string) =>
				typeof raw[k] === "string"
					? (raw[k] as string)
					: alt && typeof raw[alt] === "string"
						? (raw[alt] as string)
						: "";
			card.description = str("description") || fallbackCard(n, input.cast, input.summaries, input.title).description;
			card.personality = str("personality");
			card.scenario = str("scenario");
			card.firstMes = str("first_mes", "firstMes");
			card.systemPrompt = str("system_prompt", "systemPrompt");
			card.tags = Array.isArray(raw.tags)
				? (raw.tags as unknown[]).filter((x): x is string => typeof x === "string")
				: ["novel-forge", "side-cast"];
			if (!card.tags.includes("novel-forge")) card.tags.push("novel-forge");
			if (!card.tags.includes("side-cast")) card.tags.push("side-cast");
			out.push(card);
		} catch {
			out.push(fallbackCard(n, input.cast, input.summaries, input.title));
		}
	}
	return out;
}

/** 精研：从摘要拼事件时间线 */
export async function buildTimeline(input: {
	target: ForgeLlmTarget;
	summaries: string[];
	title?: string;
	useLlm: boolean;
}): Promise<TimelineEvent[]> {
	const base: TimelineEvent[] = input.summaries.slice(0, 40).map((s, i) => ({
		title: `节点 ${i + 1}`,
		order: (i + 1) * 10,
		summary: s.slice(0, 400),
		keys: [`节点${i + 1}`, "剧情"],
		chapterHint: "",
	}));
	if (!input.useLlm || input.summaries.length === 0) return base;

	try {
		const content = await forgeChat(
			input.target,
			[
				{
					role: "system",
					content: `你是小说剧情时间线编辑。根据分段摘要输出 JSON：
{"events":[{"title":"事件名","order":10,"summary":"2-4句","keys":["触发词"],"chapterHint":"可选章节提示"}]}
要求：按时间顺序 order 递增；8-24 条；中文；不要编造与摘要严重冲突的情节。`,
				},
				{
					role: "user",
					content: JSON.stringify({
						title: input.title ?? "",
						summaries: input.summaries.slice(0, 40),
					}),
				},
			],
			{ temperature: 0.3, maxTokens: 4000, timeoutMs: 180_000 },
		);
		const raw = extractJsonBlock(content) as { events?: unknown };
		const list = Array.isArray(raw.events) ? raw.events : [];
		const events: TimelineEvent[] = [];
		for (const e of list) {
			if (!e || typeof e !== "object") continue;
			const r = e as Record<string, unknown>;
			const title = typeof r.title === "string" ? r.title.trim() : "";
			const summary = typeof r.summary === "string" ? r.summary.trim() : "";
			if (!title || !summary) continue;
			const keys = Array.isArray(r.keys)
				? (r.keys as unknown[]).filter((x): x is string => typeof x === "string" && !!x.trim())
				: [title];
			events.push({
				title,
				order: typeof r.order === "number" ? r.order : (events.length + 1) * 10,
				summary,
				keys: keys.length ? keys : [title],
				chapterHint: typeof r.chapterHint === "string" ? r.chapterHint : "",
			});
		}
		return events.length ? events.sort((a, b) => a.order - b.order) : base;
	} catch {
		return base;
	}
}

/** 对话式改卡/改书：按用户指令修订草稿 */
export async function refineElevateDraft(input: {
	target: ForgeLlmTarget;
	instruction: string;
	card: CharacterCard;
	lore: LoreDraftEntry[];
	useLlm: boolean;
}): Promise<{ card: CharacterCard; lore: LoreDraftEntry[] }> {
	if (!input.useLlm) {
		const card = { ...input.card };
		card.creatorNotes = `${card.creatorNotes || ""}\n[用户指令未应用-无模型] ${input.instruction}`.trim();
		return { card, lore: input.lore };
	}
	const system = `你是角色卡与世界书修订助手。根据用户指令修改现有草稿。
只输出 JSON：
{
  "card": {
    "name":"...","description":"...","personality":"...","scenario":"...","first_mes":"...",
    "mes_example":"...","system_prompt":"...","post_history_instructions":"...","tags":[]
  },
  "lore":[{"title":"...","keys":["..."],"content":"...","constant":true|false,"order":10}]
}
保留可玩性；中文；未要求删除的条目尽量保留。`;
	try {
		const content = await forgeChat(
			input.target,
			[
				{ role: "system", content: system },
				{
					role: "user",
					content: JSON.stringify({
						instruction: input.instruction,
						card: {
							name: input.card.name,
							description: input.card.description,
							personality: input.card.personality,
							scenario: input.card.scenario,
							first_mes: input.card.firstMes,
							mes_example: input.card.mesExample,
							system_prompt: input.card.systemPrompt,
							post_history_instructions: input.card.postHistoryInstructions,
							tags: input.card.tags,
						},
						lore: input.lore.slice(0, 40),
					}),
				},
			],
			{ temperature: 0.35, maxTokens: 5000, timeoutMs: 180_000 },
		);
		const raw = extractJsonBlock(content) as Record<string, unknown>;
		const c = (raw.card && typeof raw.card === "object" ? raw.card : {}) as Record<string, unknown>;
		const card = { ...input.card };
		const str = (k: string, alt?: string) =>
			typeof c[k] === "string"
				? (c[k] as string)
				: alt && typeof c[alt] === "string"
					? (c[alt] as string)
					: "";
		if (typeof c.name === "string" && c.name.trim()) card.name = c.name.trim();
		if (str("description")) card.description = str("description");
		if (str("personality")) card.personality = str("personality");
		if (str("scenario")) card.scenario = str("scenario");
		if (str("first_mes", "firstMes")) card.firstMes = str("first_mes", "firstMes");
		if (str("mes_example", "mesExample")) card.mesExample = str("mes_example", "mesExample");
		if (str("system_prompt", "systemPrompt")) card.systemPrompt = str("system_prompt", "systemPrompt");
		if (str("post_history_instructions", "postHistoryInstructions")) {
			card.postHistoryInstructions = str("post_history_instructions", "postHistoryInstructions");
		}
		if (Array.isArray(c.tags)) {
			card.tags = (c.tags as unknown[]).filter((x): x is string => typeof x === "string");
			if (!card.tags.includes("novel-forge")) card.tags.push("novel-forge");
		}

		const loreEntries: LoreDraftEntry[] = [];
		const loreArr = Array.isArray(raw.lore) ? raw.lore : [];
		for (const e of loreArr) {
			if (!e || typeof e !== "object") continue;
			const r = e as Record<string, unknown>;
			const t = typeof r.title === "string" ? r.title.trim() : "";
			const contentL = typeof r.content === "string" ? r.content.trim() : "";
			if (!t || !contentL) continue;
			const keys = Array.isArray(r.keys)
				? (r.keys as unknown[]).filter((x): x is string => typeof x === "string" && !!x.trim())
				: [t];
			loreEntries.push({
				title: t,
				keys: keys.length ? keys : [t],
				content: contentL,
				constant: r.constant === true,
				order: typeof r.order === "number" ? r.order : 100,
			});
		}
		return { card, lore: loreEntries.length ? loreEntries : input.lore };
	} catch {
		return { card: input.card, lore: input.lore };
	}
}
