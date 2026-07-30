/**
 * parse-rp 自测（独立可跑，避免 vite 路径依赖）
 * node --experimental-strip-types agent/test/parse-rp.compat.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 通过动态 import + 显式 .ts 扩展（node strip-types）
const root = join(dirname(fileURLToPath(import.meta.url)), "../../src/agent/rp");

const { parseRpText, splitChoiceOptions } = await import(
	pathToFileURL(join(root, "parse-rp.ts")).href
);

test("splitChoiceOptions: 【甲】…【乙】…", () => {
	const opts = splitChoiceOptions(
		"【世外散修】游离于阐截之外，偶经朝歌【朝歌客卿】受上大夫比干举荐入朝【无名剑客】云游四海】】",
	);
	assert.equal(opts.length, 3);
	assert.ok(opts[0].includes("世外散修"));
	assert.ok(opts[2].includes("无名剑客"));
});

test("parse: scene + StatusBlock + bare ask_director", () => {
	// 与会话实录一致：ask_director 开标签常缺结尾 >
	const sample = `<scene title="朝歌·九间殿">

纣王端坐龙书案前。

</scene>

<StatusBlock>
地点: 朝歌·九间殿
时间: 纣王七年·春·朝会
关键人物: 帝辛(纣王)、云中子(终南山炼气士)、旅人
当前事件: 云中子献松木剑除妖，纣王当殿问旅人来历
</StatusBlock>

旅人——你当如何作答？

<ask_director question="纣王当殿问名，满朝文武皆瞩目于你——你以何等身份立于九间殿？" options="【世外散修】游离于阐截之外，偶经朝歌，见妖气冲天，特来一观究竟【朝歌客卿】受上大夫比干举荐入朝，因通晓方术，暂居馆驿【无名剑客】云游四海之士，身负奇术，昨日入城投宿，不知何故被宣入殿】】`;

	const parts = parseRpText(sample);
	const kinds = parts.map((p: { kind: string }) => p.kind);
	assert.ok(kinds.includes("scene"), kinds.join(","));
	assert.ok(kinds.includes("status"), kinds.join(","));
	assert.ok(kinds.includes("choice"), kinds.join(","));

	const scene = parts.find((p: { kind: string }) => p.kind === "scene");
	assert.equal(scene.title, "朝歌·九间殿");
	assert.ok(scene.body.includes("纣王"));

	const choice = parts.find((p: { kind: string }) => p.kind === "choice");
	assert.ok(choice.question.includes("九间殿"));
	assert.equal(choice.options.length, 3);

	const textJoin = parts
		.filter((p: { kind: string }) => p.kind === "text")
		.map((p: { text: string }) => p.text)
		.join("");
	assert.ok(!textJoin.includes("<ask_director"));
});

test("parse: scene without title still keeps body", () => {
	const parts = parseRpText("<scene>\n*雨声渐渐小了。*\n</scene>");
	const scene = parts.find((p: { kind: string }) => p.kind === "scene");
	assert.ok(scene);
	assert.ok(scene.body.includes("雨声"));
});

test("parse: ask_director with closed tag and 【选项】", () => {
	const sample = `残灵已入洞府。
<ask_director question="残灵已入洞府——先取何物？" options="【取紫金葫芦】壁上葫芦疑藏灵丹，先取试试【借碧浆凝形】案角铜鼎碧浆未凝，残灵浸入其中，或可借药力重塑灵体【附炉火温养】先不取物，直入炉火，借丹炉余温稳住残灵，再图后计"></ask_director>`;
	const parts = parseRpText(sample);
	const choice = parts.find((p: { kind: string }) => p.kind === "choice") as {
		kind: string;
		question: string;
		options: string[];
	};
	assert.ok(choice, parts.map((p: { kind: string }) => p.kind).join(","));
	assert.ok(choice.question.includes("先取何物"));
	assert.equal(choice.options.length, 3);
	assert.ok(choice.options[0].includes("紫金葫芦"));
	const textJoin = parts
		.filter((p: { kind: string }) => p.kind === "text")
		.map((p: { text: string }) => p.text)
		.join("");
	assert.ok(!/ask_director/i.test(textJoin));
});

test("parse: ask_director garbage tail 】]>", () => {
	const sample = `<ask_director question="残灵飘忽，去往何方？" options="【轩辕坟】投奔同族【终南山】最险处【三山关】投军【东海·金鳌岛】直赴截教】]>`;
	const parts = parseRpText(sample);
	const choice = parts.find((p: { kind: string }) => p.kind === "choice") as {
		options: string[];
		question: string;
	};
	assert.ok(choice);
	assert.ok(choice.question.includes("去往何方"));
	assert.equal(choice.options.length, 4);
});

test("splitChoiceOptions: 短标题——说明 粘连串拆成多卡", () => {
	const raw =
		"直陈——坦言来意，不绕弯子。隐锋——话里藏针，先试探对方。借势——借朝堂之口递话。问路——只问路径，不交底牌";
	const opts = splitChoiceOptions(raw);
	assert.equal(opts.length, 4, opts.join(" | "));
	assert.ok(opts[0]!.includes("直陈"));
	assert.ok(opts[1]!.includes("隐锋"));
	assert.ok(opts[2]!.includes("借势"));
	assert.ok(opts[3]!.includes("问路"));
});

test("parse: ask_director options 为 标题—— 粘连", () => {
	const sample = `<ask_director question="当殿对答，你如何开口？" options="直陈——坦言来意。隐锋——话里藏针。借势——借朝堂之口。问路——只问路径"></ask_director>`;
	const parts = parseRpText(sample);
	const choice = parts.find((p: { kind: string }) => p.kind === "choice") as {
		options: string[];
	};
	assert.ok(choice);
	assert.equal(choice.options.length, 4, choice.options.join(" | "));
});

test("parse: 完整 RP 标签在流式与最终状态下同构", () => {
	const sample = "<char>神崎遥</char>台词<innervoice>别回头</innervoice>[clue title:钥匙]黄铜钥匙[/clue][quest title:寻人]找到阿远[/quest]";
	assert.deepEqual(
		parseRpText(sample, { streaming: true, inferFreeformChoice: false }),
		parseRpText(sample, { inferFreeformChoice: false }),
	);
	assert.deepEqual(
		parseRpText(sample, { inferFreeformChoice: false }).map((part: { kind: string }) => part.kind),
		["char", "text", "voice", "widget", "widget"],
	);
});

test("parse: 流式未闭合 RP 容器暂存到闭合后一次提交", () => {
	const prefixes = [
		"<char>",
		"<char>神崎遥</ch",
		"[clue title:钥匙]",
		"[clue title:钥匙]黄铜钥匙[/cl",
	];
	for (const prefix of prefixes) {
		assert.deepEqual(parseRpText(prefix, { streaming: true, inferFreeformChoice: false }), []);
	}
	assert.equal(parseRpText("<char>神崎遥</char>", { streaming: true })[0]?.kind, "char");
	assert.equal(parseRpText("[clue title:钥匙]黄铜钥匙[/clue]", { streaming: true })[0]?.kind, "widget");
});

test("parse: RP 组合文本的所有流式前缀都不泄露标签壳", () => {
	const sample = "<char>神崎遥</char>台词<innervoice>别回头</innervoice>[clue title:钥匙]黄铜钥匙[/clue][quest title:寻人]找到阿远[/quest]";
	for (let i = 1; i <= sample.length; i++) {
		const parts = parseRpText(sample.slice(0, i), {
			streaming: true,
			inferFreeformChoice: false,
		});
		const rawText = parts
			.filter((part: { kind: string }) => part.kind === "text")
			.map((part: { text: string }) => part.text)
			.join("");
		assert.doesNotMatch(rawText, /<\/?(?:char|innervoice)|\[\/?(?:clue|quest)/i, `prefix=${i}: ${rawText}`);
	}
});
