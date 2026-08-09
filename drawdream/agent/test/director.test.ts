import assert from "node:assert/strict";
import { test } from "node:test";

import {
	buildSystemPrompt,
	buildTurnInjection,
	buildGreeting,
	detectsLanguageMismatch,
	looksLikeOpeningMenu,
	needsOpeningChoice,
	parseOpeningOptions,
	userSeeksDirection,
	userSeeksLongForm,
	userSeeksShortBeat,
	userSeeksWebSearch,
} from "../src/director.ts";
import { defaultState } from "../src/state.ts";
import { DEFAULT_CONFIG, type CharacterCard } from "../src/types.ts";

const card: CharacterCard = {
	name: "青梧",
	description: "听雨轩的掌柜 {{char}}。",
	personality: "沉静",
	scenario: "栖水镇听雨轩",
	firstMes: "*她立在檐下。*",
	mesExample: "{{user}}：你好\n{{char}}：嗯。",
	systemPrompt: "",
	postHistoryInstructions: "",
	creatorNotes: "",
	alternateGreetings: [],
	tags: [],
	book: [],
};

test("开场标题只包装一次", () => {
	const name = "无月馆事件·专业剧本杀DM";
	const titled = buildGreeting(
		{ ...card, name, firstMes: `【开场 · ${name}】\n暴雨覆盖山间道路。` },
		DEFAULT_CONFIG,
	);
	assert.equal(titled.match(/【开场 · 无月馆事件·专业剧本杀DM】/g)?.length, 1);
	assert.equal(buildGreeting(card, DEFAULT_CONFIG), "【开场 · 青梧】\n*她立在檐下。*");
});

test("正文中的幕次描述不误判为多开局菜单", () => {
	const script = `【开场 · 无月馆事件】\n第一幕将在晚宴厅展开。第二幕的线索会根据行动出现。宾客已经抵达门厅。`;
	assert.equal(looksLikeOpeningMenu(script), false);
	assert.equal(
		looksLikeOpeningMenu("请选择开局，选择后立即进入对应故事：\n第一幕：雨夜来客，调查封馆真相\n第二幕：密室钟声，追踪失踪宾客"),
		true,
	);
});

test("system prompt 含角色/分工/工具/语言指令且宏已替换", () => {
	const sp = buildSystemPrompt({ card, config: DEFAULT_CONFIG, constantLore: [] });
	assert.ok(sp.includes("青梧"));
	assert.ok(sp.includes("分工") || sp.includes("叙事模型"), "应有分工/身份声明");
	assert.ok(sp.includes("只写剧情") || sp.includes("叙事"), "剧情模型只演戏");
	assert.ok(!sp.includes("双重职责"), "戏内/戏外双姿态已退役");
	assert.ok(!sp.includes("戏外"), "不再有戏外通道措辞");
	assert.ok(sp.includes("「助手」"), "系统事务应指向右栏助手");
	assert.ok(sp.includes("怎么办") || sp.includes("共创抉择"), "怎么办/下一步仍是剧情输入");
	assert.ok(sp.includes("只计用户可见") || sp.includes("正文字数"), "字数口径=可见正文");
	assert.ok(sp.includes("400–900") || sp.includes("400-900"), "默认正文字数 400–900");
	assert.ok(sp.includes("背景锚点") || sp.includes("勿重复铺陈"), "scenario 应标背景锚点");
	assert.ok(!sp.includes("篇幅 2–4 段"), "旧短篇幅指令应移除");
	assert.ok(!sp.includes("Android Termux"), "环境元信息已瘦身，不再塞 Termux 段");
	assert.ok(!sp.includes("Android Termux"), "环境元信息已瘦身，不再塞 Termux 段");
	assert.ok(sp.includes("world_state_update"), "记账工具应在剧情工具清单");
	assert.ok(sp.includes("lorebook_write"), "补充设定集工具应在剧情工具清单");
	assert.ok(sp.includes("panel_write"), "自建面板工具应在剧情工具清单");
	assert.ok(sp.includes("富文本组件目录") || sp.includes("RP 方括号"), "应展示 RP 组件目录");
	assert.ok(sp.includes("[letter") || sp.includes("letter"), "目录应含 letter 等 RP 组件");
	assert.ok(sp.includes("quest") || sp.includes("inventory"), "目录应含 quest/inventory 等 RP 组件");
	assert.ok(sp.includes("Ask Direction") || sp.includes("每轮必须"), "ask 档应声明每轮抉择");
	assert.ok(sp.includes("3~4") || sp.includes("3-4"), "默认选项数 3~4");
	assert.ok(sp.includes("world_time"), "世界时间工具应在剧情工具清单");
	assert.ok(sp.includes("smart_search"), "联网搜索工具应在剧情工具清单");
	assert.ok(sp.includes("检索") || sp.includes("联网"), "搜索工具说明应覆盖语义意图");
	assert.ok(sp.includes("world_time") && (sp.includes("smart_search") || sp.includes("锚定")), "搜索应说明先取时");
	assert.ok(!sp.includes("bash"), "backendControl 默认关，不注入本机工具说明");
	assert.ok(!sp.includes("skill_save"), "技能沉淀已迁助手，剧情侧只留使用权");
	assert.ok(!sp.includes("/api/command"), "自操作接口已整体退役（移交助手工具面）");
	assert.ok(!sp.includes("舞台监督") && !sp.includes("幕后"), "命名纪律：不用戏剧隐喻词");
	assert.ok(sp.includes("中文"));
	assert.ok(!sp.includes("{{char}}"), "宏应已替换");
	assert.ok(!sp.includes("{{user}}"), "宏应已替换");
});

test("system prompt：backendControl 关闭时不出现通用工具段与技能库", () => {
	const sp = buildSystemPrompt({ card, config: { ...DEFAULT_CONFIG, backendControl: false }, constantLore: [] });
	assert.ok(!sp.includes("bash"), "关闭后不应提及通用工具");
	assert.ok(sp.includes("world_state_update"), "剧情工具不受开关影响");
	assert.ok(!sp.includes("技能清单"), "技能库依赖 read，关闭后不注入");
});

test("末端注入：预设末端指令恒注入（双姿态已退役，无戏外跳过）", () => {
	const base = { state: defaultState(), activatedLore: [], card, config: DEFAULT_CONFIG };
	const withPreset = buildTurnInjection({
		...base,
		presetPostHistoryBlocks: [
			{ id: "x", name: "x", channel: "postHistory" as const, role: "system" as const, content: "预设指令内容", enabled: true },
		],
	});
	assert.ok(withPreset.includes("预设指令内容"), "预设末端指令应注入");
	assert.ok(withPreset.includes("【绘梦附注】"), "末端绘梦附注恒在");
	assert.ok(withPreset.includes("「助手」"), "系统事务指引应在末端钉住");
	assert.ok(!withPreset.includes("戏外"), "不再有戏外措辞");
});

test("末端注入：连续性审查已关闭，auditWarnings 不注入", () => {
	const base = { state: defaultState(), activatedLore: [], card, config: DEFAULT_CONFIG };
	const withWarn = buildTurnInjection({ ...base, auditWarnings: ["正文说怀表在她手中 vs 账本记录阿远持有"] });
	assert.ok(!withWarn.includes("连续性提醒"));
	assert.ok(!withWarn.includes("怀表"));
});

test("末端注入：语言与硬边界纪律恒在", () => {
	const text = buildTurnInjection({ state: defaultState(), activatedLore: [], card, config: DEFAULT_CONFIG });
	assert.ok(text.includes("中文"));
	assert.ok(text.includes("旅人"));
	assert.ok(text.includes("【世界状态】"));
	assert.ok(text.includes("不得与之矛盾"), "状态注入应为硬约束措辞");
});

test("末端注入：故事进度与节拍计划可选块", () => {
	const base = { state: defaultState(), activatedLore: [], card, config: DEFAULT_CONFIG };
	assert.ok(!buildTurnInjection(base).includes("【故事进度】"));
	const withSum = buildTurnInjection({
		...base,
		turnSummaries: "[第1轮] 用户意图：入住 | 叙事要点：安排客房",
		writingGuideText: "叙事方向：缓和气氛",
		toolResultsText: "检定结果：1d20 = 15 → 成功",
	});
	assert.ok(withSum.includes("【故事进度】"));
	assert.ok(withSum.includes("安排客房"));
	assert.ok(withSum.includes("【本轮节拍计划】"));
	assert.ok(withSum.includes("【工具结果】"));
	// 故事进度应出现在世界状态之前
	assert.ok(withSum.indexOf("【故事进度】") < withSum.indexOf("【世界状态】"));
});

test("末端注入：语言失配时出现纠正提醒", () => {
	const base = { state: defaultState(), activatedLore: [], card, config: DEFAULT_CONFIG };
	assert.ok(buildTurnInjection({ ...base, languageMismatch: true }).includes("错误的语言"));
	assert.ok(!buildTurnInjection({ ...base, languageMismatch: false }).includes("错误的语言"));
});

test("末端注入：活跃面板速览随 panelIndex 出现，缺省不出现", () => {
	const base = { state: defaultState(), activatedLore: [], card, config: DEFAULT_CONFIG };
	const withPanels = buildTurnInjection({ ...base, panelIndex: "地图(svg)、装备库(markdown)" });
	assert.ok(withPanels.includes("【活跃面板】地图(svg)、装备库(markdown)"));
	assert.ok(withPanels.includes("panel_write"), "速览应附更新提醒");
	assert.ok(!buildTurnInjection(base).includes("【活跃面板】"), "无面板不出现");
});

test("末端注入：Ask Direction 广播仅 ask 档出现", () => {
	const askConfig = { ...DEFAULT_CONFIG, creationMode: "ask" as const };
	const base = { state: defaultState(), activatedLore: [], card, config: askConfig };
	const askInj = buildTurnInjection(base);
	assert.ok(askInj.includes("Ask Direction") || askInj.includes("ask_director"), "ask 档每轮末端应有抉择广播");
	assert.ok(askInj.includes("3~4") || askInj.includes("3-4"), "默认 3~4 选项");
	const silentInj = buildTurnInjection({ ...base, config: { ...DEFAULT_CONFIG, creationMode: "silent" } });
	assert.ok(!silentInj.includes("Ask Direction 广播"), "silent 档不出现 Ask Direction 广播");
});

test("求方向检测与末端强制 ask_director", () => {
	assert.ok(userSeeksDirection("我该做什么？"));
	assert.ok(userSeeksDirection("文舒婉跪着……我该怎么做"));
	assert.ok(userSeeksDirection("开始生成身份"));
	assert.ok(userSeeksDirection("帮我生成人设"));
	assert.ok(userSeeksDirection("建档"));
	assert.ok(!userSeeksDirection("我伸手接过砚台。"));
	assert.ok(!userSeeksDirection("他的身份是过路商人。"), "叙事里顺带提身份不应强制");
	const askConfig = { ...DEFAULT_CONFIG, creationMode: "ask" as const };
	const force = buildTurnInjection({
		state: defaultState(),
		activatedLore: [],
		card,
		config: askConfig,
		userText: "我该做什么",
	});
	assert.ok(force.includes("强制"), "求方向应升格强制调用");
	assert.ok(force.includes("ask_director"));
	const idForce = buildTurnInjection({
		state: defaultState(),
		activatedLore: [],
		card,
		config: askConfig,
		userText: "开始生成身份",
	});
	assert.ok(idForce.includes("强制"), "生成身份应升格强制调用");
	assert.ok(idForce.includes("身份") || idForce.includes("人设"), "身份强制文案应点明场景");
	assert.ok(idForce.includes("ask_director"));
});

test("联网搜索意图检测与末端强制 smart_search", () => {
	assert.ok(userSeeksWebSearch("帮我找一下 OpenAI 最新发布"));
	assert.ok(userSeeksWebSearch("联网看看今天有什么新闻"));
	assert.ok(userSeeksWebSearch("有没有最新消息"));
	assert.ok(userSeeksWebSearch("搜一下 Tavily API 文档"));
	assert.ok(userSeeksWebSearch("帮我查证一下这个说法有没有来源"));
	assert.ok(userSeeksWebSearch("look up the latest news about SpaceX"));
	assert.ok(userSeeksWebSearch("search for React 19 release notes"));
	assert.ok(!userSeeksWebSearch("我伸手接过砚台，雨还在下。"));
	assert.ok(!userSeeksWebSearch("他在网上认识了青梧。"), "叙事里顺带提「网上」不应强制");
	const force = buildTurnInjection({
		state: defaultState(),
		activatedLore: [],
		card,
		config: DEFAULT_CONFIG,
		userText: "帮我找资料：最新 AI 新闻",
		webSearchEnabled: true,
	});
	assert.ok(force.includes("强制"), "联网检索意愿应升格强制调用");
	assert.ok(force.includes("smart_search"));
	assert.ok(force.includes("无需重复调用 world_time"), "应说明搜索工具复用短时世界时间");
	const switchedOff = buildTurnInjection({
		state: defaultState(),
		activatedLore: [],
		card,
		config: DEFAULT_CONFIG,
		userText: "帮我找资料：最新 AI 新闻",
		webSearchEnabled: false,
	});
	assert.ok(!switchedOff.includes("本轮已开启联网搜索"), "关闭本轮开关后不应强制搜索");
	const plain = buildTurnInjection({
		state: defaultState(),
		activatedLore: [],
		card,
		config: DEFAULT_CONFIG,
		userText: "我点点头，示意她继续说。",
	});
	assert.ok(!plain.includes("smart_search") || !plain.includes("强制"), "纯剧情不应强制搜索");
});

test("字数分级：默认 / 短承接 / 长戏 / 多开局待选", () => {
	assert.ok(userSeeksShortBeat("继续"));
	assert.ok(userSeeksShortBeat("短打一下"));
	assert.ok(!userSeeksShortBeat("我伸手推开木门，雨气扑面而来。"));
	assert.ok(userSeeksLongForm("写长一点，详细描写"));
	assert.ok(!userSeeksLongForm("我点点头。"));
	const base = { state: defaultState(), activatedLore: [], card, config: DEFAULT_CONFIG };
	const def = buildTurnInjection(base);
	assert.ok(def.includes("400–900") || def.includes("400-900") || def.includes("约 400"), "默认档");
	const short = buildTurnInjection({ ...base, userText: "继续" });
	assert.ok(short.includes("400–600") || short.includes("短承接"), "短承接档");
	const long = buildTurnInjection({ ...base, userText: "请详细描写，写长一点" });
	assert.ok(long.includes("800–1500") || long.includes("长戏"), "长戏档");
	const open = buildTurnInjection({ ...base, forceOpeningChoice: true, openingOptions: ["甲", "乙"] });
	assert.ok(open.includes("极短") || open.includes("多开局选定"), "多开局待选不按默认灌水");
});

test("多开局说明书检测与选项解析", () => {
	const menu = `【开场 · 封神演义】
本卡提供多个开局入口，请选择开局后进入对应第一幕。

**一、云中子见纣王**
商都朝堂，云中子持剑来见。

**二、哪吒闹海**
陈塘关外浪打礁石。

**三、姜子牙下山**
昆仑云深，子牙辞师。

**四、文王访贤**
渭水之滨。
`;
	assert.ok(looksLikeOpeningMenu(menu), "并列一、二、三应识别为多开局");
	const opts = parseOpeningOptions(menu);
	assert.ok(opts.length >= 3, `应抽出至少 3 个开局，实际 ${opts.length}: ${opts.join("|")}`);
	assert.ok(opts.some((o) => /云中子/.test(o)));
	assert.ok(opts.some((o) => /哪吒/.test(o)));
	assert.ok(!looksLikeOpeningMenu("【开场 · 青梧】*她立在檐下，雨声渐密。*"), "单开局定场不识别");
	assert.ok(needsOpeningChoice({ greetingText: menu, hasUserPick: false }));
	assert.ok(!needsOpeningChoice({ greetingText: menu, hasUserPick: true }), "已选定后不再待选");
	assert.ok(!needsOpeningChoice({ greetingText: "短", hasUserPick: false }));
});

test("多开局仅在询问档强制 ask_director", () => {
	const opts = ["云中子见纣王", "哪吒闹海", "姜子牙下山"];
	const silent = buildTurnInjection({
		state: defaultState(),
		activatedLore: [],
		card,
		config: { ...DEFAULT_CONFIG, creationMode: "silent" },
		forceOpeningChoice: true,
		openingOptions: opts,
	});
	assert.ok(!silent.includes("强制·多开局选定"), "silent 档不应自动弹多开局选择卡");
	assert.ok(!silent.includes("ask_director"));
	assert.ok(!silent.includes("【云中子见纣王】"));
	const ask = buildTurnInjection({
		state: defaultState(),
		activatedLore: [],
		card,
		config: { ...DEFAULT_CONFIG, creationMode: "ask" },
		forceOpeningChoice: true,
		openingOptions: opts,
	});
	assert.ok(ask.includes("强制·多开局选定"));
	assert.ok(ask.includes("ask_director"));
	assert.ok(ask.includes("【云中子见纣王】"));
	assert.ok(ask.includes("禁止在正文复述") || ask.includes("禁止写长篇叙事"));
	const plain = buildTurnInjection({
		state: defaultState(),
		activatedLore: [],
		card,
		config: DEFAULT_CONFIG,
		forceOpeningChoice: false,
	});
	assert.ok(!plain.includes("强制·多开局选定"));
});

test("system 消息标注含多开局 ask_director 纪律", () => {
	const sp = buildSystemPrompt({ card, config: DEFAULT_CONFIG, constantLore: [] });
	assert.ok(sp.includes("多开局") || sp.includes("ask_director"), "开场标注应覆盖多开局选定路径");
});

test("语言失配检测：英文正文报警，中文正文与短文本不报", () => {
	const en =
		"*Qingwu sets the teacup down and studies your rain-soaked figure for a moment, her voice calm and clear beneath the steady sound of rain on the roof tiles.*";
	const zh = "*青梧放下茶盏，目光在你被雨水浸透的肩头停了一瞬。她的声音不高，混在瓦上的雨声里，却平静而清晰。*";
	const mixed = "*Qingwu 轻轻点头。*「你醒了，旅人。这里是栖水镇的听雨轩——你已经安全了，好好休息。」";
	assert.equal(detectsLanguageMismatch(en, "中文"), true, "英文正文应报警");
	assert.equal(detectsLanguageMismatch(zh, "中文"), false, "中文正文不应报警");
	assert.equal(detectsLanguageMismatch(mixed, "中文"), false, "夹杂专有名词的中文不应报警");
	assert.equal(detectsLanguageMismatch("Okay.", "中文"), false, "短文本不判定");
	assert.equal(detectsLanguageMismatch(en, "English"), false, "非中文目标 v0 不检测");
});
