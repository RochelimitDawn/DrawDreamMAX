import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDisplayRegexScripts, applyRegexScripts, expandSkinReplacement, normalizeCardRegexScripts } from "../src/card-regex.ts";
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

test("expandSkinReplacement 不展开 $' / $` 特殊序列（程序卡 JS 字面量保护）", () => {
	// 用字符串拼接避免模板字符串嵌套反引号
	const template = "let a=\"$'\"; let b=\"$\" + String.fromCharCode(96) + \" 前文\"; {{match}}";
	const out = expandSkinReplacement(template, "MATCH", []);
	// $' 和 $` 必须原样保留（不落入 String.replace 语义）
	assert.ok(out.includes("$'"), "应保留 $' 字面量");
	assert.ok(out.includes("$"), "应保留 $ 字面量");
	assert.ok(out.includes("MATCH"), "{{match}} 应展开为匹配值");
});

test("expandSkinReplacement 短模板展开 $&，长模板保留字面 $&", () => {
	const short = expandSkinReplacement("prefix $& suffix", "HELLO", []);
	assert.equal(short, "prefix HELLO suffix");
	const longTemplate = `<div>${"x".repeat(9000)}</div>` + "$&";
	const long = expandSkinReplacement(longTemplate, "HELLO", []);
	assert.ok(long.includes("$&"), "长模板应保留字面 $&");
	assert.ok(!long.includes("HELLO"), "长模板不应展开 $& 为匹配串");
});

test("expandSkinReplacement 展开捕获组与宏", () => {
	const out = expandSkinReplacement("$1:{{char}}/{{user}}", "full", ["Sera"], { charName: "Sera", userName: "旅人" });
	assert.equal(out, "Sera:Sera/旅人");
});

test("applyDisplayRegexScripts 支持 {{char}}/{{user}} 宏展开", () => {
	const scripts = normalizeCardRegexScripts([{
		findRegex: "NAME",
		replaceString: "{{char}} 对 {{user}} 说",
		placement: [2],
	}]);
	const out = applyDisplayRegexScripts("NAME", scripts, { charName: "艾拉", userName: "阿明" });
	assert.equal(out, "艾拉 对 阿明 说");
});

test("大 replaceString（程序卡 UI HTML）不被 MAX_REPLACEMENT 丢弃", () => {
	const bigReplace = `<div style="color:red">${"x".repeat(20000)}</div>`;
	const scripts = normalizeCardRegexScripts([{
		scriptName: "状态栏",
		findRegex: "<StatusPlaceHolderImpl/>",
		replaceString: bigReplace,
		placement: [2],
	}]);
	assert.equal(scripts.length, 1, "大替换串脚本应被保留");
	assert.equal(scripts[0]?.replaceString.length, bigReplace.length);
});

test("markdownOnly 显示脚本在 applyDisplayRegexScripts 中被应用", () => {
	const scripts = normalizeCardRegexScripts([{
		scriptName: "状态栏",
		findRegex: "<StatusPlaceHolderImpl/>",
		replaceString: "<div class=\"soviet\">状态栏</div>",
		placement: [2],
		markdownOnly: true,
	}]);
	const out = applyDisplayRegexScripts("正文\n<StatusPlaceHolderImpl/>\n后文", scripts);
	assert.ok(out.includes("soviet"), "markdownOnly 显示脚本应替换占位符");
	assert.ok(!out.includes("StatusPlaceHolderImpl"), "占位符应被移除");
});
