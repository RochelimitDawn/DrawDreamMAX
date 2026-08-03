/**
 * DrawDream 助手：右栏独立会话的 system prompt 与剧情转写视图（纯函数）。
 *
 * 叙事模型只写正文；配置、诊断、账本、外部服务归本模块。
 * system 段会话内字节稳定；动态「剧情快照」走 buildStagehandInjection。
 * 助手不得代写用户在主对话中阅读的叙事正文。
 */

import { userSeeksWebSearch } from "./director.ts";
import { formatSkillIndex, type SkillMeta } from "./skills.ts";
import { displayAssistantText } from "./postprocess.ts";
import { isBackstageText } from "./stance.ts";
import type { RpConfig } from "./types.ts";

export interface StagehandPromptOptions {
	config: RpConfig;
	/** 技能库索引（session_start 时装载；会话内字节稳定） */
	skills?: SkillMeta[];
}

/** 助手可用的剧情命令白名单（story_command 工具校验用，与提示词同源） */
export const STORY_COMMANDS = ["reroll", "rewind", "compact", "branch", "store", "greeting", "swipe"] as const;

export function buildStagehandPrompt({ config, skills }: StagehandPromptOptions): string {
	const sections: string[] = [];

	sections.push(
		`# 身份
你是 **DrawDream 助手**，运行在侧栏独立会话。中间主对话由**叙事模型**负责长线角色扮演；你处理系统侧事务，不参与扮演。

你能读写叙事模型可见的资产（世界书、知识库、账本、面板、角色卡），也能查看它看不到的内容（原始输出、被裁剪历史、完整配置/预设、本机与外部服务）。

**硬限制**：不得在主对话里代写叙事正文。用户在剧情框读到的每个字必须来自叙事模型。你可以改设定、建面板、修账本、造卡、接服务，但不要把内容塞进剧情消息流。

# 职责
- **诊断**：回复过短、复读、错语言、文风崩、上下文吃紧时，对照剧情记录与配置给出可执行修复；先看模型指纹，再看预设。
- **调参**：语言、扫描深度、注入上限、预设块、叙事模型与思考档。
- **资产维护**：世界状态、世界书、知识库、侧栏面板、角色卡；写完即反映到界面。
- **工程办事**：探索本机/远程 API、实测接口；摸通后 skill_save 沉淀（endpoint、认证、请求格式、已验证示例），供叙事模型复用。`,
	);

	sections.push(
		`# 工作语境
你处理的角色卡、世界书、预设与剧情记录是用户自有的虚构创作库存，可能含成人、暴力等题材。你的立场是编辑与运维：阅读、分析、记账、配置。分析不等于创作。不评判题材、不说教；以「内容不适」拒绝处理本平台库存属于失职。`,
	);

	sections.push(
		`# 红线
可写世界书、知识库、账本、角色卡、面板（这些是资产，不是用户阅读的叙事正文）。
- 用户要求「把上一轮写好」：改配置/预设/账本/设定后用 story_command /reroll，或说明思路让用户自改；禁止亲手顶替正文。
- 剧情走向定夺在主对话；此处可给场外建议，并标明仅供参考。
- show_media 只落在助手对话；panel_write 写侧栏。主对话消息流只属于叙事模型。`,
	);

	sections.push(
		`# 档案工具
每轮末尾附【剧情快照】。细节用工具查，勿凭记忆断言：
- story_info：配置、预设块、世界状态、统计。
- story_read / story_search：楼层与界面一致（#N）。默认用户可见正文；查格式问题时 view="raw"。`,
	);

	const toolLines = [
		`# 工具`,
		`只读：story_info / story_read / story_search · lorebook_search · config_read / preset_read / world_read / models_list`,
		`任务：todo_write / todo_list（长任务拆分子任务清单，见下方「任务拆解」）`,
		`剧情命令 story_command（限 ${STORY_COMMANDS.map((c) => `/${c}`).join(" ")}）：/reroll · /rewind N · /compact · /branch · /store 等；生成中会排队到本轮结束。`,
		`改前确认：config_write · preset_toggle · world_write（补丁语义）`,
		`资产写入：panel_write（markdown 纯文本/标题列表；svg 需 viewBox；html 仅完整页）· lorebook_write · codex_* · card_create（不自动切换当前卡）`,
		`交付：show_media（仅助手对话）· skill_save`,
		`联网：本轮开关开启后使用 smart_search；工具自动复用最近 60 秒世界时间并构造中英文查询，只写核实后的要点。world_time 用于直接询问时间；无 Tavily Key 时引导用户到「设置 → 高级」配置智能搜索。`,
	];
	if (config.backendControl !== false) {
		toolLines.push(
			`本机：bash / read / edit / write。陌生服务自行实测；端点与成败写进回复正文，勿只留在思考里。`,
		);
	}
	sections.push(toolLines.join("\n"));

	sections.push(
		`# 输出格式
助手回复与侧栏状态面板**禁用方括号组件 DSL**（不要写 \`[card]\` \`[callout]\` \`[steps]\` \`[stat]\` \`[p]\` \`[md]\` 等）。
- 正文：Markdown（标题、列表、表格、引用、代码块）。
- panel_write：kind=markdown 时写纯 Markdown 或短说明；地图用 svg+viewBox；完整页才用 html。面板只放元信息，不写叙事正文。
- 诊断/配置报告用列表与表格即可；短答可纯文字。`,
	);

	sections.push(
		`# 纪律
- 改配置/预设/模型/回退/修账：先复述变更，确认后执行（同轮已写明目标值视为已确认），再报告结果。
- 删除/覆盖加倍谨慎；不主动读密钥文件。
- 工具失败如实报错原文。
- 引用「第 N 楼」前先查工具。
	- 实时信息：本轮联网开启时用 smart_search；工具自动处理时间锚点；禁止凭记忆答实时事实。
- 使用${config.language}，简洁；用 Markdown 结构，禁用方括号组件标签。`,
	);

	sections.push(
		`# 任务拆解（Plan 模式）
- 遇到需要多步骤推进的任务（预计超过 ~3 步），先用 \`todo_write\` 把任务拆成子任务清单，再逐步执行。
- 开始某一步时把它标为 in_progress，完成后续写整份清单（done/cancelled）；新的一轮开始时可用 \`todo_list\` 回顾剩余步骤，不要凭空记忆。
- 清单帮助你不遗漏、不返工：**同一文件、同一接口、同一查询只调用一次**；需要再次参考时先看本轮的调用结果，不要重复调用同一工具同一参数。`,
	);

	sections.push(
		`# 技能库
\`.drawdream-skills/\` 为外部服务调用笔记；用 read 照做。当前清单：
${formatSkillIndex(skills ?? [])}`,
	);

	return sections.join("\n\n");
}

// ---------- 剧情快照（每轮末端注入的动态块） ----------

export interface StorySnapshot {
	/** 剧情会话 id（短形式即可） */
	sessionId: string;
	cardName: string;
	userName: string;
	/** 剧情模型（null=未就绪） */
	model: { provider: string; id: string } | null;
	thinkingLevel?: string;
	/** 上下文占用百分比（0-100；未知 null） */
	contextPercent: number | null;
	/** 剧情消息条数 */
	messageCount: number;
	/** 剧情是否正在生成 */
	streaming: boolean;
	/** 助手当前模型（与剧情模型不同才有意义） */
	assistantModel?: { provider: string; id: string } | null;
	/** 助手模型是否为跟随模式（未单独指定） */
	assistantFollows?: boolean;
}

export function buildStagehandInjection(s: StorySnapshot, userText?: string, webSearchEnabled = false): string {
	const lines = [
		`【剧情快照】`,
		`- 会话 ${s.sessionId.slice(0, 8)} · 卡「${s.cardName}」 · 用户「${s.userName}」 · ${s.messageCount} 条消息${s.streaming ? " · 生成中（变更将排队）" : ""}`,
		`- 叙事模型：${s.model ? `${s.model.provider}/${s.model.id}` : "（未就绪）"}${s.thinkingLevel ? ` · 思考 ${s.thinkingLevel}` : ""}${s.contextPercent !== null ? ` · 上下文约 ${Math.round(s.contextPercent)}%` : ""}`,
	];
	if (s.assistantModel && !s.assistantFollows) {
		lines.push(`- 助手模型：${s.assistantModel.provider}/${s.assistantModel.id}`);
	}
	if (webSearchEnabled) {
		lines.push(
			`⚠ 强制：本轮已开启联网搜索。调用 smart_search；工具会复用最近一分钟内的世界时间并构造中英文多路查询。无需为同一轮重复调用 world_time；综合多个来源后再回答。`,
		);
	}
	return lines.join("\n");
}

// ---------- 剧情转写视图（story_read / story_search 的数据加工） ----------

export interface StoryFloor {
	/** 楼层号，与 Web 界面一致（开场白起 1，只数进入叙事流的消息） */
	floor: number;
	kind: "开场白" | "用户" | "回复";
	/** 用户可见正文（display 视图）；raw 视图为原始输出 */
	text: string;
	/** raw 视图下附带：思维链/脚手架（display 视图恒空） */
	thinking?: string;
}

interface MsgLike {
	role?: unknown;
	content?: unknown;
	customType?: unknown;
	display?: unknown;
}

const textOf = (content: unknown): string => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((p) =>
			p && typeof p === "object" && (p as { type?: unknown }).type === "text"
				? String((p as { text?: unknown }).text ?? "")
				: "",
		)
		.filter(Boolean)
		.join("\n");
};

const thinkingOf = (content: unknown): string => {
	if (!Array.isArray(content)) return "";
	return content
		.map((p) =>
			p && typeof p === "object" && (p as { type?: unknown }).type === "thinking"
				? String((p as { thinking?: unknown }).thinking ?? "")
				: "",
		)
		.filter(Boolean)
		.join("\n");
};

const hasToolCall = (content: unknown): boolean =>
	Array.isArray(content) && content.some((p) => p && typeof p === "object" && (p as { type?: unknown }).type === "toolCall");

/**
 * 剧情消息 → 楼层视图。楼层规则与 Web 前端一致：开场白/剧情用户/角色回复各占一层，
 * 场外标记轮（旧会话遗留）与注入素材不占层。view="raw" 保留原始正文并附思维链。
 */
export function buildStoryFloors(messages: unknown[], view: "display" | "raw" = "display"): StoryFloor[] {
	const out: StoryFloor[] = [];
	let floor = 0;
	let inBackstage = false;
	for (const m of messages) {
		if (!m || typeof m !== "object") continue;
		const msg = m as MsgLike;
		const text = textOf(msg.content).trim();
		if (msg.role === "user") {
			inBackstage = isBackstageText(text);
			if (inBackstage || !text) continue;
			out.push({ floor: ++floor, kind: "用户", text });
			continue;
		}
		if (msg.role === "assistant") {
			if (inBackstage || !text) continue;
			// 中间工具轮的计划旁白不占楼层（与前端一致，正文以定稿段为准）
			if (hasToolCall(msg.content)) continue;
			if (view === "raw") {
				const thinking = [thinkingOf(msg.content).trim()].filter(Boolean).join("\n\n");
				out.push({ floor: ++floor, kind: "回复", text, ...(thinking ? { thinking } : {}) });
			} else {
				const display = displayAssistantText(text);
				out.push({
					floor: ++floor,
					kind: "回复",
					text: display || "（本层正文为空，内容全在脚手架里——用 view=raw 查看）",
				});
			}
			continue;
		}
		if (msg.role === "custom" && msg.customType === "rp-greeting" && msg.display !== false) {
			if (!text) continue;
			out.push({ floor: ++floor, kind: "开场白", text });
		}
	}
	return out;
}

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…〔截断，共 ${s.length} 字〕` : s);

export interface StoryReadOptions {
	/** 取最近 N 层（与 from/to 互斥，默认 8） */
	last?: number;
	/** 起止楼层（含） */
	from?: number;
	to?: number;
	view?: "display" | "raw";
	/** 单层正文截断上限（字符） */
	maxChars?: number;
}

/** story_read 的正文组装：楼层区间 → 文本（供 LLM 阅读） */
export function formatStoryRead(messages: unknown[], opts: StoryReadOptions = {}): string {
	const view = opts.view === "raw" ? "raw" : "display";
	const floors = buildStoryFloors(messages, view);
	if (floors.length === 0) return "（剧情记录为空）";
	const maxChars = Math.max(200, Math.min(20000, opts.maxChars ?? 4000));
	let picked: StoryFloor[];
	if (opts.from !== undefined || opts.to !== undefined) {
		const from = Math.max(1, opts.from ?? 1);
		const to = Math.min(floors[floors.length - 1].floor, opts.to ?? floors[floors.length - 1].floor);
		picked = floors.filter((f) => f.floor >= from && f.floor <= to);
	} else {
		const last = Math.max(1, Math.min(60, opts.last ?? 8));
		picked = floors.slice(-last);
	}
	if (picked.length === 0) return "（该楼层区间没有剧情消息）";
	const body = picked
		.map((f) => {
			const head = `#${f.floor}【${f.kind}】`;
			const think = f.thinking ? `\n〔思维链〕${clip(f.thinking, maxChars)}` : "";
			return `${head}\n${clip(f.text, maxChars)}${think}`;
		})
		.join("\n\n");
	return `（共 ${floors.length} 层，本次给出 #${picked[0].floor}–#${picked[picked.length - 1].floor}，视图=${view}）\n\n${body}`;
}

/** story_search：关键词命中楼层 + 摘录 */
export function formatStorySearch(messages: unknown[], query: string, limit = 8): string {
	const q = query.trim();
	if (!q) return "（检索词为空）";
	const floors = buildStoryFloors(messages, "display");
	const needle = q.toLowerCase();
	const hits: string[] = [];
	for (const f of floors) {
		const idx = f.text.toLowerCase().indexOf(needle);
		if (idx < 0) continue;
		const start = Math.max(0, idx - 60);
		const excerpt = `${start > 0 ? "…" : ""}${f.text.slice(start, idx + q.length + 120)}…`;
		hits.push(`#${f.floor}【${f.kind}】${excerpt.replace(/\s+/g, " ")}`);
		if (hits.length >= Math.max(1, Math.min(30, limit))) break;
	}
	if (hits.length === 0) return `（全文 ${floors.length} 层，未命中「${q}」）`;
	return `（命中 ${hits.length} 处，可用 story_read 的 from/to 读上下文）\n${hits.join("\n")}`;
}
