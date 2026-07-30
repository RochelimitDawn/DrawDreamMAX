import assert from "node:assert/strict";
import { test } from "node:test";
import {
	formatSearchPlain,
	planSearchQueries,
	resolveSmartSearchConfig,
	rrfFuse,
	type SmartSearchHit,
	type SmartSearchResponse,
} from "../src/smart-search.ts";

test("resolveSmartSearchConfig defaults to Tavily", () => {
	const a = resolveSmartSearchConfig(undefined);
	assert.equal(a.enabled, true);
	assert.equal(a.apiKey, "");
	assert.equal(a.baseUrl, "https://api.tavily.com");
	assert.equal(a.mode, "simple");
	assert.equal(a.searchDepth, "basic");
	assert.equal(a.includeAnswer, false);
	assert.equal(a.includeImages, false);
	const b = resolveSmartSearchConfig({
		enabled: false,
		apiKey: "  tvly-k  ",
		baseUrl: "https://x.tavily.test/",
		mode: "multi",
		searchDepth: "advanced",
		topic: "news",
		includeAnswer: true,
		includeImages: true,
		maxQueries: 9,
	});
	assert.equal(b.enabled, false);
	assert.equal(b.apiKey, "tvly-k");
	assert.equal(b.baseUrl, "https://x.tavily.test");
	assert.equal(b.mode, "multi");
	assert.equal(b.searchDepth, "advanced");
	assert.equal(b.topic, "news");
	// 简报/配图永久关闭，配置 true 也强制 false
	assert.equal(b.includeAnswer, false);
	assert.equal(b.includeImages, false);
	assert.equal(b.maxQueries, 4);
});

test("planSearchQueries expands complex questions", () => {
	const simple = planSearchQueries("Go", 3);
	assert.equal(simple.assessed_complexity, "Simple");
	assert.deepEqual(simple.foundational_queries, ["Go"]);

	const complex = planSearchQueries("今天武汉天气怎么样", 3);
	assert.notEqual(complex.assessed_complexity, "Simple");
	assert.ok(complex.foundational_queries.length >= 2);
	assert.ok(complex.foundational_queries.some((q) => /天气|预报/.test(q)));
});

test("planSearchQueries covers bilingual official and freshness intents", () => {
	const plan = planSearchQueries("帮我查 React 19 最新官方文档和 release notes", 4);
	assert.ok(plan.foundational_queries.length >= 3);
	assert.ok(plan.foundational_queries.some((query) => /官网|官方文档/.test(query)));
	assert.ok(plan.foundational_queries.some((query) => /latest|official|release notes/i.test(query)));
	assert.ok(plan.languages?.includes("zh"));
	assert.ok(plan.languages?.includes("en"));
});

test("rrfFuse merges ranked lists by URL", () => {
	const a: SmartSearchHit[] = [
		{ title: "A1", url: "https://example.com/a", content: "a1" },
		{ title: "B1", url: "https://example.com/b", content: "b1" },
	];
	const b: SmartSearchHit[] = [
		{ title: "B2", url: "https://example.com/b?utm_source=x", content: "b2 longer content here" },
		{ title: "C1", url: "https://example.com/c", content: "c1" },
	];
	const fused = rrfFuse([a, b], 5);
	assert.ok(fused.length >= 3);
	const bHit = fused.find((h) => h.url.includes("/b"));
	assert.ok(bHit);
	assert.ok((bHit!.via?.length ?? 0) >= 2);
	assert.ok(bHit!.content.includes("longer") || bHit!.content.length >= 2);
});

test("rrfFuse normalizes mobile URLs and preserves result count after domain diversity", () => {
	const list: SmartSearchHit[] = [
		{ title: "A", url: "http://m.example.com/a?utm_source=x", content: "alpha" },
		{ title: "A copy", url: "https://www.example.com/a", content: "alpha copy" },
		{ title: "B", url: "https://example.com/b", content: "beta" },
		{ title: "C", url: "https://example.com/c", content: "gamma" },
	];
	const fused = rrfFuse([list], 3);
	assert.equal(fused.length, 3);
	assert.equal(fused.filter((hit) => /\/a/.test(hit.url)).length, 1);
});

test("rrfFuse deduplicates copied content across different URLs", () => {
	const copied = "This is the same sufficiently long article body copied by multiple websites for testing duplicate detection.";
	const fused = rrfFuse([
		[{ title: "Original", url: "https://a.example/story", content: copied }],
		[{ title: "Repost", url: "https://b.example/repost", content: copied }],
	], 5);
	assert.equal(fused.length, 1);
	assert.equal(fused[0]?.via?.length, 2);
});

test("formatSearchPlain uses snippets only, ignores answer brief", () => {
	const data: SmartSearchResponse = {
		v: 1,
		provider: "tavily",
		query: "Go",
		answer: "Go is a programming language.",
		images: [{ url: "https://example.com/go.png", description: "logo" }],
		mode: "simple",
		results: [
			{
				title: "The Go PL",
				url: "https://go.dev",
				content: "A language",
				domain: "go.dev",
				favicon: "https://go.dev/favicon.ico",
			},
		],
	};
	const plain = formatSearchPlain(data);
	// 简报永久关闭：不输出 answer，改用编号 snippet/title
	assert.doesNotMatch(plain, /Go is a programming language/);
	assert.match(plain, /1\.\s*The Go PL/);
	assert.match(plain, /原始检索词：Go/);
	assert.match(plain, /执行检索词：Go/);
	assert.match(plain, /A language/);
	assert.doesNotMatch(plain, /来源/);
	assert.doesNotMatch(plain, /https:\/\/go\.dev/);
	assert.doesNotMatch(plain, /searchpanel/);
});

test("runSmartSearch requires api key", async () => {
	const { runSmartSearch } = await import("../src/smart-search.ts");
	await assert.rejects(
		() => runSmartSearch({ enabled: true }, { query: "test", resolve_time: false }),
		/Tavily API Key|未配置/,
	);
});

test("resolveSmartSearchConfig always disables answer and images", async () => {
	const { resolveSmartSearchConfig } = await import("../src/smart-search.ts");
	const off = resolveSmartSearchConfig({ includeAnswer: false, includeImages: false });
	assert.equal(off.includeAnswer, false);
	assert.equal(off.includeImages, false);
	const on = resolveSmartSearchConfig({ includeAnswer: true, includeImages: true });
	assert.equal(on.includeAnswer, false);
	assert.equal(on.includeImages, false);
});

test("formatSearchPlain includes world_time anchor when present", () => {
	const data: SmartSearchResponse = {
		v: 1,
		provider: "tavily",
		query: "2026-07-19 世界杯",
		original_query: "世界杯",
		answer: "brief-should-be-ignored",
		images: [],
		mode: "simple",
		results: [
			{
				title: "决赛战报",
				url: "https://example.com/wc",
				content: "西班牙夺冠",
			},
		],
		world_time: {
			datetime: "2026-07-19 13:52:39",
			timezone: "Asia/Shanghai",
			year: "2026",
			date: "2026-07-19",
			weekday_zh: "星期日",
		},
	};
	const plain = formatSearchPlain(data);
	assert.match(plain, /当前时间/);
	assert.match(plain, /2026-07-19/);
	assert.match(plain, /西班牙夺冠/);
	assert.doesNotMatch(plain, /brief-should-be-ignored/);
	assert.doesNotMatch(plain, /searchpanel/);
});
