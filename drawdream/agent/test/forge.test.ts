import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { chunkNovel, selectChunkIndices } from "../src/forge/chunker.ts";
import { estimateForgeJob, recommendForgeMode } from "../src/forge/estimate.ts";
import { mergeCast, mergeLore, pickDefaultProtagonist } from "../src/forge/reduce.ts";
import { cardToV2Json, loreDraftsToEntries, materializeForgeAssets } from "../src/forge/materialize.ts";
import {
	createJob,
	defaultCastSelection,
	deleteJob,
	loadCastSelection,
	loadJob,
	saveCastSelection,
} from "../src/forge/job-store.ts";
import { classifyForgeError } from "../src/forge/types.ts";
import { DEFAULT_CONFIG, type CharacterCard } from "../src/types.ts";
import { normalizeCard } from "../src/card.ts";
import { loadLorebookFile } from "../src/lorebook.ts";

test("chunker：章节标题切分", () => {
	const text = [
		"前言一点点",
		"第一章 初入江湖",
		"甲乙丙丁".repeat(20),
		"第二章 风云再起",
		"戊己庚辛".repeat(20),
		"第三章 决战",
		"壬癸".repeat(30),
	].join("\n");
	const pieces = chunkNovel(text, { chunkChars: 5000, chunkOverlap: 50 });
	assert.ok(pieces.length >= 3);
	assert.ok(pieces.some((p) => p.meta.title?.includes("第一章")));
});

test("chunker：字数窗口与采样", () => {
	const body = "角色韩立在七玄门修炼。".repeat(400);
	const pieces = chunkNovel(body, { chunkChars: 200, chunkOverlap: 20 });
	assert.ok(pieces.length > 5);
	const idx = selectChunkIndices(pieces.length, "quick", 5);
	assert.equal(idx.length, 5);
	assert.equal(idx[0], 0);
	assert.equal(idx[idx.length - 1], pieces.length - 1);
	const all = selectChunkIndices(3, "standard", 2);
	assert.deepEqual(all, [0, 1, 2]);
});

test("reduce：别名合并与主角默认", () => {
	const cast = mergeCast([
		[
			{ name: "韩立", aliases: ["韩师兄"], roleHint: "主角", traits: ["冷静"], count: 3, chunks: [0, 1] },
			{ name: "张铁", aliases: [], roleHint: "配角", traits: [], count: 1, chunks: [0] },
		],
		[
			{ name: "韩师兄", aliases: ["韩立"], roleHint: "", traits: ["谨慎"], count: 2, chunks: [2] },
		],
	]);
	const han = cast.find((c) => c.name === "韩立" || c.aliases.includes("韩立"));
	assert.ok(han);
	assert.ok(han!.count >= 5);
	assert.ok(han!.chunks.includes(2));
	assert.equal(pickDefaultProtagonist(cast), han!.name);

	const lore = mergeLore([
		[{ title: "七玄门", keys: ["七玄门"], content: "小门派", constant: false, order: 100 }],
		[{ title: "七玄门", keys: ["七玄"], content: "小门派", constant: false, order: 100 }],
		[{ title: "总纲", keys: ["世界"], content: "修仙世界", constant: true, order: 10 }],
	]);
	assert.ok(lore[0].constant);
	assert.ok(lore.filter((e) => e.title === "七玄门").length <= 1);
});

test("materialize：写卡写书", () => {
	const cwd = mkdtempSync(join(tmpdir(), "forge-mat-"));
	const card: CharacterCard = {
		name: "韩立",
		description: "修仙者",
		personality: "冷静",
		scenario: "测试场景",
		firstMes: "你好",
		mesExample: "",
		systemPrompt: "扮演韩立",
		postHistoryInstructions: "",
		creatorNotes: "test",
		alternateGreetings: [],
		tags: ["novel-forge"],
		book: [],
	};
	const result = materializeForgeAssets({
		cwd,
		card,
		loreDrafts: [
			{ title: "总纲", keys: ["总纲"], content: "修仙世界", constant: true, order: 10 },
			{ title: "韩立", keys: ["韩立"], content: "主角", constant: false, order: 100 },
		],
		config: { ...DEFAULT_CONFIG, card: "", lorebooks: [] },
		switchCard: true,
		mountLore: true,
		bookName: "凡人-世界书",
	});
	assert.ok(result.cardPath.startsWith("assets/cards/"));
	assert.ok(result.lorebookPath.startsWith("assets/lorebooks/"));
	assert.equal(result.config.card, result.cardPath);
	assert.ok(result.config.lorebooks?.includes(result.lorebookPath));
	const loaded = normalizeCard(JSON.parse(readFileSync(join(cwd, result.cardPath), "utf8")));
	assert.equal(loaded.name, "韩立");
	const entries = loadLorebookFile(join(cwd, result.lorebookPath));
	assert.equal(entries.length, 2);
	assert.ok(loreDraftsToEntries([{ title: "a", keys: ["a"], content: "b", constant: false, order: 1 }]).length === 1);
	assert.equal((cardToV2Json(card).spec as string), "chara_card_v2");
	assert.deepEqual(result.extraCardPaths, []);
	writeFileSync(join(cwd, "ok"), "1");
});

test("estimate：标准档调用量高于快扫", () => {
	const q = estimateForgeJob({ sourceChars: 200_000, mode: "quick", sampleChunks: 24 });
	const s = estimateForgeJob({ sourceChars: 200_000, mode: "standard" });
	const d = estimateForgeJob({ sourceChars: 200_000, mode: "deep", extraCards: 3 });
	assert.ok(q.mapCalls <= 24);
	assert.ok(s.mapCalls > q.mapCalls);
	assert.ok(d.elevateCalls >= s.elevateCalls + 1);
	assert.ok(d.totalCalls > q.totalCalls);
	assert.ok((d.outlineCalls ?? 0) > 0);
	assert.equal(q.outlineCalls ?? 0, 0);
	const dUserOl = estimateForgeJob({
		sourceChars: 200_000,
		mode: "deep",
		hasUserOutline: true,
	});
	assert.equal(dUserOl.outlineCalls, 0);
	assert.ok(q.note.includes("quick"));
	assert.ok(q.recommendedMode);
	assert.ok(q.recommendReason.length > 0);
});

test("recommend：短篇快扫、中篇标准、长篇快扫", () => {
	assert.equal(recommendForgeMode(8_000).mode, "quick");
	const midChapters = Array.from({ length: 12 }, (_, i) => `第${i + 1}章 标题\n正文`.repeat(50)).join("\n");
	const mid = recommendForgeMode(100_000, midChapters);
	assert.equal(mid.mode, "standard");
	assert.equal(recommendForgeMode(600_000).mode, "quick");
	const est = estimateForgeJob({
		sourceChars: 100_000,
		mode: "quick",
		textSample: midChapters,
	});
	assert.equal(est.recommendedMode, "standard");
	assert.ok(est.note.includes("智能推荐") || est.recommendReason.length > 0);
});

test("job-store：删除任务目录", () => {
	const cwd = mkdtempSync(join(tmpdir(), "forge-del-"));
	const meta = createJob(cwd, {
		sourceName: "t.txt",
		sourceText: "第一章 测试\n韩立走过山门。".repeat(5),
		options: { mode: "quick", title: "测" },
	});
	assert.ok(loadJob(cwd, meta.id));
	assert.equal(deleteJob(cwd, meta.id), true);
	assert.equal(loadJob(cwd, meta.id), null);
});

test("classifyForgeError：超时 / JSON / 额度", () => {
	assert.equal(classifyForgeError("Request timed out after 120s"), "timeout");
	assert.equal(classifyForgeError("无法从模型输出解析 JSON"), "json");
	assert.equal(classifyForgeError("HTTP 429 rate limit exceeded"), "quota");
	assert.equal(classifyForgeError("something else"), "unknown");
});

test("outline：用户大纲解析与上下文", async () => {
	const { parseUserOutlineText, outlineToPromptContext, shouldEnableOutline } = await import(
		"../src/forge/outline.ts"
	);
	assert.equal(shouldEnableOutline("deep", undefined), true);
	assert.equal(shouldEnableOutline("quick", undefined), false);
	assert.equal(shouldEnableOutline("quick", true), true);
	const draft = parseUserOutlineText("第一章 开端\n少年入门。\n第二章 冲突\n大敌当前。");
	assert.ok(draft.chapters.length >= 2);
	assert.equal(draft.source, "user");
	const ctx = outlineToPromptContext(draft, 500);
	assert.ok(ctx.includes("第一章") || ctx.includes("开端"));
});

test("cast selection：默认名单与读写", () => {
	const cwd = mkdtempSync(join(tmpdir(), "forge-sel-"));
	const meta = createJob(cwd, {
		sourceName: "t.txt",
		sourceText: "第一章 测试\n韩立走过山门。".repeat(5),
		options: { mode: "quick", title: "测" },
	});
	const cast = [
		{ name: "韩立", aliases: [], roleHint: "主角", traits: [], count: 3, chunks: [0] },
		{ name: "张铁", aliases: [], roleHint: "配角", traits: [], count: 1, chunks: [0] },
	];
	const def = defaultCastSelection(cast, "韩立");
	assert.equal(def.protagonist, "韩立");
	assert.ok(def.selected.includes("韩立"));
	saveCastSelection(cwd, meta.id, {
		protagonist: "韩立",
		selected: ["韩立", "张铁"],
		renames: { 张铁: "铁子" },
		manual: ["南宫婉"],
	});
	const loaded = loadCastSelection(cwd, meta.id);
	assert.ok(loaded);
	assert.equal(loaded!.protagonist, "韩立");
	assert.deepEqual(loaded!.selected, ["韩立", "张铁"]);
	assert.equal(loaded!.renames["张铁"], "铁子");
	assert.ok(loaded!.manual.includes("南宫婉"));
});

test("elevate 版本快照与导出包", async () => {
	const {
		saveElevateDraftFull,
		snapshotElevateVersion,
		listElevateVersions,
		restoreElevateVersion,
		buildExportPack,
	} = await import("../src/forge/job-store.ts");
	const cwd = mkdtempSync(join(tmpdir(), "forge-ver-"));
	const meta = createJob(cwd, {
		sourceName: "t.txt",
		sourceText: "第一章 测试\n韩立走过山门。".repeat(5),
		options: { mode: "quick", title: "凡人" },
	});
	const card: CharacterCard = {
		name: "韩立",
		description: "v1",
		personality: "冷静",
		scenario: "s",
		firstMes: "hi",
		mesExample: "",
		systemPrompt: "sys",
		postHistoryInstructions: "",
		creatorNotes: "",
		alternateGreetings: [],
		tags: ["novel-forge"],
		book: [],
	};
	saveElevateDraftFull(cwd, meta.id, {
		card,
		lore: [{ title: "总纲", keys: ["总纲"], content: "修仙", constant: true, order: 10 }],
		extraCards: [],
	});
	const v1 = snapshotElevateVersion(cwd, meta.id);
	assert.equal(v1, 1);
	saveElevateDraftFull(cwd, meta.id, {
		card: { ...card, description: "v2-current" },
		lore: [{ title: "总纲", keys: ["总纲"], content: "修仙2", constant: true, order: 10 }],
	});
	const list = listElevateVersions(cwd, meta.id);
	assert.equal(list.length, 1);
	restoreElevateVersion(cwd, meta.id, 1, { snapshotCurrent: true });
	const list2 = listElevateVersions(cwd, meta.id);
	assert.ok(list2.length >= 2);
	const pack = buildExportPack(cwd, meta.id);
	assert.equal(pack.format, "drawdream-forge-pack");
	assert.ok((pack.draft as { card?: { name?: string } })?.card?.name === "韩立");
});

test("materialize：额外配角卡", () => {
	const cwd = mkdtempSync(join(tmpdir(), "forge-extra-"));
	const card: CharacterCard = {
		name: "韩立",
		description: "修仙者",
		personality: "冷静",
		scenario: "测试",
		firstMes: "你好",
		mesExample: "",
		systemPrompt: "扮演韩立",
		postHistoryInstructions: "",
		creatorNotes: "test",
		alternateGreetings: [],
		tags: ["novel-forge"],
		book: [],
	};
	const side: CharacterCard = {
		...card,
		name: "张铁",
		tags: ["novel-forge", "side-cast"],
	};
	const result = materializeForgeAssets({
		cwd,
		card,
		loreDrafts: [{ title: "总纲", keys: ["总纲"], content: "修仙", constant: true, order: 10 }],
		config: { ...DEFAULT_CONFIG, card: "", lorebooks: [] },
		extraCards: [side],
	});
	assert.equal(result.extraCardPaths.length, 1);
	assert.ok(result.extraCardPaths[0].includes("张铁"));
});
