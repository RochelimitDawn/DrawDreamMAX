import assert from "node:assert/strict";
import { test } from "node:test";
import {
	clearWorldTimeCache,
	fetchWorldTime,
	formatTimePanelTag,
	formatWorldTimePlain,
	normalizeWorldTime,
	resolveWorldTimeConfig,
	stampQueryWithWorldTime,
	type WorldTimeInfo,
} from "../src/world-time.ts";

test("resolveWorldTimeConfig defaults Asia/Shanghai", () => {
	const a = resolveWorldTimeConfig(undefined);
	assert.equal(a.baseUrl, "https://uapis.cn/api/v1");
	assert.equal(a.city, "Asia/Shanghai");
	const b = resolveWorldTimeConfig({ baseUrl: "https://x.example/", city: "Europe/London" });
	assert.equal(b.baseUrl, "https://x.example");
	assert.equal(b.city, "Europe/London");
});

test("normalizeWorldTime maps weekday and date", () => {
	const info = normalizeWorldTime(
		{
			query: "Asia/Shanghai",
			timezone: "Asia/Shanghai",
			datetime: "2026-07-19 13:52:39",
			weekday: "Sunday",
			timestamp_unix: 1784440359,
			offset_seconds: 28800,
			offset_string: "UTC8",
		},
		"Asia/Shanghai",
	);
	assert.equal(info.date, "2026-07-19");
	assert.equal(info.year, "2026");
	assert.equal(info.weekday_zh, "星期日");
	assert.equal(info.datetime, "2026-07-19 13:52:39");
});

test("stampQueryWithWorldTime anchors year without duplicating", () => {
	const info: WorldTimeInfo = {
		query: "Asia/Shanghai",
		timezone: "Asia/Shanghai",
		datetime: "2026-07-19 13:52:39",
		weekday: "Sunday",
		timestamp_unix: 1,
		offset_seconds: 28800,
		offset_string: "UTC8",
		date: "2026-07-19",
		year: "2026",
		weekday_zh: "星期日",
	};
	assert.match(stampQueryWithWorldTime("世界杯最新比分", info), /2026/);
	assert.match(stampQueryWithWorldTime("今天天气怎么样", info), /2026/);
	const already = stampQueryWithWorldTime("2024 奥运回顾", info);
	assert.equal(already, "2024 奥运回顾");
});

test("formatTimePanelTag emits timepanel JSON", () => {
	const info = normalizeWorldTime(
		{
			timezone: "Asia/Shanghai",
			datetime: "2026-07-19 13:52:39",
			weekday: "Sunday",
			timestamp_unix: 1,
			offset_seconds: 28800,
			offset_string: "UTC8",
		},
		"Asia/Shanghai",
	);
	const tag = formatTimePanelTag(info);
	assert.match(tag, /\[timepanel\]/);
	assert.match(tag, /\[\/timepanel\]/);
	assert.match(tag, /"provider":"uapi"/);
	assert.match(tag, /2026-07-19/);
	const plain = formatWorldTimePlain(info);
	assert.match(plain, /当前时间/);
	assert.match(plain, /2026/);
});

test("fetchWorldTime reuses the same city result within TTL", async () => {
	clearWorldTimeCache();
	const originalFetch = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		return new Response(JSON.stringify({
			timezone: "Asia/Shanghai",
			datetime: "2026-07-28 12:00:00",
			weekday: "Tuesday",
			timestamp_unix: 1,
			offset_seconds: 28800,
			offset_string: "UTC8",
		}), { status: 200 });
	}) as typeof fetch;
	try {
		await fetchWorldTime({ baseUrl: "https://time.test", city: "Asia/Shanghai" });
		await fetchWorldTime({ baseUrl: "https://time.test", city: "Asia/Shanghai" });
		assert.equal(calls, 1);
	} finally {
		globalThis.fetch = originalFetch;
		clearWorldTimeCache();
	}
});

test("stampQueryWithWorldTime uses ISO date for English queries", () => {
	const info = normalizeWorldTime({
		timezone: "Asia/Shanghai",
		datetime: "2026-07-28 12:00:00",
		weekday: "Tuesday",
		timestamp_unix: 1,
		offset_seconds: 28800,
		offset_string: "UTC8",
	}, "Asia/Shanghai");
	assert.equal(stampQueryWithWorldTime("latest React release", info), "2026-07-28 latest React release");
});
