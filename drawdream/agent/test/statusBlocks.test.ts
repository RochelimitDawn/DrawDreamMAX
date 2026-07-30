import assert from "node:assert/strict";
import { test } from "node:test";

import {
	looksLikeYamlBlock,
	splitStatusParts,
	statusLabel,
	stripOrphanStatusTags,
	stripYamlFence,
} from "../web/src/statusBlocks.ts";

test("splitStatusParts: StatusBlock 抽出面板，正文不带标签字样", () => {
	const text = `文舒婉听话了。\n\n<StatusBlock>\n地点:御书房\n姓名:文舒婉\n</StatusBlock>`;
	const p = splitStatusParts(text);
	assert.equal(p.length, 2);
	assert.equal(p[0].kind, "text");
	if (p[0].kind === "text") {
		assert.ok(p[0].text.includes("文舒婉听话了"));
		assert.ok(!p[0].text.includes("StatusBlock"));
		assert.ok(!p[0].text.includes("<"));
	}
	assert.equal(p[1].kind, "status");
	if (p[1].kind === "status") {
		assert.equal(statusLabel(p[1].tag), "状态");
		assert.ok(p[1].body.includes("地点:御书房"));
		assert.ok(!p[1].body.includes("<StatusBlock>"));
	}
});

test("stripOrphanStatusTags 删残留标签", () => {
	assert.equal(stripOrphanStatusTags("前</StatusBlock>后"), "前后");
	assert.ok(!stripOrphanStatusTags("<StatusBlock>\nx").includes("StatusBlock") || stripOrphanStatusTags("<StatusBlock>\nx").includes("x"));
});

test("looksLikeYamlBlock / stripYamlFence", () => {
	assert.equal(looksLikeYamlBlock("```yaml\na: 1\nb: 2\n```"), true);
	assert.equal(stripYamlFence("```yaml\na: 1\n```"), "a: 1");
});
