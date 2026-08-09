import assert from "node:assert/strict";
import { test } from "node:test";

import {
	buildStagehandInjection,
	buildStagehandPrompt,
	buildStoryFloors,
	formatStoryRead,
	formatStorySearch,
	STORY_COMMANDS,
} from "../src/stagehand.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";

test("助手 system prompt：身份/工作语境/红线/作者工具/纪律齐备", () => {
	const sp = buildStagehandPrompt({ config: DEFAULT_CONFIG });
	assert.ok(sp.includes("DrawDream 助手") || sp.includes("助手"), "自称=助手");
	assert.ok(sp.includes("不参与扮演"), "身份切割：不扮演");
	assert.ok(sp.includes("叙事模型") || sp.includes("读写叙事"), "超集定位：能看叙事侧资产");
	assert.ok(sp.includes("工作语境"), "必须有工作语境段");
	assert.ok(sp.includes("虚构创作"), "库存定性=用户的虚构创作");
	assert.ok(sp.includes("失职"), "拒看库存=失职");
	assert.ok(sp.includes("硬限制") || sp.includes("红线"), "不得代写叙事正文");
	assert.ok(sp.includes("剧情消息流") || sp.includes("主对话"), "不塞进剧情流");
	assert.ok(sp.includes("/reroll"), "改稿的正确动作=调生产条件+重生成");
	assert.ok(sp.includes("panel_write"), "写面板");
	assert.ok(sp.includes("lorebook_write"), "写世界书");
	assert.ok(sp.includes("codex_") || sp.includes("codex_*") || sp.includes("知识库"), "知识库");
	assert.ok(sp.includes("card_create"), "创建角色卡");
	assert.ok(sp.includes("show_media"), "素材交付到助手对话");
	assert.ok(sp.includes("story_read"), "剧情记录工具");
	assert.ok(sp.includes("story_command"), "剧情命令工具");
	assert.ok(sp.includes("skill_save"), "技能沉淀归助手");
	assert.ok(sp.includes("world_time"), "助手应具备世界时间工具");
	assert.ok(sp.includes("smart_search"), "助手应具备联网搜索工具");
	assert.ok(sp.includes("本轮开关") || sp.includes("本轮联网"), "搜索说明应服从本轮结构化开关");
	assert.ok(sp.includes("60 秒") || sp.includes("时间锚点"), "搜索应说明复用短时世界时间");
	assert.ok(sp.includes("禁止") && sp.includes("凭记忆"), "禁止凭记忆回答实时事实");
	assert.ok(sp.includes("Markdown") || sp.includes("markdown"), "助手输出应引导 Markdown");
	assert.ok(
		sp.includes("禁用方括号") || sp.includes("方括号组件"),
		"助手与面板应明确禁用方括号组件 DSL",
	);
	assert.ok(sp.includes("输出格式") || sp.includes("panel_write"), "应有输出/面板说明");
	assert.ok(sp.includes("改前确认") || sp.includes("确认后执行"), "变更先确认");
	assert.ok(sp.includes(DEFAULT_CONFIG.language), "对话语言跟配置");
	assert.ok(sp.includes("svg") || sp.includes("SVG"), "地图优先 svg");
	assert.ok(sp.includes("设置 → 高级"), "无 Key 路径应指向设置→高级");
	for (const banned of ["检场", "幕后", "舞台监督", "戏外", "戏内"]) {
		assert.ok(!sp.includes(banned), `提示词不得出现「${banned}」`);
	}
});

test("助手 system prompt：backendControl=false 时不给本机工具段", () => {
	const on = buildStagehandPrompt({ config: { ...DEFAULT_CONFIG, backendControl: true } });
	const off = buildStagehandPrompt({ config: { ...DEFAULT_CONFIG, backendControl: false } });
	assert.ok(on.includes("本机：") || on.includes("bash"), "开启时提供本机工具");
	assert.ok(!off.includes("本机：") && !off.includes("bash / read"), "关闭时不提供本机工具段");
});

test("剧情快照注入：模型/占用/独立模型标注", () => {
	const base = {
		sessionId: "abcdef1234567890",
		cardName: "青梧",
		userName: "旅人",
		model: { provider: "deepseek", id: "deepseek-chat" },
		contextPercent: 42.6,
		messageCount: 12,
		streaming: false,
	};
	const s = buildStagehandInjection(base);
	assert.ok(s.includes("【剧情快照】"));
	assert.ok(s.includes("abcdef12"));
	assert.ok(s.includes("deepseek/deepseek-chat"));
	assert.ok(s.includes("43%"));
	assert.ok(!s.includes("你自己运行在"), "跟随模式不标注独立模型");

	const solo = buildStagehandInjection({
		...base,
		streaming: true,
		assistantModel: { provider: "xai", id: "grok-4" },
		assistantFollows: false,
	});
	assert.ok(solo.includes("排队") || solo.includes("生成中"), "生成中要提示排队语义");
	assert.ok(solo.includes("xai/grok-4"));

	const web = buildStagehandInjection(base, "帮我查一下今天世界杯最新比分", true);
	assert.ok(web.includes("必须") || web.includes("强制"), "联网检索意愿应升格强制");
	assert.ok(web.includes("smart_search"));
	assert.ok(web.includes("无需为同一轮重复调用 world_time"), "应复用短时世界时间");
	const switchedOff = buildStagehandInjection(base, "帮我查一下今天世界杯最新比分", false);
	assert.ok(!switchedOff.includes("本轮已开启联网搜索"), "关闭本轮开关后不应强制搜索");
	const plain = buildStagehandInjection(base, "帮我看一下当前配置的 scanDepth");
	assert.ok(!plain.includes("smart_search") || !plain.includes("先单独"), "配置类问题不应强制搜索");
});

const msgs = [
	{ role: "custom", customType: "rp-greeting", display: true, content: "【开场 · 青梧】她立在檐下。" },
	{ role: "user", content: "我走近she。" },
	{ role: "assistant", content: [{ type: "text", text: "先查设定" }, { type: "toolCall", id: "t1" }] },
	{
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "推演一下走位" },
			{ type: "text", text: "<draft_notes>草稿</draft_notes>\n她抬头，檐水正落。" },
		],
	},
	{ role: "user", content: "//帮我看看配置" },
	{ role: "assistant", content: "已看完配置。" },
	{ role: "user", content: "第二天呢？" },
	{ role: "assistant", content: "翌日晴。" },
];

test("楼层视图：编号与前端一致，场外轮与工具中间轮不占层", () => {
	const floors = buildStoryFloors(msgs);
	assert.deepEqual(
		floors.map((f) => [f.floor, f.kind]),
		[
			[1, "开场白"],
			[2, "用户"],
			[3, "回复"],
			[4, "用户"],
			[5, "回复"],
		],
	);
	// display 视图剥脚手架
	assert.ok(!floors[2].text.includes("draft_notes"));
	assert.ok(floors[2].text.includes("檐水"));
	// raw 视图保留原文与思维链
	const raw = buildStoryFloors(msgs, "raw");
	assert.ok(raw[2].text.includes("<draft_notes>"));
	assert.equal(raw[2].thinking, "推演一下走位");
});

test("story_read：默认取尾部、from/to 区间、超长截断", () => {
	const tail = formatStoryRead(msgs, { last: 2 });
	assert.ok(tail.includes("#4"));
	assert.ok(tail.includes("#5"));
	assert.ok(!tail.includes("#1【"));

	const range = formatStoryRead(msgs, { from: 1, to: 2 });
	assert.ok(range.includes("#1"));
	assert.ok(range.includes("#2"));
	assert.ok(!range.includes("#3【"));

	const clipped = formatStoryRead(
		[{ role: "user", content: `开头${"很长".repeat(400)}结尾` }],
		{ maxChars: 200 },
	);
	assert.ok(clipped.includes("截断"));

	assert.ok(formatStoryRead([]).includes("为空"));
});

test("story_search：命中给楼层与摘录，未命中如实说", () => {
	const hit = formatStorySearch(msgs, "檐水");
	assert.ok(hit.includes("#3"));
	assert.ok(hit.includes("檐水"));
	const miss = formatStorySearch(msgs, "不存在的词");
	assert.ok(miss.includes("未命中"));
});

test("story_command 白名单包含核心剧情命令", () => {
	for (const c of ["reroll", "rewind", "compact"]) {
		assert.ok((STORY_COMMANDS as readonly string[]).includes(c));
	}
});
