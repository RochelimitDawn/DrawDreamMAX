import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadCardFile } from "../src/card.ts";
import { activateTavernWorldInfo, assembleTavernPrompt, substituteTavernMacros } from "../src/tavern-prompt.ts";

const card = {
	name: "青梧",
	description: "角色设定",
	personality: "性格设定",
	scenario: "场景设定",
	firstMes: "开场",
	mesExample: "",
	systemPrompt: "系统：{{char}}与{{user}}",
	postHistoryInstructions: "末端：{{lastMessage}}",
	creatorNotes: "",
	 alternateGreetings: [],
	tags: [],
	book: [
		{ uid: 2, keys: ["b"], secondaryKeys: [], comment: "B", content: "世界 B", constant: false, enabled: true, selective: false, order: 20 },
		{ uid: 1, keys: ["a"], secondaryKeys: [], comment: "A", content: "世界 A", constant: false, enabled: true, selective: false, order: 10 },
	],
};

test("substituteTavernMacros resolves common macros and preserves unknown macros", () => {
	const result = substituteTavernMacros("{{char}}/{{user}}/{{lastMessage}}/{{messageCount}}/{{unknown}}", {
		charName: "青梧",
		userName: "旅人",
		lastMessage: "你好",
		messageCount: 4,
	});
	assert.equal(result.text, "青梧/旅人/你好/4/{{unknown}}");
	assert.equal(result.traces.length, 5);
	assert.equal(result.traces.at(-1)?.known, false);
});

test("assembleTavernPrompt uses deterministic section order and world-book order", () => {
	const result = assembleTavernPrompt({
		card,
		macro: { charName: "青梧", userName: "旅人", lastMessage: "最近一句" },
		persona: "Persona",
		history: "History",
		recentMessages: ["a b"],
		agent: "Agent tools",
	});
	assert.deepEqual(result.sections.map((section) => section.id), [
		"card-system", "character", "persona", "world-info", "history", "agent", "post-history",
	]);
	assert.ok(result.text.indexOf("世界 A") < result.text.indexOf("世界 B"));
	assert.ok(result.text.includes("末端：最近一句"));
	assert.ok(Array.isArray(result.regexTraces));
});

test("extended macro engine keeps legacy applyMacros behavior", () => {
	const result = substituteTavernMacros("{{char}}/{{user}}/{{date}}/{{time}}", {
		charName: "青梧",
		userName: "旅人",
		date: "2026-07-30",
		time: "12:34:56",
	});
	assert.equal(result.text, "青梧/旅人/2026-07-30/12:34:56");
	assert.ok(result.traces.every((trace) => trace.known));
});

test("activateTavernWorldInfo combines constants and recent keyword matches", () => {
	const entries = [
		{ uid: 1, keys: ["星门"], secondaryKeys: [], comment: "星门", content: "星门设定", constant: false, enabled: true, selective: false, order: 10 },
		{ uid: 2, keys: [], secondaryKeys: [], comment: "常驻", content: "常驻设定", constant: true, enabled: true, selective: false, order: 20 },
		{ uid: 3, keys: ["无关"], secondaryKeys: [], comment: "无关", content: "无关设定", constant: false, enabled: true, selective: false, order: 30 },
	];
	const result = activateTavernWorldInfo({ entries, recentMessages: ["旧消息", "星门开启"], scanDepth: 1, maxEntries: 3 });
	assert.deepEqual(result.entries.map((entry) => entry.content), ["常驻设定", "星门设定"]);
	assert.equal(result.scannedText, "星门开启");
});

test("Prompt Assembly includes depth prompt and author note after Agent section", () => {
	const result = assembleTavernPrompt({
		card,
		macro: { charName: "青梧", userName: "旅人" },
		history: "History",
		recentMessages: ["a b"],
		agent: "Agent",
		depthPrompt: "Depth",
		authorNote: "Author",
	});
	assert.deepEqual(result.sections.map((section) => section.id), [
		"card-system", "character", "world-info", "history", "agent", "depth-prompt", "author-note", "post-history",
	]);
});

test("Prompt Pipeline differential fixture: macro -> world info -> regex -> ordered output", () => {
	const fixture = {
		...card,
		name: "Pipeline Char",
		systemPrompt: "系统 {{char}} / {{user}} / {{lastMessage}}",
		postHistoryInstructions: "尾部 {{chatId}}",
		compat: {
			regexScripts: [{
				id: "pipeline-regex",
				scriptName: "标记清洗",
				findRegex: "/\\[secret:([^\\]]+)\\]/g",
				replaceString: "秘密:$1",
				trimStrings: [],
				placement: [4],
				disabled: false,
				markdownOnly: false,
				promptOnly: true,
				runOnEdit: true,
			}],
			unknownExtensions: {},
		},
	};
	const result = assembleTavernPrompt({
		card: fixture,
		macro: { charName: "Pipeline Char", userName: "旅人", lastMessage: "星门 [secret:开启]", chatId: "chat-42" },
		persona: "身份：{{user}}",
		recentMessages: ["星门 [secret:开启]"],
		worldInfo: [{ uid: 10, keys: ["星门"], secondaryKeys: [], comment: "星门", content: "星门设定 [secret:开启]", constant: false, enabled: true, selective: false, order: 10 }],
		history: "历史：{{lastMessage}}",
		depthPrompt: "深度：{{char}}",
		authorNote: "作者注：{{user}}",
		agent: "Agent",
	});
	assert.deepEqual(result.sections.map((section) => section.id), [
		"card-system", "character", "persona", "world-info", "history", "agent", "depth-prompt", "author-note", "post-history",
	]);
	assert.ok(result.text.includes("秘密:开启"));
	assert.ok(result.text.includes("系统 Pipeline Char / 旅人 / 星门 秘密:开启"));
	assert.ok(result.text.includes("尾部 chat-42"));
	assert.equal(result.regexTraces.filter((trace) => trace.matched).length, 3);
	assert.ok(result.macroTraces.filter((trace) => trace.known).length >= 7);
});

test("真实 PNG 角色卡保留 Runtime Manifest 的 Regex 与世界书入口", () => {
	const cardPath = fileURLToPath(new URL("../assets/cards/封神演义.png", import.meta.url));
	const loaded = loadCardFile(cardPath);
	assert.ok(loaded.runtimeManifest);
	assert.ok(loaded.book.length > 0);
	assert.ok(loaded.compat);
	const result = assembleTavernPrompt({
		card: loaded,
		macro: { charName: loaded.name, userName: "旅人", lastMessage: "朝歌" },
		recentMessages: ["朝歌"],
		history: "朝歌",
	});
	assert.ok(result.sections.length >= 1);
	assert.ok(Array.isArray(result.regexTraces));
});
