/**
 * 世界时间 — UAPI GET /misc/worldtime
 * https://uapis.cn/docs/api-reference/get-misc-worldtime
 *
 * 免费免 Key。默认 Asia/Shanghai。
 * 供 world_time 工具与 smart_search 默认前置取时。
 */

export type WorldTimeConfig = {
	/** 默认 https://uapis.cn/api/v1 */
	baseUrl?: string;
	/** IANA 时区，默认 Asia/Shanghai */
	city?: string;
};

export type WorldTimeInfo = {
	query: string;
	timezone: string;
	datetime: string;
	weekday: string;
	timestamp_unix: number;
	offset_seconds: number;
	offset_string: string;
	/** 解析出的本地日历日 YYYY-MM-DD */
	date?: string;
	/** 本地年 YYYY */
	year?: string;
	/** 展示用中文星期（若 API 已是英文则映射） */
	weekday_zh?: string;
};

const DEFAULT_BASE = "https://uapis.cn/api/v1";
const DEFAULT_CITY = "Asia/Shanghai";
const DEFAULT_CACHE_MS = 60_000;
const timeCache = new Map<string, { at: number; info: WorldTimeInfo }>();

const WEEKDAY_ZH: Record<string, string> = {
	sunday: "星期日",
	monday: "星期一",
	tuesday: "星期二",
	wednesday: "星期三",
	thursday: "星期四",
	friday: "星期五",
	saturday: "星期六",
	sun: "星期日",
	mon: "星期一",
	tue: "星期二",
	wed: "星期三",
	thu: "星期四",
	fri: "星期五",
	sat: "星期六",
};

export function resolveWorldTimeConfig(cfg?: WorldTimeConfig | null): { baseUrl: string; city: string } {
	const base = (cfg?.baseUrl || DEFAULT_BASE).trim().replace(/\/+$/, "") || DEFAULT_BASE;
	const city = (cfg?.city || DEFAULT_CITY).trim() || DEFAULT_CITY;
	return { baseUrl: base, city };
}

function pickString(v: unknown): string {
	return typeof v === "string" ? v.trim() : "";
}

function weekdayZh(raw: string): string {
	const k = raw.trim().toLowerCase();
	return WEEKDAY_ZH[k] || raw;
}

export function normalizeWorldTime(json: unknown, fallbackCity: string): WorldTimeInfo {
	const o = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
	const datetime = pickString(o.datetime);
	const timezone = pickString(o.timezone) || pickString(o.query) || fallbackCity;
	const query = pickString(o.query) || timezone;
	const weekday = pickString(o.weekday);
	const timestamp_unix = typeof o.timestamp_unix === "number" ? o.timestamp_unix : 0;
	const offset_seconds = typeof o.offset_seconds === "number" ? o.offset_seconds : 0;
	const offset_string = pickString(o.offset_string) || (offset_seconds ? `UTC${offset_seconds / 3600}` : "");
	const date = datetime.length >= 10 ? datetime.slice(0, 10) : undefined;
	const year = date ? date.slice(0, 4) : undefined;
	return {
		query,
		timezone,
		datetime,
		weekday,
		timestamp_unix,
		offset_seconds,
		offset_string,
		...(date ? { date } : {}),
		...(year ? { year } : {}),
		...(weekday ? { weekday_zh: weekdayZh(weekday) } : {}),
	};
}

export async function fetchWorldTime(
	cfg?: WorldTimeConfig | null,
	params?: { city?: string; maxAgeMs?: number },
	signal?: AbortSignal,
): Promise<WorldTimeInfo> {
	const resolved = resolveWorldTimeConfig(cfg);
	const city = (params?.city || resolved.city).trim() || DEFAULT_CITY;
	const cacheKey = `${resolved.baseUrl}\0${city}`;
	const maxAgeMs = Math.max(0, params?.maxAgeMs ?? DEFAULT_CACHE_MS);
	const cached = timeCache.get(cacheKey);
	if (cached && Date.now() - cached.at <= maxAgeMs) return cached.info;
	const url = `${resolved.baseUrl}/misc/worldtime?city=${encodeURIComponent(city)}`;
	const res = await fetch(url, {
		method: "GET",
		headers: { accept: "application/json" },
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
		const msg = text.slice(0, 300) || res.statusText;
		throw new Error(`世界时间查询失败 HTTP ${res.status}：${msg}`);
	}
	const info = normalizeWorldTime(json, city);
	if (!info.datetime) throw new Error("世界时间响应缺少 datetime");
	timeCache.set(cacheKey, { at: Date.now(), info });
	return info;
}

export function clearWorldTimeCache(): void {
	timeCache.clear();
}

/** 给模型的纯文本 */
export function formatWorldTimePlain(info: WorldTimeInfo): string {
	const wd = info.weekday_zh || info.weekday;
	const lines = [
		`【当前时间】${info.datetime}${wd ? `（${wd}）` : ""}`,
		`时区：${info.timezone}${info.offset_string ? ` · ${info.offset_string}` : ""}`,
	];
	if (info.year) {
		lines.push(`日历年：${info.year}（构造「最新/今天」类检索词时请用此年，勿用过时年份）`);
	}
	if (info.timestamp_unix) lines.push(`Unix：${info.timestamp_unix}`);
	return lines.join("\n");
}

/**
 * 对话展示：专用 RP 标签，正文为 JSON。
 * 前端 TimePanel 解析渲染。
 */
export function formatTimePanelTag(info: WorldTimeInfo): string {
	const payload = {
		v: 1 as const,
		provider: "uapi" as const,
		timezone: info.timezone,
		datetime: info.datetime,
		...(info.weekday ? { weekday: info.weekday } : {}),
		...(info.weekday_zh ? { weekday_zh: info.weekday_zh } : {}),
		...(info.date ? { date: info.date } : {}),
		...(info.year ? { year: info.year } : {}),
		...(info.offset_string ? { offset: info.offset_string } : {}),
		...(info.timestamp_unix ? { timestamp_unix: info.timestamp_unix } : {}),
	};
	return `[timepanel]\n${JSON.stringify(payload)}\n[/timepanel]`;
}

/**
 * 把当前日期/年份锚进搜索 query，避免模型用 2025 等过时年份。
 * 若 query 已含 20xx 年或「今天/今日」等，尽量只补年份上下文前缀。
 */
export function stampQueryWithWorldTime(query: string, info: WorldTimeInfo): string {
	const q = query.replace(/\s+/g, " ").trim();
	if (!q || !info.year) return q;
	const hasYear = /\b20\d{2}\b/.test(q);
	const hasToday = /(今天|今日|本日|最新|实时|本周|本月|今年|current|today|latest|this\s+week)/i.test(q);
	if (hasYear) return q;
	// 前缀时间锚点，便于 Tavily 与模型对齐「现在」
	const hasChinese = /[\u3400-\u9fff]/.test(q);
	if (hasToday) {
		const anchor = hasChinese ? `${info.year}年${info.date ? info.date.slice(5) : ""}` : info.date || info.year;
		return `${anchor} ${q}`.replace(/\s+/g, " ").trim();
	}
	return `${info.date || info.year} ${q}`;
}
