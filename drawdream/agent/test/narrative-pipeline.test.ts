import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	formatDiceResult,
	formatWritingGuideForInject,
	parseDiceExpr,
	parseWritingGuide,
	resolvePipelineMode,
	rollDice,
	stableWindow,
} from "../src/narrative-pipeline.ts";
import { appendSummary, formatSummariesForInject, loadSummaries } from "../src/turn-summary.ts";

test("stableWindow: n+m 生长后截断", () => {
	const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
	// n=3 m=2 → 上限 5；超过后 splice(0, 3) 回到约 n
	assert.deepEqual(stableWindow(items.slice(0, 3), 3, 2), [1, 2, 3]);
	assert.deepEqual(stableWindow(items.slice(0, 5), 3, 2), [1, 2, 3, 4, 5]);
	assert.deepEqual(stableWindow(items.slice(0, 6), 3, 2), [4, 5, 6]);
	assert.deepEqual(stableWindow([], 3, 2), []);
	assert.deepEqual(stableWindow(items, 0, 2), []);
});

test("parseDiceExpr / rollDice 确定性", () => {
	assert.deepEqual(parseDiceExpr("1d20+5"), { count: 1, sides: 20, modifier: 5 });
	assert.equal(parseDiceExpr("bad"), null);

	let i = 0;
	const seq = [0.99, 0.0, 0.5]; // → 20, 1, 11 for d20
	const rng = () => seq[i++ % seq.length];
	const r = rollDice("1d20", "normal", { dc: 15, rng });
	assert.ok(!("error" in r));
	if ("error" in r) return;
	assert.equal(r.rolls[0], 20);
	assert.equal(r.critical, "success");
	assert.equal(r.success, true);
	assert.ok(formatDiceResult(r).includes("大成功"));
});

test("parseWritingGuide 宽容解析", () => {
	const g = parseWritingGuide(`
\`\`\`json
{"narrative_direction":"雨夜对峙","key_points":["摊牌","递刀"],"tool_calls":[{"tool":"roll_dice","params":{"expr":"1d20"}}],"text_recall":[1,2]}
\`\`\`
`);
	assert.ok(g);
	assert.equal(g.narrative_direction, "雨夜对峙");
	assert.deepEqual(g.key_points, ["摊牌", "递刀"]);
	assert.equal(g.tool_hints[0]?.tool, "roll_dice");
	assert.deepEqual(g.recall_queries, ["1", "2"]);
	assert.ok(formatWritingGuideForInject(g).includes("雨夜对峙"));
	assert.equal(parseWritingGuide("不是 json"), null);
});

test("resolvePipelineMode 默认 merged", () => {
	assert.equal(resolvePipelineMode({}), "merged");
	assert.equal(resolvePipelineMode({ pipeline: { mode: "off" } }), "off");
	assert.equal(resolvePipelineMode({ pipeline: { mode: "full" } }), "full");
	assert.equal(resolvePipelineMode({ pipeline: { mode: "weird" } }), "merged");
});

test("turn-summary 读写与裁剪", () => {
	const root = mkdtempSync(join(tmpdir(), "ly-sum-"));
	try {
		const sid = "sess-a";
		assert.deepEqual(loadSummaries(root, sid), []);
		appendSummary(root, sid, { text: "[第1轮] 用户意图：入住 | 叙事要点：青梧安排客房", turn: 1 }, 3);
		appendSummary(root, sid, { text: "[第2轮] 用户意图：玩笑 | 叙事要点：气氛尴尬", turn: 2 }, 3);
		appendSummary(root, sid, { text: "[第3轮] 用户意图：道歉 | 叙事要点：缓和", turn: 3 }, 3);
		const kept = appendSummary(root, sid, { text: "[第4轮] 用户意图：问价 | 叙事要点：议价", turn: 4 }, 3);
		assert.equal(kept.length, 3);
		assert.equal(kept[0].turn, 2);
		const text = formatSummariesForInject(kept);
		assert.ok(text.includes("第4轮"));
		assert.ok(!text.includes("第1轮"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
