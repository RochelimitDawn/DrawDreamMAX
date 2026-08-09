import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendSummary, formatSummariesForInject, loadSummaries } from "../src/turn-summary.ts";

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
