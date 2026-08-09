/**
 * 智能搜索 — Tavily Search API
 * https://docs.tavily.com/documentation/api-reference/endpoint/search
 * https://docs.tavily.com/welcome
 *
 * 配置：drawdream.config.json → smartSearch（apiKey 必填）
 * 展示：对话内仅纯文本（时间锚点 + 网页 snippet），不附来源链接、不请求 Tavily 简报/配图。
 * 默认先经 UAPI worldtime 锚定当前日期，避免检索词落到过时年份。
 */

import {
	fetchWorldTime,
	formatWorldTimePlain,
	stampQueryWithWorldTime,
	type WorldTimeInfo,
} from "./world-time.ts";

export type SmartSearchConfig = {
	/** 总开关；缺省 true */
	enabled?: boolean;
	/** Tavily API Key（tvly-…）；Bearer 鉴权 */
	apiKey?: string;
	/** 默认 https://api.tavily.com */
	baseUrl?: string;
	/** basic | advanced | fast | ultra-fast，默认 basic */
	searchDepth?: "basic" | "advanced" | "fast" | "ultra-fast";
	/** general | news | finance */
	topic?: "general" | "news" | "finance";
	/**
	 * @deprecated 简报已永久关闭；读写均忽略，恒不向 Tavily 请求 include_answer
	 */
	includeAnswer?: boolean;
	/**
	 * @deprecated 配图已永久关闭；读写均忽略
	 */
	includeImages?: boolean;
	/**
	 * 检索模式
	 * - simple：单次 Tavily
	 * - multi：多路子查询 + RRF（默认 simple，Tavily 本身已较强）
	 */
	mode?: "simple" | "multi";
	maxQueries?: number;
};

export type SearchImage = {
	url: string;
	description?: string;
};

export type SmartSearchHit = {
	title: string;
	url: string;
	/** 正文摘要 / content */
	content: string;
	snippet?: string;
	domain?: string;
	favicon?: string;
	score?: number;
	raw_content?: string;
	images?: SearchImage[];
	via?: string[];
};

export type SearchPlan = {
	original_query: string;
	assessed_complexity: "Simple" | "Moderate" | "Complex";
	foundational_queries: string[];
	languages?: Array<"zh" | "en">;
	keywords?: string[];
};

/** 智能搜索结构化结果（对话展示仅用 formatSearchPlain 纯文本） */
export type SearchPanelPayload = {
	v: 1;
	provider: "tavily";
	query: string;
	/** 用户原始 query（未打时间戳前） */
	original_query?: string;
	answer?: string;
	images: SearchImage[];
	results: SmartSearchHit[];
	plan?: SearchPlan;
	mode?: "simple" | "multi";
	response_time?: number;
	total?: number;
	/** 搜索前锚定的世界时间 */
	world_time?: {
		datetime: string;
		timezone: string;
		year?: string;
		date?: string;
		weekday_zh?: string;
	};
};

export type SmartSearchResponse = SearchPanelPayload & {
	/** 兼容旧字段名 */
	results: SmartSearchHit[];
};

export type SmartSearchParams = {
	query: string;
	/** 域名白名单，逗号或数组 */
	include_domains?: string[] | string;
	exclude_domains?: string[] | string;
	time_range?: string;
	topic?: "general" | "news" | "finance";
	search_depth?: "basic" | "advanced" | "fast" | "ultra-fast";
	/** 条数 1–20，默认 8 */
	limit?: number;
	/** @deprecated 已忽略；简报永久关闭 */
	include_answer?: boolean;
	/** @deprecated 已忽略；配图永久关闭 */
	include_images?: boolean;
	mode?: "simple" | "multi";
	/**
	 * 是否在搜索前自动查询世界时间并锚定 query。
	 * 默认 true；仅调试可关。
	 */
	resolve_time?: boolean;
	/** 世界时间时区（IANA），默认 Asia/Shanghai */
	time_city?: string;
};

const DEFAULT_BASE = "https://api.tavily.com";
const RRF_K = 60;

export function resolveSmartSearchConfig(cfg: SmartSearchConfig | undefined | null): {
	enabled: boolean;
	apiKey: string;
	baseUrl: string;
	searchDepth: "basic" | "advanced" | "fast" | "ultra-fast";
	topic: "general" | "news" | "finance";
	/** 恒 false：产品已取消 Tavily 简报 */
	includeAnswer: false;
	/** 恒 false：产品已取消搜索配图 */
	includeImages: false;
	mode: "simple" | "multi";
	maxQueries: number;
} {
	const enabled = cfg?.enabled !== false;
	const apiKey = typeof cfg?.apiKey === "string" ? cfg.apiKey.trim() : "";
	let baseUrl = typeof cfg?.baseUrl === "string" && cfg.baseUrl.trim() ? cfg.baseUrl.trim() : DEFAULT_BASE;
	baseUrl = baseUrl.replace(/\/+$/, "");
	const depth = cfg?.searchDepth;
	const searchDepth =
		depth === "advanced" || depth === "fast" || depth === "ultra-fast" || depth === "basic" ? depth : "basic";
	const topic = cfg?.topic === "news" || cfg?.topic === "finance" ? cfg.topic : "general";
	const mode = cfg?.mode === "multi" ? "multi" : "simple";
	const maxQueries = Math.min(4, Math.max(1, Math.round(cfg?.maxQueries ?? 3)));
	return {
		enabled,
		apiKey,
		baseUrl,
		searchDepth,
		topic,
		includeAnswer: false,
		includeImages: false,
		mode,
		maxQueries,
	};
}

function pickString(v: unknown): string {
	return typeof v === "string" ? v.trim() : "";
}

function domainOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
}

function normalizeUrlKey(url: string): string {
	try {
		const u = new URL(url);
		u.hash = "";
		for (const k of [...u.searchParams.keys()]) {
			if (/^(utm_|fbclid|gclid|spm|from)/i.test(k)) u.searchParams.delete(k);
		}
		const path = u.pathname.replace(/\/(?:amp|print)\/?$/i, "").replace(/\/+$/, "") || "/";
		const host = u.hostname.toLowerCase().replace(/^(?:www\.|m\.)/, "");
		const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
		const search = params.length ? `?${new URLSearchParams(params).toString()}` : "";
		return `https://${host}${path}${search}`;
	} catch {
		return url.trim();
	}
}

function parseDomainList(v: string[] | string | undefined): string[] | undefined {
	if (!v) return undefined;
	const arr = Array.isArray(v)
		? v
		: String(v)
				.split(/[,，\s]+/)
				.map((s) => s.trim())
				.filter(Boolean);
	return arr.length ? arr.slice(0, 50) : undefined;
}

function normalizeImages(raw: unknown): SearchImage[] {
	if (!Array.isArray(raw)) return [];
	const out: SearchImage[] = [];
	for (const item of raw) {
		if (typeof item === "string" && /^https?:\/\//i.test(item)) {
			out.push({ url: item });
			continue;
		}
		if (!item || typeof item !== "object") continue;
		const o = item as Record<string, unknown>;
		const url = pickString(o.url) || pickString(o.src) || pickString(o.image);
		if (!url || !/^https?:\/\//i.test(url)) continue;
		const description = pickString(o.description) || pickString(o.alt) || pickString(o.title);
		out.push({ url, ...(description ? { description } : {}) });
		if (out.length >= 12) break;
	}
	return out;
}

function normalizeTavilyResults(raw: unknown, limit: number): SmartSearchHit[] {
	const list =
		raw && typeof raw === "object" && Array.isArray((raw as { results?: unknown }).results)
			? (raw as { results: unknown[] }).results
			: Array.isArray(raw)
				? raw
				: [];
	const out: SmartSearchHit[] = [];
	for (const item of list) {
		if (!item || typeof item !== "object") continue;
		const o = item as Record<string, unknown>;
		const title = pickString(o.title) || "无标题";
		const url = pickString(o.url) || pickString(o.link);
		const content =
			pickString(o.content) || pickString(o.snippet) || pickString(o.description) || pickString(o.raw_content);
		if (!url && !content) continue;
		const images = normalizeImages(o.images);
		const hit: SmartSearchHit = {
			title,
			url,
			content,
			snippet: content.slice(0, 280),
			domain: pickString(o.domain) || (url ? domainOf(url) : ""),
			...(pickString(o.favicon) ? { favicon: pickString(o.favicon) } : {}),
			...(typeof o.score === "number" ? { score: o.score } : {}),
			...(pickString(o.raw_content) ? { raw_content: pickString(o.raw_content).slice(0, 4000) } : {}),
			...(images.length ? { images } : {}),
		};
		out.push(hit);
		if (out.length >= limit) break;
	}
	return out;
}

const QUERY_STOP_ZH = /^(请|帮我|麻烦|我想|我想了解|查一下|搜索一下|搜一下|检索一下|联网查一下|帮我查一下)/;
const QUERY_STOP_EN = /^(please\s+)?(search\s+(for\s+)?|look\s+up\s+|find\s+(online\s+)?|check\s+|verify\s+)/i;

function queryCore(query: string): string {
	return query
		.replace(/^20\d{2}(?:年\d{1,2}[-月]\d{1,2}日?|[-/]\d{1,2}[-/]\d{1,2})?\s*/, "")
		.replace(QUERY_STOP_ZH, "")
		.replace(QUERY_STOP_EN, "")
		.replace(/[?？]+$/g, "")
		.trim();
}

function queryKeywords(query: string): string[] {
	const latin = query.match(/[A-Za-z][A-Za-z0-9._+#/-]{1,}/g) ?? [];
	const quoted = [...query.matchAll(/[“"']([^”"']{2,40})[”"']/g)].map((m) => m[1]);
	const cjk = query
		.replace(/[A-Za-z0-9._+#/-]+/g, " ")
		.split(/[\s，。！？、；：与和及或]+/)
		.map((part) => part.trim())
		.filter((part) => part.length >= 2 && !/^(请|帮我|一下|什么|怎么|如何|有没有|相关|资料|信息)$/.test(part));
	return [...new Set([...quoted, ...latin, ...cjk])].slice(0, 10);
}

function composeSingleQuery(plan: SearchPlan): string {
	const first = plan.foundational_queries[0] || plan.original_query;
	if (plan.assessed_complexity === "Simple") return first;
	const additions: string[] = [];
	const lower = first.toLowerCase();
	for (const variant of plan.foundational_queries.slice(1)) {
		for (const token of variant.split(/\s+/)) {
			const clean = token.trim();
			if (clean.length < 2 || lower.includes(clean.toLowerCase()) || additions.includes(clean)) continue;
			additions.push(clean);
			if (additions.length >= 8) break;
		}
		if (additions.length >= 8) break;
	}
	return `${first} ${additions.join(" ")}`.trim().slice(0, 200);
}

/** 双语、实体和检索意图驱动的查询规划。 */
export function planSearchQueries(query: string, maxQueries = 3): SearchPlan {
	const q = query.replace(/\s+/g, " ").trim();
	const core = queryCore(q) || q;
	const queries: string[] = [];
	const push = (s: string) => {
		const t = s.replace(/\s+/g, " ").trim();
		if (!t || t.length < 2) return;
		if (queries.some((x) => x.toLowerCase() === t.toLowerCase())) return;
		if (queries.length >= maxQueries) return;
		queries.push(t.slice(0, 160));
	};
	push(core);
	const isZh = /[\u3400-\u9fff]/.test(core);
	const hasEn = /[A-Za-z]{2,}/.test(core);
	const long = q.length >= (isZh ? 12 : 28);
	const multiClause =
		/[?？]|以及|还有|和|与|vs\.?|versus|compare|对比|区别|怎么样|如何|怎么|为什么|最新|today|latest/i.test(q);
	const complexity: SearchPlan["assessed_complexity"] =
		multiClause || long ? (long && multiClause ? "Complex" : "Moderate") : "Simple";

	const fresh = /最新|今天|今日|近日|本周|本月|实时|进展|发布|latest|today|current|recent|news|release/i.test(q);
	const official = /官网|官方|文档|说明|白皮书|公告|documentation|docs|official|whitepaper|release\s*notes|changelog/i.test(q);
	const compare = /对比|区别|哪个好|比较|\bvs\.?\b|versus|compare|comparison/i.test(q);
	const howTo = /怎么|如何|教程|用法|配置|how\s+to|tutorial|guide|setup|usage/i.test(q);
	const verify = /核实|查证|求证|来源|证据|事实|verify|fact.?check|source|evidence/i.test(q);
	if (compare) {
		for (const side of core.split(/\s+(?:vs\.?|versus)\s+|对比|比较|与|和/i).map((part) => part.trim())) {
			if (side.length >= 2) push(`${side} ${isZh ? "官方资料 关键特性" : "official key features"}`);
		}
	}
	if (official) push(`${core} ${isZh ? "官网 官方文档 公告" : "official documentation release notes"}`);
	if (fresh) push(`${core} ${isZh ? "最新进展 官方消息" : "latest update official announcement"}`);
	if (howTo) push(`${core} ${isZh ? "教程 示例 最佳实践" : "guide examples best practices"}`);
	if (verify) push(`${core} ${isZh ? "事实核实 权威来源" : "fact check authoritative sources"}`);
	if (isZh && hasEn) push(`${queryKeywords(core).filter((word) => /[A-Za-z]/.test(word)).join(" ")} latest official documentation`);
	if (complexity !== "Simple" && isZh && queries.length < maxQueries) push(`${core} English official sources`);
	if (complexity !== "Simple" && !isZh && queries.length < maxQueries) {
		push(`${queryKeywords(core).join(" ")} official sources key facts`);
	}
	return {
		original_query: q,
		assessed_complexity: complexity,
		foundational_queries: queries.slice(0, maxQueries),
		languages: [...(isZh ? (["zh"] as const) : []), ...(hasEn ? (["en"] as const) : [])],
		keywords: queryKeywords(core),
	};
}

function textFingerprint(hit: SmartSearchHit): string {
	const normalized = (hit.content || hit.title)
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()
		.slice(0, 180);
	return normalized.length >= 60 ? normalized : "";
}

function coverageScore(hit: SmartSearchHit, keywords: string[]): number {
	if (!keywords.length) return 0;
	const haystack = `${hit.title} ${hit.content}`.toLowerCase();
	const matched = keywords.filter((word) => haystack.includes(word.toLowerCase())).length;
	return matched / keywords.length;
}

export function rrfFuse(
	rankLists: SmartSearchHit[][],
	limit: number,
	options?: { queries?: string[]; keywords?: string[] },
): SmartSearchHit[] {
	const map = new Map<string, { hit: SmartSearchHit; score: number; vias: Set<string>; bestRank: number }>();
	const fingerprints = new Map<string, string>();
	rankLists.forEach((list, listIdx) => {
		list.forEach((hit, rank) => {
			const fingerprint = textFingerprint(hit);
			const urlKey = hit.url ? normalizeUrlKey(hit.url) : "";
			const key = (fingerprint ? fingerprints.get(fingerprint) : undefined) || urlKey || `t:${fingerprint || hit.title}`;
			if (fingerprint) fingerprints.set(fingerprint, key);
			const add = 1 / (RRF_K + rank + 1) + (hit.score ?? 0) * 0.012 + coverageScore(hit, options?.keywords ?? []) * 0.02;
			const viaTag = options?.queries?.[listIdx] || `q${listIdx + 1}`;
			const cur = map.get(key);
			if (!cur) {
				map.set(key, { hit: { ...hit }, score: add, vias: new Set([viaTag]), bestRank: rank });
			} else {
				cur.score += add;
				cur.vias.add(viaTag);
				if (rank < cur.bestRank) {
					cur.bestRank = rank;
					cur.hit = {
						...cur.hit,
						title: hit.title || cur.hit.title,
						content: hit.content.length > cur.hit.content.length ? hit.content : cur.hit.content,
						favicon: hit.favicon || cur.hit.favicon,
						images: hit.images?.length ? hit.images : cur.hit.images,
					};
				} else if (hit.content.length > cur.hit.content.length) {
					cur.hit.content = hit.content;
				}
			}
		});
	});
	const ranked = [...map.values()]
		.sort((a, b) => b.score - a.score || a.bestRank - b.bestRank)
	const domainCounts = new Map<string, number>();
	const diverse: typeof ranked = [];
	const deferred: typeof ranked = [];
	for (const item of ranked) {
		const hit = item.hit;
		const domain = hit.domain || domainOf(hit.url);
		if (!domain) {
			diverse.push(item);
			continue;
		}
		const count = domainCounts.get(domain) ?? 0;
		if (count >= 2) deferred.push(item);
		else {
			domainCounts.set(domain, count + 1);
			diverse.push(item);
		}
	}
	for (const item of deferred) {
		if (diverse.length >= limit) break;
		diverse.push(item);
	}
	return diverse.slice(0, limit).map((x, i) => ({
			...x.hit,
			score: x.score,
			snippet: x.hit.content.slice(0, 280),
			via: [...x.vias],
			position: i + 1,
		})) as SmartSearchHit[];
}

async function tavilySearchOnce(
	resolved: ReturnType<typeof resolveSmartSearchConfig>,
	params: {
		query: string;
		include_domains?: string[];
		exclude_domains?: string[];
		time_range?: string;
		topic?: "general" | "news" | "finance";
		search_depth?: "basic" | "advanced" | "fast" | "ultra-fast";
		max_results: number;
		include_answer: boolean;
		include_images: boolean;
	},
	signal?: AbortSignal,
): Promise<{
	hits: SmartSearchHit[];
	answer?: string;
	images: SearchImage[];
	response_time?: number;
	raw: unknown;
}> {
	if (!resolved.apiKey) {
		throw new Error(
			"未配置 Tavily API Key。请打开「设置 → 高级」，在「智能搜索」填写 Key（https://app.tavily.com ）。",
		);
	}
	const body: Record<string, unknown> = {
		query: params.query,
		search_depth: params.search_depth || resolved.searchDepth,
		max_results: params.max_results,
		topic: params.topic || resolved.topic,
		include_answer: params.include_answer,
		include_images: params.include_images,
		include_image_descriptions: params.include_images,
		include_favicon: true,
	};
	if (params.time_range?.trim()) {
		const tr = params.time_range.trim().toLowerCase();
		const map: Record<string, string> = { d: "day", w: "week", m: "month", y: "year" };
		body.time_range = map[tr] || tr;
	}
	if (params.include_domains?.length) body.include_domains = params.include_domains;
	if (params.exclude_domains?.length) body.exclude_domains = params.exclude_domains;

	const url = `${resolved.baseUrl}/search`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json",
			authorization: `Bearer ${resolved.apiKey}`,
		},
		body: JSON.stringify(body),
		signal,
	});
	const text = await res.text();
	let json: unknown = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = null;
	}
	if (!res.ok) {
		let msg = text.slice(0, 400) || res.statusText;
		if (json && typeof json === "object") {
			const d = (json as { detail?: { error?: string } | string; message?: string }).detail;
			if (typeof d === "string") msg = d;
			else if (d && typeof d === "object" && typeof d.error === "string") msg = d.error;
			else if (typeof (json as { message?: string }).message === "string") msg = (json as { message: string }).message;
		}
		throw new Error(`Tavily 搜索失败 HTTP ${res.status}：${msg}`);
	}
	const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
	const hits = normalizeTavilyResults(obj, params.max_results);
	const answer = pickString(obj.answer);
	const images = normalizeImages(obj.images);
	const response_time = typeof obj.response_time === "number" ? obj.response_time : undefined;
	return { hits, ...(answer ? { answer } : {}), images, response_time, raw: json };
}

async function resolveTimeForSearch(
	params: SmartSearchParams,
	signal?: AbortSignal,
): Promise<WorldTimeInfo | null> {
	if (params.resolve_time === false) return null;
	try {
		return await fetchWorldTime(
			undefined,
			params.time_city ? { city: params.time_city } : undefined,
			signal,
		);
	} catch {
		// 取时失败不阻断搜索；模型仍可按 query 原样检索
		return null;
	}
}

function worldTimeMeta(info: WorldTimeInfo | null): SmartSearchResponse["world_time"] | undefined {
	if (!info) return undefined;
	return {
		datetime: info.datetime,
		timezone: info.timezone,
		...(info.year ? { year: info.year } : {}),
		...(info.date ? { date: info.date } : {}),
		...(info.weekday_zh ? { weekday_zh: info.weekday_zh } : {}),
	};
}

export async function runSmartSearch(
	cfg: SmartSearchConfig | undefined | null,
	params: SmartSearchParams,
	signal?: AbortSignal,
): Promise<SmartSearchResponse> {
	const resolved = resolveSmartSearchConfig(cfg);
	if (!resolved.enabled) {
		throw new Error("智能搜索已在设置中关闭（smartSearch.enabled=false）。");
	}
	const originalQuery = typeof params.query === "string" ? params.query.trim() : "";
	if (!originalQuery) throw new Error("query 不能为空");

	const mode = params.mode === "multi" || params.mode === "simple" ? params.mode : resolved.mode;
	const worldTime = await resolveTimeForSearch(params, signal);
	const basePlan = planSearchQueries(originalQuery, resolved.maxQueries);
	const plannedQueries = mode === "multi" ? basePlan.foundational_queries : [composeSingleQuery(basePlan)];
	const queries = plannedQueries.map((item) =>
		worldTime ? stampQueryWithWorldTime(item, worldTime) : item,
	);
	const query = queries[0] || (worldTime ? stampQueryWithWorldTime(originalQuery, worldTime) : originalQuery);
	const wt = worldTimeMeta(worldTime);

	const limit = Math.min(20, Math.max(1, Math.round(params.limit ?? 8)));
	// 产品决策：永久关闭 Tavily 简报与配图（忽略配置与工具参数）
	const includeAnswer = false;
	const includeImages = false;
	const include_domains = parseDomainList(params.include_domains);
	const exclude_domains = parseDomainList(params.exclude_domains);
	const topic = params.topic || resolved.topic;
	const search_depth = params.search_depth || resolved.searchDepth;
	const time_range = params.time_range;

	if (mode === "simple") {
		const one = await tavilySearchOnce(
			resolved,
			{
				query,
				max_results: limit,
				include_answer: includeAnswer,
				include_images: includeImages,
				topic,
				search_depth,
				...(include_domains ? { include_domains } : {}),
				...(exclude_domains ? { exclude_domains } : {}),
				...(time_range ? { time_range } : {}),
			},
			signal,
		);
		const results = rrfFuse([one.hits], limit, {
			queries: [query],
			keywords: basePlan.keywords,
		});
		return {
			v: 1,
			provider: "tavily",
			query,
			original_query: originalQuery,
			images: [],
			results,
			mode: "simple",
			plan: { ...basePlan, original_query: originalQuery, foundational_queries: [query] },
			...(one.response_time != null ? { response_time: one.response_time } : {}),
			total: results.length,
			...(wt ? { world_time: wt } : {}),
		};
	}

	const plan = { ...basePlan, original_query: originalQuery, foundational_queries: queries };
	const settled = await Promise.allSettled(
		plan.foundational_queries.map((q) =>
			tavilySearchOnce(
				resolved,
				{
					query: q,
					max_results: Math.min(12, Math.max(limit, 6)),
					include_answer: includeAnswer,
					include_images: includeImages,
					topic,
					search_depth,
					...(include_domains ? { include_domains } : {}),
					...(exclude_domains ? { exclude_domains } : {}),
					...(time_range ? { time_range } : {}),
				},
				signal,
			),
		),
	);

	const lists: SmartSearchHit[][] = [];
	let response_time: number | undefined;
	let errLast = "";
	for (const s of settled) {
		if (s.status === "fulfilled") {
			lists.push(s.value.hits);
			if (response_time == null && s.value.response_time != null) response_time = s.value.response_time;
		} else {
			errLast = s.reason instanceof Error ? s.reason.message : String(s.reason);
		}
	}
	if (lists.length === 0) throw new Error(errLast || "多路 Tavily 搜索全部失败");

	const results = rrfFuse(lists, limit, { queries: plan.foundational_queries, keywords: plan.keywords });
	return {
		v: 1,
		provider: "tavily",
		query,
		original_query: originalQuery,
		images: [],
		results,
		plan,
		mode: "multi",
		...(response_time != null ? { response_time } : {}),
		total: results.length,
		...(wt ? { world_time: wt } : {}),
	};
}

/** 对话/模型可见纯文本：时间锚点 + 多条 snippet（无 Tavily 简报、不附来源 URL） */
export function formatSearchPlain(data: SmartSearchResponse): string {
	const lines: string[] = [];
	const q = data.original_query && data.original_query !== data.query ? data.original_query : data.query;
	lines.push(`原始检索词：${q}`);
	if (data.plan?.foundational_queries.length) {
		lines.push(`执行检索词：${data.plan.foundational_queries.join(" ｜ ")}`);
	} else {
		lines.push(`执行检索词：${data.query}`);
	}
	if (data.world_time) {
		const wt = data.world_time;
		lines.push(
			`当前时间：${wt.datetime}（${wt.timezone}${wt.weekday_zh ? ` · ${wt.weekday_zh}` : ""}）`,
		);
	}
	const hits = data.results.slice(0, 10);
	if (hits.length === 0) {
		lines.push(`搜索「${q}」无网页结果。`);
	} else {
		for (let i = 0; i < hits.length; i++) {
			const h = hits[i]!;
			const snip = (h.snippet || h.content || "").replace(/\s+/g, " ").trim().slice(0, 280);
			const title = (h.title || "").replace(/\s+/g, " ").trim().slice(0, 80);
			const domain = h.domain ? ` [${h.domain}]` : "";
			if (title && snip) lines.push(`${i + 1}. ${title}${domain} — ${snip}`);
			else if (snip) lines.push(`${i + 1}. ${snip}`);
			else if (title) lines.push(`${i + 1}. ${title}`);
		}
	}
	return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}

/** 导出给工具说明：搜索前会自动取时 */
export function searchTimeNote(data: SmartSearchResponse): string {
	if (!data.world_time) return "";
	return formatWorldTimePlain({
		query: data.world_time.timezone,
		timezone: data.world_time.timezone,
		datetime: data.world_time.datetime,
		weekday: data.world_time.weekday_zh || "",
		timestamp_unix: 0,
		offset_seconds: 0,
		offset_string: "",
		...(data.world_time.date ? { date: data.world_time.date } : {}),
		...(data.world_time.year ? { year: data.world_time.year } : {}),
		...(data.world_time.weekday_zh ? { weekday_zh: data.world_time.weekday_zh } : {}),
	});
}
