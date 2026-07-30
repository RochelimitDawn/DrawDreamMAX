import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDisplayRegexScripts, applyRegexScripts, normalizeCardRegexScripts } from "../src/card-regex.ts";
import { normalizeCard } from "../src/card.ts";

test("角色卡 extensions.regex_scripts 支持 ST 字段并进入兼容投影", () => {
	const card = normalizeCard({
		name: "Sera",
		extensions: {
			regex_scripts: [{
				script_name: "状态栏",
				find_regex: "<status>[\\s\\S]*?</status>",
				replace_string: "",
				placement: [2],
			}],
		},
	});
	assert.equal(card.compat?.regexScripts[0]?.scriptName, "状态栏");
	assert.equal(card.compat?.regexScripts[0]?.placement[0], 2);
});

test("显示期 regex 只处理 display placement，坏脚本不会阻断正文", () => {
	const scripts = normalizeCardRegexScripts([
		{ findRegex: "<status>[\\s\\S]*?</status>", replaceString: "", placement: [2] },
		{ findRegex: "<prompt>[\\s\\S]*?</prompt>", replaceString: "", placement: [1] },
		{ findRegex: "[", replaceString: "bad", placement: [2] },
	]);
	assert.equal(applyDisplayRegexScripts("<status>HP:10</status><prompt>x</prompt>正文", scripts), "<prompt>x</prompt>正文");
});

test("Prompt placement 支持捕获组、trim、深度和执行 trace", () => {
	const scripts = normalizeCardRegexScripts([{
		id: "prompt-1",
		scriptName: "prompt",
		findRegex: "Name: (\\w+)",
		replaceString: "Role: $1",
		trimStrings: ["REMOVE"],
		placement: [4],
		minDepth: 2,
		maxDepth: 4,
	}]);
	const result = applyRegexScripts("Name: Sera REMOVE", scripts, "prompt", { depth: 3 });
	assert.equal(result.text, "Role: Sera ");
	assert.equal(result.traces[0]?.matched, true);
	assert.equal(result.traces[0]?.placement, "prompt");
	assert.equal(applyRegexScripts("Name: Sera", scripts, "prompt", { depth: 1 }).text, "Name: Sera");
});
