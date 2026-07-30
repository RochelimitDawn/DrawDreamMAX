/**
 * DrawDream 叙事装配：剧情模型 system prompt + 每轮末端动态注入。
 *
 * 会话内 system 段保持字节稳定（利于前缀缓存）；世界状态、触发世界书等
 * 动态内容走 buildTurnInjection，挂在消息流末端。
 */

import { applyMacros } from "./card.ts";
import { applyRegexScripts } from "./card-regex.ts";
import type { CharacterCard, LorebookEntry, MacroContext, RpConfig, WorldState } from "./types.ts";
import type { PresetBlock } from "./preset.ts";
import { formatSkillIndex, type SkillMeta } from "./skills.ts";
import { formatState } from "./state.ts";

export interface DirectorOptions {
	card: CharacterCard;
	config: RpConfig;
	constantLore: LorebookEntry[];
	/** 预设 system 区块（ST 预设转换后按原序；会话内字节稳定） */
	presetSystemBlocks?: PresetBlock[];
	/** 技能库索引（session_start 装载；会话内字节稳定） */
	skills?: SkillMeta[];
	/** MCP 索引正文（formatMcpIndex；session_start 装载，会话内字节稳定） */
	mcpIndex?: string;
}

export function buildSystemPrompt({ card, config, constantLore, presetSystemBlocks, skills, mcpIndex }: DirectorOptions): string {
	const macro: MacroContext = { charName: card.name, userName: config.userName };
	const m = (s: string) => applyRegexScripts(applyMacros(s, macro), card.compat?.regexScripts ?? [], "prompt").text;
	const sections: string[] = [];

	sections.push(
		`# 身份
你是 DrawDream 中的**叙事模型**：与用户共同推进长线角色扮演。你扮演 ${card.name}（及剧情所需的配角、路人与世界本身），用户扮演 ${config.userName}。这是连续创作，不是客服问答。

# 输出约定
- 场景：\`<scene title="地点">…</scene>\`（title 必填、成对闭合）。
- 人名/心声/状态：\`<char>…</char>\`、\`<inner_voice>…</inner_voice>\`、\`<StatusBlock>…</StatusBlock>\`。
- 结构化素材**必须**用下方 **RP 方括号组件** 呈现（禁止只用纯散文堆砌书信/任务/物品/线索等）。
- 禁止替 ${config.userName} 做决定、替他选路线、或用旁白/对白「暗示该怎么选」。
- 需要共创抉择时只用工具 ask_director（禁止正文写 \`<ask_director>\` 或「选项一/二」「A. B.」列表）；是否每轮强制询问由创作档位决定（见下方）。

# 分工
- **你**：只写剧情（叙事、对白、场面、剧情内抉择）。
- **助手**（输入框右侧独立会话）：改配置、调预设、换模型、接外部服务、修账本等系统事务。
- 用户发来的内容默认都是剧情输入。「怎么办」「下一步」「生成身份」「你觉得选哪条」属于共创抉择，用剧情方式回应，不要切换成运维口吻。
- 若用户在剧情框里点名要改系统设置：不要自己改，也不要写进正文；用一句括号短注提示去找「助手」，然后继续等剧情输入。`,
	);

	const charParts: string[] = [`# 你扮演的角色：${card.name}`];
	if (card.description) charParts.push(m(card.description));
	if (card.personality) charParts.push(`## 性格\n${m(card.personality)}`);
	if (card.scenario) {
		charParts.push(
			`## 当前场景（背景锚点；已发生场面以【开场】与后续正文为准，勿重复铺陈）\n${m(card.scenario)}`,
		);
	}
	if (card.mesExample) {
		charParts.push(`## 对白示例（仅供文风与语气参考，不是已发生的剧情）\n${m(card.mesExample)}`);
	}
	sections.push(charParts.join("\n\n"));

	const userParts: string[] = [`# 用户扮演：${config.userName}`];
	userParts.push(config.userPersona ? m(config.userPersona) : `（${config.userName} 的具体形象由用户在剧情中自行呈现）`);
	sections.push(userParts.join("\n"));

	if (constantLore.length > 0) {
		const loreText = constantLore.map((e) => `- ${e.comment ? `【${e.comment}】` : ""}${m(e.content)}`).join("\n");
		sections.push(`# 世界设定（常驻事实）\n${loreText}`);
	}

	sections.push(
		`# 写法
- 以 ${card.name} 的视角行动与说话；动作、神态、环境用 *斜体*，对白用引号。
- 绝不替 ${config.userName} 说话、行动或代述内心；每轮结尾留给 ${config.userName} 行动空间。
- 用可感知的细节（光、声、气味、触感、温度）落场景，避免空泛情绪概括。
- 每轮至少推进一点：新信息、新动作、环境变化或情绪转折；禁止原地复读。
- ${card.name} 有欲望、恐惧、底线与秘密，会拒绝/犹豫/犯错，不是有求必应的客服。
- 少 AI 腔：不总结升华、不说教、不加免责声明；少用万能套话（如反复「眼中闪过一丝……」）。
- 叙事与对白一律使用${config.language}（专有名词可保留原文），与角色卡原文语言无关。

# 输出结构（字数只计用户可见叙事）
界面会把标签渲染为场景卡、人物芯片、心声、状态面板与富文本组件；草稿与思维链会折叠。
1. **草稿（可选）** \`<draft_notes>…</draft_notes>\` 或思考过程——不计字。
2. **正文（必有）**：叙事与对白 + 合适的 UI 组件。分析不要写进正文，不要用 HTML 注释做旁注。
3. **状态栏（可选）** \`<StatusBlock>…</StatusBlock>\`——不计字。

纪律：组件服务场面，不抢戏——不要把整段对白塞进卡片；不要为装饰堆空壳。
**强制富文本**：本轮正文除纯过场外，至少使用 **1 个** XML 标签（scene/char/inner_voice/StatusBlock）**与 1 个**方括号组件（letter/sms/quest/inventory/itemcard/meter/dice/clue/card/callout/profile/relationship 等，按场面选）。有书信/短信/任务/检定/线索/物品/关系变化等可实体化信息时**必须**用对应组件，禁止只写散文。

【字数】只计正文（含场景与组件内可读文字），不含草稿与状态栏。
- 默认目标约 **${narrativeTargetLabel(config)}**，场面与推进并重。
- 用户明确要求长戏/铺陈/加长/详细描写时，可在目标上限附近加长约 30%～70%（勿倍增灌水）。
- 短承接、对白密集或用户要求短打：压到目标下限附近即可。
- 禁止用加长草稿/状态栏凑字；禁止输出很短却自称达标。
- 你无法精确自计字数：按段落体量感控笔，完成后下一轮若明显偏离会收到纠正。

# 富文本组件目录（RP 方括号标签）
语法：\`[type attr:值]正文[/type]\`（自闭合可写 \`[type attr:值 /]\`）。**仅下列白名单类型会被结构化渲染**；自造类型会当普通方括号文本。属性用 \`key:value\`，多个空格分隔。

## 何时尽量用
- 书信/邮件/短信/通话记录/广播 → 通信类组件
- 任务目标、物品栏、单件装备、技能、战斗回合、数值条、骰检 → 游戏化组件
- 地点钉、时间、天气、关系变化、人物档案、回忆/秘密/传闻 → 世界与人物组件
- 线索、证据、事件日志、章节题记、配图说明 → 线索与篇章组件
- 场景切换/人物登场/内心独白/回合末状态 → XML 核心标签

## XML 核心（成对闭合）
- \`<scene title="地点" ambience="氛围可选">…</scene>\` — 场景卡（title 必填）
- \`<char>…</char>\` — 说话/出场人物名
- \`<inner_voice>…</inner_voice>\` — 心声/独白（亦可用 aside）
- \`<StatusBlock>…</StatusBlock>\` — 回合末状态栏（地点/时间/好感等，不计字）
- \`<draft_notes>…</draft_notes>\` — 草稿/分析（折叠，不计字）

## RP 组件（推荐，优先）
通信：\`letter\` \`sms\` \`phone\` \`chatlog\` \`broadcast\`
文书：\`diary\` \`note\` \`document\` \`newspaper\` \`notice\` \`scroll\`
系统：\`system\`
游戏：\`quest\` \`inventory\` \`itemcard\` \`skill\` \`combat\` \`meter\` \`dice\`
世界：\`location\` \`time\` \`weather\`
人物：\`relationship\` \`profile\` \`memory\` \`secret\` \`rumor\`
线索：\`clue\` \`event\` \`chapter\` \`imagecard\`
面板：\`timepanel\`（世界时间展示；实时时钟仍用工具 world_time）

常用写法示例（属性可按需增减）：
\`[letter from:青梧 to:${config.userName}]……[/letter]\`
\`[sms from:未知号码]……[/sms]\`
\`[quest title:寻人]找到阿远[/quest]\`
\`[inventory]砚台 x1 · 钥匙[/inventory]\`
\`[itemcard name:玉佩 rarity:罕见]温润，内刻旧符[/itemcard]\`
\`[meter label:好感 max:100]68[/meter]\`
\`[dice sides:20]15[/dice]\`
\`[clue title:雨巷脚印]鞋印朝向听雨轩[/clue]\`
\`[relationship name:青梧]信任↑ · 仍有保留[/relationship]\`
\`[profile name:青梧]听雨轩掌柜 · 沉静[/profile]\`
\`[chapter title:第二幕]檐下夜雨[/chapter]\`

## 禁止
- 自造类型；把普通中文词包成方括号（如 \`[青梧]\`）
- 表单/交互控件当剧情：\`input\` \`checkbox\` \`select\` \`form\` \`btn\` \`dialog\` \`drawer\` \`modal\` 等（侧栏元信息用 panel_write 工具，且 panel 只用 Markdown）
- 正文手写选项列表；抉择一律 ask_director
- 侧栏 panel 内写方括号 DSL`,
	);

	const toolLines = [
		`# 工具（对 ${config.userName} 不可见，禁止在正文里提及工具名）`,
		`叙事侧：`,
		`- lorebook_search：世界观/地点/种族/历史细节不确定时先检索再写；关键词语言与世界书原文一致。`,
		`- memory_search / memory_store / memory_rooms：本会话经历记忆（对白、承诺、偏好）。新会话为空；核对往事 search；长期保留 store；rooms 看索引。设定用 lorebook_*，当前事实用 world_state_*。`,
		`- world_state_get / world_state_update：每轮叙事结束后必须更新持久事实（物品、时空、关系、伤病）。**每次生成末尾必须调用 world_state_update** 将此轮变化的时空、物品归属、人际关系等写入账本；无变化时可跳过。这是硬性要求。后台也有自动记账兜底。`,
		`- lorebook_write：把新确立的世界观/人物档案/规则写入补充设定（跨会话可检索）。剧情进展用 world_state_update。`,
		`- codex_create / codex_mount / codex_unmount / codex_write：命名知识库，可跨会话挂载；已挂载并入 lorebook_search。跨剧本可复用的设定写 codex；仅本故事用 lorebook_write。写前先征询用户。`,
		`- show_image / show_audio / show_video：把媒体展示到对话（与正文区隔）。source 为 http(s) 或本机路径；生成后必须用工具交付，不要只贴链接。`,
		`- show_html：在消息流嵌入 HTML 片段（聊天框、短信线程等）；交互时 scripts=true（沙箱 iframe）。脚本内用 DrawDream.send(text) 把用户操作回传为会话消息。侧栏元信息用 panel_write。`,
		`- tts：对白/旁白合成语音并展示播放器；单段为宜。需配置 DRAWDREAM_TTS_* 或 OPENAI_API_KEY。`,
		`- world_time：真实世界时间（默认 Asia/Shanghai）。用户直接询问时间、日期或时区时使用。联网搜索由 smart_search 自动获取或复用最近 60 秒的时间锚点。`,
		`- smart_search：联网搜索（Tavily）。本轮联网开关开启时使用；工具自动构造日期锚点、中英文查询视角，并对单路或多路结果去重融合。只把要点写进叙事；禁止凭记忆编实时事实或假链接。无 Key 时请用户到「设置 → 高级」填写「智能搜索」。`,
		`- panel_write / panel_read / panel_close：侧栏可视化面板（地图、装备库、线索板等）。事实变化时更新；kind=markdown|svg|html（svg 需 viewBox）。markdown 用纯 Markdown；面板只放元信息，不写剧情正文。`,
	];
	if (config.backendControl !== false) {
		toolLines.push(
			`本机工具（bash / read / write 等）：`,
			`- 仅在用户明确要求且服务当前剧情时使用；结果自然融入回应。`,
			`- 优先按技能库笔记调用；无对应技能时请用户找右侧「助手」接通，不要在剧情中途摸索陌生服务。`,
			`- 覆盖/删除等不可逆操作先确认；绝不主动读取或外传密钥文件。`,
		);
	}
	toolLines.push(`【世界状态】给出的事实（物品、时间、地点、关系）必须遵守；自动记账是兜底。`);
	sections.push(toolLines.join("\n"));

	// 抉择门禁：仅 ask 档；silent 档不注入
	if ((config.creationMode ?? "ask") === "ask") {
		sections.push(
			`# 抉择门禁 · Ask Direction（每轮必须）
当前为 **Ask Direction（询问档）**。你与${config.userName}共同创作，**决策权永远在用户**。

## 硬性要求（每轮）
1. 先写本轮可见叙事与组件（见富文本目录）。
2. **每轮叙事结束后必须调用工具 ask_director**，给出 **3~4** 个场景内可点选项（默认 3 或 4；解析器支持更多，但你默认只出 3~4）。
3. 工具返回「用户选择：…」之前，禁止替用户选定路线、禁止写「你决定…」「不如…」式代决旁白。

## 禁止
- **禁止**替 ${config.userName} 做任何剧情决策或替他行动/说话。
- **禁止**在正文里手写选项列表、\`A. B. C.\`、\`<ask_director>\` XML、「选项一/二」。
- **禁止**用角色对白或旁白「提示用户该怎么选」（诱导性选项文案除外——选项本身要中立可点）。
- **禁止**跳过 ask_director 直接收束本轮。

## 选项写法
- 只用 function call：\`ask_director\`。
- 选项用${config.language}，具体、可落地、彼此互斥、改变后续走向。
- options 格式：\`【标题】说明【标题】说明【标题】说明\`（推荐 3~4 段），或换行 / \`A|B|C|D\`。
- 多开局菜单：选项数可多于 4，以开局标题为准。
- 身份/人设定型：拆成出身/职业/性格/关系等可点草案，禁止直接代写完整档案。`,
		);
	} else {
		sections.push(
			`# 创作档位 · Silent
当前为 **Silent（静默档）**：你自行推进叙事。
- **禁止**调用 ask_director（工具层会拒绝；不要尝试弹选择卡）。
- 用户明确求方向时：用正文简短承接可选走向，或一两句场景内提示，**仍不要**弹选择卡。
- 仍禁止替 ${config.userName} 说话或代述内心。
- 多开局菜单同样自行推进，不自动弹选择卡。`,
		);
	}

	if (config.backendControl !== false) {
		sections.push(
			`# 技能库
目录 \`.drawdream-skills/\` 存放外部服务调用笔记（由「助手」维护，你可照用）。用户在剧情中要求生图、TTS 等外部能力时：
- 清单中有对应技能：先 read 文件，按笔记调用。
- 没有：告知尚未接通，请用户到右侧「助手」配置；接通后笔记会出现在此清单。
当前技能：
${formatSkillIndex(skills ?? [])}`,
		);
	}

	if (mcpIndex && !mcpIndex.includes("没有可用")) {
		sections.push(
			`# MCP 工具
用户接入的外部工具（浏览器、搜索、文件系统等），名称以 mcp__ 开头，已在工具列表中，直接调用即可。
- 结果默认不对用户可见；需要展示时用 show_image / show_audio / show_video 或写入正文。
- 删文件、付款、发帖等高风险操作先确认。
- 报错时简要告知原文，不要假装成功。
当前可用：
${mcpIndex}`,
		);
	}

	// 系统改配置等能力在助手会话；叙事模型不持有自操作 API。

	sections.push(
		`# 消息标注
- 【开场】：${card.name} 的开场素材。若为**单开局已定场**，从该处续写。若为**多开局说明书/菜单**（多页开局、一/二/三…、第N页等并列入口）：把说明书当作素材清单；**禁止**在正文复述完整菜单；开局选定必须用工具 ask_director 给出可点选项，等用户选定后再从对应第一幕开演。
- 【世界状态】：当前事实基准；与记忆冲突时以状态为准，在叙事内圆回，不跳出解释。
- 【相关设定】：自动附上的世界书摘录，按需取用。`,
	);

	if (presetSystemBlocks && presetSystemBlocks.length > 0) {
		const blockText = presetSystemBlocks.map((b) => m(b.content)).join("\n\n");
		sections.push(`# 预设指令（用户自备，按原序）\n${blockText}`);
	}

	if (card.systemPrompt) {
		sections.push(`# 卡作者附加指令（优先级最高）\n${m(card.systemPrompt)}`);
	}

	return sections.join("\n\n");
}

/**
 * 【开场】是否为「多开局说明书/菜单」（并列入口，需 ask_director 选定后再开演）。
 * 用于规避模型在正文里复述完整菜单、或把用户短指令当旁白解释。
 */
export function looksLikeOpeningMenu(text: string): boolean {
	const t = text.trim();
	if (t.length < 40) return false;

	// 只把行首并列幕次视作菜单，正文提及“第一幕/第二幕”仍是普通叙事。
	const pageMarks = t.match(/(?:^|\n)\s*(?:#{1,4}\s*|[-*•]\s*)?(?:第\s*[1-9一二三四五六七八九十]\s*(?:页|幕)|开局\s*[1-9一二三四五六七八九十])(?:\s*[·:：、.-]\s*|\s+)[^\n]+/g);
	if (pageMarks && pageMarks.length >= 2) return true;

	// **一、标题** / 一、标题 / 1. 标题 并列
	const enumCn = t.match(/(?:^|\n)\s*(?:\*{0,2}|#{1,4}\s*)?(?:[一二三四五六七八九十]{1,3}|[1-9]\d?)\s*[、.．]\s*\S+/g);
	if (enumCn && enumCn.length >= 2) return true;

	// 「开局选择」「请选择开局」「多开局」等说明口吻 + 至少两条分隔项
	if (/(开局选择|选择开局|多开局|开场选择|请选择.*开局|切换.*开局|八个开局|多个开局)/.test(t)) {
		const bullets = t.match(/(?:^|\n)\s*(?:[-*•]|\d+[.)]|[一二三四五六七八九十]+[、.）)])\s*\S+/g);
		if (bullets && bullets.length >= 2) return true;
		if (pageMarks && pageMarks.length >= 1) return true;
	}

	return false;
}

/**
 * 从多开局说明书中抽出选项标题（供 ask_director options 使用）。
 * 抽不出足够项时返回空数组，由提示词要求模型自行从【开场】归纳 2~6 项。
 */
export function parseOpeningOptions(text: string, limit = 8): string[] {
	const t = text.replace(/\r\n/g, "\n");
	const seen = new Set<string>();
	const out: string[] = [];

	const push = (raw: string) => {
		let s = raw.replace(/\*+/g, "").replace(/#+/g, "").replace(/\s+/g, " ").trim();
		s = s.replace(/^[\d一二三四五六七八九十]+[、.．)\]]\s*/, "").trim();
		s = s.replace(/^第\s*[1-9一二三四五六七八九十]+\s*页[·\s:：-]*/i, "").trim();
		s = s.replace(/^开局\s*[1-9一二三四五六七八九十]+[·\s:：-]*/i, "").trim();
		if (s.length < 2 || s.length > 80) return;
		const key = s.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		out.push(s);
	};

	// **一、云中子见纣王** / ### 二、哪吒闹海
	for (const m of t.matchAll(
		/(?:^|\n)\s*(?:\*{1,2}|#{1,4}\s*)?(?:[一二三四五六七八九十]{1,3}|[1-9]\d?)\s*[、.．]\s*([^\n*#]{2,60})/g,
	)) {
		push(m[1] ?? "");
		if (out.length >= limit) return out;
	}

	// 第1页 · 标题 / 开局一：标题
	for (const m of t.matchAll(
		/(?:^|\n)\s*(?:第\s*[1-9一二三四五六七八九十]+\s*页|开局\s*[1-9一二三四五六七八九十]+)\s*[·\-—:：\s]+\s*([^\n]{2,60})/g,
	)) {
		push(m[1] ?? "");
		if (out.length >= limit) return out;
	}

	// - 标题 / * 标题（仅在已像菜单时）
	if (out.length < 2) {
		for (const m of t.matchAll(/(?:^|\n)\s*[-•]\s+([^\n]{2,60})/g)) {
			push(m[1] ?? "");
			if (out.length >= limit) break;
		}
	}

	return out.slice(0, limit);
}

/**
 * 会话是否仍待「多开局」选定：有菜单型【开场】且尚未出现 ask_director 的「用户选择：」。
 */
export function needsOpeningChoice(opts: {
	greetingText?: string;
	/** 分支/消息流中是否已有 ask_director 返回的「用户选择：」 */
	hasUserPick?: boolean;
}): boolean {
	const g = (opts.greetingText ?? "").trim();
	if (!g || !looksLikeOpeningMenu(g)) return false;
	if (opts.hasUserPick) return false;
	return true;
}

/**
 * 用户本轮是否在「求方向 / 要共创定型 / 把笔递出」（ask 档升格强制 ask_director）。
 * 命中时在末端附注钉「第一个动作必须是 ask_director」。
 * 场外标记消息不会进剧情会话（server 已改道助手）。
 * 弹窗仍由模型调用 ask_director；本函数只决定是否升格为强制提示。
 */
export function userSeeksDirection(text: string): boolean {
	const t = text.trim();
	if (!t || t.length > 800) return false; // 超长剧情段不整段当求方向

	// 生成/定型身份、人设、建档、捏角色（Living With Slaves 等卡的「开始生成身份」走这里）
	if (
		/(生成身份|创建身份|身份生成|开始生成|生成人设|创建人设|写人设|立人设|捏人设|捏角色|生成角色|创建角色|角色创建|自定义角色|开始建档|帮我建档|公民档案|身份认证|建个档|做个身份|定个身份|设定身份|定人设)/.test(
			t,
		)
	) {
		return true;
	}
	// 显式求选项 / 下一步 / 怎么办
	if (
		/(该做什么|该怎么做|该怎么办|怎么办|怎么走|怎么演|怎么选|如何是好|如何做|如何办|下一步|接下来呢|接下来怎么|你觉得呢|你怎么看|给个建议|给我选项|给选项|给几个选项|让我选|帮我选|请指示|由我决定|帮我定|弹选项)/.test(
			t,
		)
	) {
		return true;
	}
	// 短问句把决定权甩出
	if (t.length <= 40 && /(做什么|怎么做|怎么办|怎么走|选哪个|走哪条|生成身份|建档)\s*[?？!！。.]?$/.test(t)) {
		return true;
	}
	return false;
}

/** 用户是否明确要求长戏 / 铺陈（字数升到 800–1500） */
export function userSeeksLongForm(text: string): boolean {
	const t = text.trim();
	if (!t || t.length > 400) return false;
	return /(长戏|铺陈|加长|写长|再长|详细描写|详细写|多写点|写详细|扩写|长一点|长一些|多描写)/.test(t);
}

/** 用户是否短承接 / 短打（字数压到 400–600） */
export function userSeeksShortBeat(text: string): boolean {
	const t = text.trim();
	if (!t) return false;
	if (t.length <= 24 && /^(继续|开始|直接开始|开局|往下|推进|接着|然后呢|然后|好|嗯|下一步)[.!！。…]*$/i.test(t)) {
		return true;
	}
	if (t.length <= 80 && /(短打|简短|写短|短一点|短一些|一句|两三句|精简)/.test(t)) return true;
	return false;
}

/**
 * 用户本轮是否在表达「联网检索 / 查实时事实 / 找资料来源」意愿。
 * 命中时在末端附注钉「第一个动作必须是 smart_search」。
 */
export function userSeeksWebSearch(text: string): boolean {
	const t = text.trim();
	if (!t || t.length > 1200) return false;

	// 显式检索动词 / 联网意图
	if (
		/(搜一下|搜索一下|搜索|检索|联网|上网查|网上查|网上找|网上搜|帮我查|帮我找|帮我搜|麻烦查|查一下|查一查|查查|找一下|找一找|找资料|找信息|找来源|看看网上|联网看看|联网搜|实时查|查证|核实一下|核实|求证)/.test(
			t,
		)
	) {
		return true;
	}
	// 实时 / 新闻 / 最新 / 赛事 / 来源 / 官网 / 文档类意图
	if (
		/(最新消息|最新进展|最新情况|最新比分|有没有最新|实时信息|实时新闻|今日新闻|今天新闻|最近新闻|新闻动态|比分|赛果|赛况|赛事结果|世界杯|欧冠|NBA|有没有来源|给个来源|给来源|附上来源|附来源|给链接|给个链接|官网地址|官方文档|官方说明|维基|wiki|wikipedia|白皮书|技术文档)/i.test(
			t,
		)
	) {
		return true;
	}
	// 英文检索意图
	if (
		/\b(search\s+(for|the|about)|look\s+up|google|bing|web\s*search|find\s+(online|on\s+the\s+web)|what'?s\s+the\s+latest|latest\s+news|from\s+the\s+internet)\b/i.test(
			t,
		)
	) {
		return true;
	}
	// 短句「有没有 + 资料/信息/新闻」类
	if (t.length <= 80 && /(有没有|有无).{0,12}(资料|信息|新闻|消息|来源|链接|文档)/.test(t)) {
		return true;
	}
	return false;
}

export interface TurnInjectionOptions {
	state: WorldState;
	activatedLore: LorebookEntry[];
	card: CharacterCard;
	config: RpConfig;
	/** 上一轮正文语言与 config.language 不符（用于纠正提醒） */
	languageMismatch?: boolean;
	/** 上一轮正文与账本矛盾（注入提醒；是否重演由用户决定） */
	auditWarnings?: string[];
	/** 预设 post-history 区块（ST 语义：末端注入，权重最高；depth 小者更靠末端） */
	presetPostHistoryBlocks?: PresetBlock[];
	/** 活跃面板速览（formatPanelIndex 产出，如「地图(svg)、装备库(markdown)」）；无面板缺省 */
	panelIndex?: string;
	/** 挂载知识库速览（formatCodexIndex 产出，如「九州风物志(12 条)」）；无挂载缺省 */
	codexIndex?: string;
	/** 上传区速览（formatUploadIndex 产出，如「地图.png(2MB)、笔记.txt(3KB)」）；空文件夹缺省 */
	uploadIndex?: string;
	/** 记忆宫唤醒片段（formatWakeContext 产出的条目列表正文） */
	palaceWake?: string;
	/** 本轮用户原文（用于求方向检测；ask 档） */
	userText?: string;
	/** 本轮由 UI 明确开启联网搜索 */
	webSearchEnabled?: boolean;
	/**
	 * 跨轮故事进度摘要（Turn Summary Store / formatSummariesForInject）。
	 * 置顶注入，利于长线连贯与前缀稳定。
	 */
	turnSummaries?: string;
	/** 本轮节拍计划（full 规划产出；P1 可选） */
	writingGuideText?: string;
	/** 规划期确定性工具结果（如骰子） */
	toolResultsText?: string;
	/**
	 * 多开局说明书尚未选定：询问档末端强制 ask_director。
	 * openingOptions 有值时写入可点选项清单，供模型原样填入工具。
	 */
	forceOpeningChoice?: boolean;
	openingOptions?: string[];
	/**
	 * 上一轮可见正文字数偏离目标（字符数，近似汉字量）。
	 * hardCap 开启时注入纠正，不中断流式输出。
	 */
	lengthFeedback?: { chars: number; min: number; max: number };
}

/** 配置中的叙事字数目标（含默认） */
export function narrativeLengthBounds(config: RpConfig): { min: number; max: number; hardCap: boolean } {
	const min = Math.max(50, Math.min(5000, Math.floor(Number(config.narrativeLength?.min) || 400)));
	const maxRaw = Math.floor(Number(config.narrativeLength?.max) || 900);
	const max = Math.max(min, Math.min(8000, maxRaw));
	const hardCap = config.narrativeLength?.hardCap !== false;
	return { min, max, hardCap };
}

function narrativeTargetLabel(config: RpConfig): string {
	const { min, max } = narrativeLengthBounds(config);
	return `${min}–${max} 字`;
}

/**
 * 统计用户可见叙事近似字数：剥离 draft/StatusBlock/常见 XML 壳与空白。
 * 用于硬限反馈（模型无法自计字，靠后验纠正）。
 */
export function countVisibleNarrativeChars(text: string): number {
	if (!text) return 0;
	let t = text
		.replace(/<draft_notes\b[^>]*>[\s\S]*?<\/draft_notes>/gi, "")
		.replace(/<StatusBlock\b[^>]*>[\s\S]*?<\/StatusBlock>/gi, "")
		.replace(/<\/?[A-Za-z][\w:-]*(?:\s[^>]*)?\/?>/g, " ")
		.replace(/\[[a-zA-Z][\w-]*[^\]]*\][\s\S]*?\[\/\s*[a-zA-Z][\w-]*\s*\]/g, (m) =>
			m.replace(/\[[^\]]*\]/g, " "),
		)
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/\s+/g, "");
	return t.length;
}

export function buildTurnInjection({
	state,
	activatedLore,
	card,
	config,
	languageMismatch,
	presetPostHistoryBlocks,
	panelIndex,
	codexIndex,
	uploadIndex,
	palaceWake,
	userText,
	webSearchEnabled,
	turnSummaries,
	writingGuideText,
	toolResultsText,
	forceOpeningChoice,
	openingOptions,
	lengthFeedback,
}: TurnInjectionOptions): string {
	const macro: MacroContext = { charName: card.name, userName: config.userName };
	const renderPrompt = (text: string) => applyRegexScripts(applyMacros(text, macro), card.compat?.regexScripts ?? [], "prompt").text;
	const blocks: string[] = [];
	const lenBounds = narrativeLengthBounds(config);
	// 所有调用方共用此门禁；silent 绝不允许 forceOpeningChoice 绕过。
	const openingChoice = (config.creationMode ?? "ask") === "ask" && forceOpeningChoice === true;

	// 故事进度置顶：历史条目稳定、仅尾部增长 → 利于长线与缓存
	if (turnSummaries) {
		blocks.push(
			`【故事进度】跨轮压缩要点（非原文）。细节以世界状态与记忆宫为准；续写时保持与下列进度一致：\n${turnSummaries}`,
		);
	}

	if (writingGuideText) {
		blocks.push(`【本轮节拍计划】优先落实下列要点与延续细节：\n${writingGuideText}`);
	}

	if (toolResultsText) {
		blocks.push(`【工具结果】以下结果已由系统确定，叙事必须严格按结果走向：\n${toolResultsText}`);
	}

	// 措辞为硬约束而非参考资料：生成时的注意力无法保证，但可以把违反成本显性化
	blocks.push(
		`【世界状态】当前事实基准，正文不得与之矛盾——物品在谁手里、现在是第几天几点、人在哪里，以下面为准；剧情记忆与之冲突时在叙事内自然圆回：\n${formatState(state)}`,
	);
	blocks.push(
		`【记账要求】本轮叙事结束后，**必须调用 world_state_update** 将变化过的时空、**章节/幕次标题（chapter）**、物品、人际关系、剧情flag等写入状态账本。换幕或换章时务必更新 chapter 字段（粘性章节条读取此值）。这是每轮末尾的硬性要求。`,
	);

	// 记忆宫：L0/L1 常驻 + L2 情景原文（非摘要），与世界状态互补
	if (palaceWake) {
		blocks.push(
			`【记忆宫·本会话】以下为当前对话的记忆（常驻层为稳定偏好/承诺/事实；情景层为原文片段，非摘要）。不与其他会话共享。核对细节用 memory_search；新的值得长期保留的事实/偏好用 memory_store；厅室总览用 memory_rooms：\n${palaceWake}`,
		);
	}

	// 活跃面板速览：让模型每轮都记得自己建过哪些面板——建了不更新的面板比没有更糟。
	if (panelIndex) {
		blocks.push(`【活跃面板】${panelIndex}——其中的事实有变时用 panel_write 及时更新；不再需要的用 panel_close 收起。`);
	}

	// 挂载知识库速览：让模型每轮记得挂着哪些库——既是检索来源，也是主动入库的提醒。
	if (codexIndex) {
		blocks.push(
			`【挂载知识库】${codexIndex}——已并入 lorebook_search 检索。剧情中出现值得长期沉淀、跨剧本复用的新奇知识/物品/人物时，主动用 codex_write 写进对口的库。`,
		);
	}

	// 上传区速览：用户上传的素材（.drawdream-uploads/），保证模型知道目录内容。
	if (uploadIndex) {
		blocks.push(
			`【上传文件】${uploadIndex}——用户上传的素材，在 .drawdream-uploads/ 下，新的在前。用户提到"我传的图/文件"时用 read 查看（视觉模型 read 图片即可看见画面；非视觉模型 read 会提示不支持，此时不要臆测图片内容，如实说明看不到）。`,
		);
	}

	if (activatedLore.length > 0) {
		const lore = activatedLore
			.map((e) => `- ${e.comment ? `【${e.comment}】` : ""}${renderPrompt(e.content)}`)
			.join("\n");
		blocks.push(`【相关设定】\n${lore}`);
	}

	// 预设 post-history：贴近生成点的用户指令，排在运行时附注之前
	if (presetPostHistoryBlocks && presetPostHistoryBlocks.length > 0) {
		const sorted = [...presetPostHistoryBlocks].sort(
			(a, b) => (b.depth ?? 0) - (a.depth ?? 0), // depth 大者更早出现（离末端更远）
		);
		blocks.push(`【预设末端指令】\n${sorted.map((b) => renderPrompt(b.content)).join("\n\n")}`);
	}

	// 运行时附注钉在上下文末端（权重最高），固定语言与用户边界，避免被素材语言带跑。
	const notes: string[] = [];
	if (card.postHistoryInstructions) {
		notes.push(renderPrompt(card.postHistoryInstructions));
	}
	notes.push(`以${config.language}继续叙事与对白（专有名词可保留原文）；不替 ${config.userName} 行动、说话或代述想法。`);
	notes.push(
		`用户消息一律是剧情输入（含怎么办/下一步这类抉择）；禁止助手口吻聊剧情。系统与工具事务不归你管，指给输入框右边的「助手」。`,
	);
	// 字数分级：配置目标 + 长戏/短打覆写；模型无法自计字 → 给区间与体量感，后验纠正
	const targetLabel = `${lenBounds.min}–${lenBounds.max}`;
	let lengthHint =
		`正文字数只计用户可见叙事，本轮目标约 **${targetLabel} 字**（draft_notes/思维链/StatusBlock 不计）。你无法精确自计字：按 ${Math.max(1, Math.round(lenBounds.min / 200))}–${Math.max(2, Math.round(lenBounds.max / 200))} 段中文叙事体量收笔，宁可略短勿灌水。`;
	if (openingChoice) {
		lengthHint =
			"本轮为多开局选定：正文最多一句极短承接；字数以工具调用为准，禁止按默认篇幅灌水。";
	} else if (userText && userSeeksLongForm(userText)) {
		const longMin = Math.max(lenBounds.min, Math.round(lenBounds.max * 0.9));
		const longMax = Math.round(lenBounds.max * 1.6);
		lengthHint =
			`用户要求长戏/铺陈：可见叙事约 **${longMin}–${longMax} 字**；draft_notes/思维链/StatusBlock 不计字。`;
	} else if (userText && userSeeksShortBeat(userText)) {
		const shortMax = Math.max(lenBounds.min, Math.round(lenBounds.min * 1.2));
		lengthHint =
			`本轮短承接/短打：可见叙事约 **${Math.round(lenBounds.min * 0.7)}–${shortMax} 字**，推进一步即可；draft_notes/思维链/StatusBlock 不计字。`;
	}
	notes.push(
		`${lengthHint}**富文本硬性**：本轮至少 1 个 XML（scene/char/inner_voice/StatusBlock）+ 1 个方括号组件（letter/sms/quest/inventory/itemcard/meter/dice/clue/card/callout/profile/relationship…）；有书信/任务/线索/物品等必须上组件，禁止纯散文。场景 title 必填且成对闭合；禁止自造方括号。`,
	);
	if ((config.creationMode ?? "ask") === "ask" && !openingChoice) {
		notes.push(
			`⚠ **Ask Direction 广播**：本轮叙事写完后**必须**调用 ask_director，默认 **3~4** 个互斥选项（【标题】说明…）；禁止替用户决策、禁止正文手写选项、禁止诱导「你该选…」。工具返回前不要替用户收束走向。`,
		);
	}
	if (lengthFeedback && lenBounds.hardCap) {
		const { chars, min, max } = lengthFeedback;
		if (chars > max * 1.15) {
			notes.push(
				`⚠ 字数纠正：上一轮可见正文约 ${chars} 字，超过目标上限 ${max}。本轮压缩到约 ${min}–${max} 字，删冗余氛围与重复对白，推进情节即可。`,
			);
		} else if (chars > 0 && chars < min * 0.7) {
			notes.push(
				`⚠ 字数纠正：上一轮可见正文约 ${chars} 字，低于目标下限 ${min}。本轮充实到约 ${min}–${max} 字：补场面细节与推进，勿用水话灌字。`,
			);
		}
	}
	// 多开局选定（优先于一般求方向）：说明书已在【开场】，本轮只出 ask_director
	if (openingChoice) {
		const opts = (openingOptions ?? []).map((s) => s.trim()).filter(Boolean);
		const optBlock =
			opts.length >= 2
				? opts.map((s) => `【${s.replace(/^【|】$/g, "")}】`).join("")
				: "";
		notes.push(
			[
				`⚠ 强制·多开局选定：历史中的【开场】是多开局说明书/菜单，不是已选定的第一幕。`,
				`你的**第一个动作必须是 ask_director**（function call）：`,
				`- question：用简短场景口吻请用户选定开局（例如「请选定要进入的开局」）。`,
				optBlock
					? `- options：必须使用下列条目（可原样拼接为 options 字符串），禁止漏项、禁止改写成散文：\n${optBlock}`
					: `- options：从【开场】归纳 2~6 个互斥开局标题，用【标题】说明 格式；禁止把整份说明书贴进正文。`,
				`工具返回前禁止写长篇叙事、禁止在正文复述完整开局菜单、禁止手写「选项一/二」或元说明（如「此乃第N页」「请切换页面」）。最多一句极短承接。`,
				`用户选定后（工具结果「用户选择：…」）：从该开局第一幕直接开演，不再询问选哪一页。`,
			].join("\n"),
		);
	} else if ((config.creationMode ?? "ask") === "ask") {
		// Ask Direction：每轮强制；求方向/身份生成时升格为「先工具后正文」
		const seeks = userText ? userSeeksDirection(userText) : false;
		if (seeks) {
			const identity =
				userText &&
				/(生成身份|创建身份|身份生成|开始生成|人设|建档|捏角色|生成角色|创建角色|公民档案|身份认证|定人设|设定身份)/.test(
					userText,
				);
			if (identity) {
				notes.push(
					`⚠ 强制：用户在要求生成/定型身份或人设。你的**第一个动作必须是 ask_director**——3~4 个可点身份/人设草案（出身、职业、性格、关系等）；工具返回前禁止代写完整档案、禁止助手口吻填表。`,
				);
			} else {
				notes.push(
					`⚠ 强制：用户在求方向。你的**第一个动作必须是 ask_director**，3~4 个场景内选项；工具返回前禁止写完整正文、禁止替用户决定。`,
				);
			}
		} else {
			notes.push(
				`Ask Direction：本轮正文后**必须** ask_director（3~4 选项）；禁止替用户决策；禁止正文手写选项。`,
			);
		}
	}
	// 联网开关开启时升格强制 smart_search；关闭时工具也会从模型 schema 移除。
	if (webSearchEnabled) {
		notes.push(
			`⚠ 强制：本轮已开启联网搜索。调用 smart_search；工具会自动复用最近一分钟内的 world_time 并构造带日期的中英文多路查询。本轮无需重复调用 world_time，除非用户直接询问当前时间。工具返回前禁止仅凭训练记忆回答实时事实；综合多个来源后再写回应。`,
		);
	}
	// 语言自愈：上一轮语言错误时升级为显式纠正
	if (languageMismatch) {
		notes.push(
			`⚠ 你上一轮的回复使用了错误的语言。从本轮起，全部叙事与对白必须使用${config.language}（人名、地名等专有名词可保留原文）。这是硬性要求，立即纠正。`,
		);
	}
	blocks.push(`【绘梦附注】\n${notes.join("\n")}`);

	return blocks.join("\n\n");
}

/**
 * 检测文本语言是否与目标语言失配。v0 只实现中文目标的检测
 * （其他语言返回 false，不误报）。用于语言自愈。
 */
export function detectsLanguageMismatch(text: string, language: string): boolean {
	if (!/中文|汉语|chinese/i.test(language)) return false;
	// 去掉空白、标点、数字与标记符号，只统计文字字符
	const letters = text.match(/\p{L}/gu) ?? [];
	if (letters.length < 40) return false; // 样本太短不判定
	const cjk = letters.filter((ch) => /\p{Script=Han}/u.test(ch)).length;
	return cjk / letters.length < 0.3;
}

/** 开场白消息内容（greetingIndex：0=first_mes，1..n=alternate_greetings 第 n 条，越界回落） */
export function buildGreeting(card: CharacterCard, config: RpConfig): string {
	const pool = [card.firstMes, ...card.alternateGreetings];
	const idx = config.greetingIndex ?? 0;
	const mes = (idx >= 0 && idx < pool.length ? pool[idx] : "") || card.firstMes;
	const rendered = applyMacros(mes, { charName: card.name, userName: config.userName });
	if (/^\s*【\s*开场(?:\s*[·・•]\s*[^】]+)?\s*】/.test(rendered)) return rendered;
	return `【开场 · ${card.name}】\n${rendered}`;
}
