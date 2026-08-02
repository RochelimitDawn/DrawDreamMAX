/**
 * DrawDream wire：Web 与 server 的消息协议。
 *
 * 不 import agent runtime；对 AgentMessage
 * 只做鸭子类型的结构性访问——pi 0.x 漂移时前端零感知，翻译规则可独立单测。
 *
 * narrative 通道文本必须是叙事模型原始输出，翻译只做通道分发与
 * 结构块（thinking/toolCall）的丢弃，绝不改写正文字符。
 */

import { displayAssistantText, extractScaffoldThinking } from "../src/postprocess.ts";
import { applyDisplayRegexScripts } from "../src/card-regex.ts";
import { isBackstageText } from "../src/stance.ts";
import type { RpPanel } from "../src/panels.ts";
import type { WorldState } from "../src/types.ts";

export type { WorldState, RpPanel };
export { isBackstageText };

export type WireChannel =
	| "user"
	| "narrative"
	| "greeting"
	| "import"
	| "info"
	| "backstage"
	| "image"
	| "audio"
	| "video"
	| "choice"
	/** 对话流内嵌 HTML（show_html 工具 / 正文 ```html 块） */
	| "html";

/** ST 式回复变体：挂在 narrative 上；左右箭头切换，agent 只见当前选中 */
export interface WireSwipe {
	/** 0-based 当前变体序号 */
	index: number;
	/** 已有变体条数（0=尚无角色回复，仍可点右生成） */
	total: number;
}

export interface WireMsg {
	/** 会话树条目的稳定 ID；前端重连后复用该值。 */
	id?: string;
	/** 在当前会话文档中的稳定消息序号。 */
	index?: number;
	/** 消息生成时对应的会话修订号。 */
	revision?: number;
	channel: WireChannel;
	/** 发言者显示名（narrative/greeting 为角色名，user 为用户名） */
	name?: string;
	text: string;
	/** 模型思维链（原始输出，UI 折叠呈现；无则缺省） */
	thinking?: string;
	/** user 消息专用：带场外标记（//、（）包裹），该轮助手回复走 backstage 通道 */
	backstage?: boolean;
	/** image / audio / video 通道：资源地址（http(s) 或本服务 /media/ · /audio/） */
	src?: string;
	/** choice 通道专用：选择卡内容（历史重放为已决状态） */
	choice?: WireChoice;
	/**
	 * html 通道专用：文档 HTML（可含完整 <html> 或片段）。
	 */
	html?: string;
	/** html 通道：是否允许 DrawDream bridge 脚本 */
	scripts?: boolean;
	/**
	 * 回复变体（ST swipe）：仅当前分支上最后一轮剧情角色回复携带。
	 * 右箭头在末条时 = 再生成一条（原回复保留在会话树旁支，不产生世界线）。
	 */
	swipe?: WireSwipe;
	/**
	 * 开场白序号（0-based index + 非空总数）。
	 * 挂在 greeting 消息上，避免只靠 /api/card 轮询导致「正文已是第 4 条、角标还是 2」。
	 */
	greetingPick?: { index: number; total: number };
	/** 用量 / 耗时（叙事气泡底栏） */
	meta?: WireMsgMeta;
	/**
	 * 本条消息关联的工具活动（历史重放由 toolCall+toolResult 还原；
	 * 直播时也可由客户端挂上 session.activities）。
	 */
	activities?: WireActivity[];
}

export interface WireIdentity {
	id: string;
	index: number;
	revision?: number;
}

/**
 * 剧情决策选择卡：模型经 ask_director 停笔询问，用户
 * 选选项 / 自由输入 / 停止本回合。选后卡片留痕（answer/stopped 已决态）。
 */
export interface WireChoice {
	/** 未决卡的应答关联 id（choice_reply 回传）；历史重放的已决卡缺省 */
	id?: string;
	question: string;
	/** 模型给的选项列表（默认 3~4，解析无上限）；input 对话框为空数组 */
	options: string[];
	/** 自由输入框占位文本（input 对话框用） */
	placeholder?: string;
	/** 已决：用户的回答（选项原文或自由输入） */
	answer?: string;
	/** 已决：用户停止了本回合（笔还给用户） */
	stopped?: boolean;
}

/** 会话列表条目（SessionManager.list 的裁剪投影，已按当前卡过滤） */
export interface WireSessionInfo {
	path: string;
	id: string;
	name?: string;
	firstMessage: string;
	/** 最后修改时间（epoch ms） */
	modified: number;
	messageCount: number;
	current: boolean;
	/** 末条 user/assistant 消息预览（≤80 字，借鉴 ST 过去聊天信息密度） */
	preview?: string;
	/** 会话所属卡名（rp-card 条目；与当前卡绑定） */
	cardName?: string;
	/** 会话所属卡路径（assets/cards/…；侧栏封面用） */
	cardPath?: string;
}

/** 会话统计（getSessionStats 裁剪投影） */
export interface WireStats {
	userMessages: number;
	assistantMessages: number;
	totalTokens: number;
	cost: number;
	/** 上下文占用百分比（0-100），未知为 null */
	contextPercent: number | null;
	/** 当前估计已装入窗口的 token（与 percent 同源） */
	contextTokens?: number | null;
	/** 当前模型 contextWindow（连接配置可改；未配置时 registry 默认 128000） */
	contextWindow?: number | null;
}

/** 单条叙事回复的用量/耗时（气泡底栏） */
export interface WireMsgMeta {
	/** 输入 token */
	inputTokens?: number;
	/** 输出 token */
	outputTokens?: number;
	/** 合计 token（input+output+cache，优先 totalTokens） */
	totalTokens?: number;
	/** 费用（USD，若有） */
	cost?: number;
	/** 本轮墙钟耗时 ms（服务端时间戳或客户端测量） */
	durationMs?: number;
	/** 首字延迟 ms（客户端测量，可选） */
	ttftMs?: number;
}

/** 过程活动（过程条：工具调用 + 客户端留档的中间旁白） */
export interface WireActivity {
	/**
	 * tool_start / tool_end 由 server 事件产生；
	 * note = 前端捕获的中间旁白（模型在调工具前流式吐出的计划文字，
	 * 服务端把该中间轮从叙事流过滤时，客户端将其留档进过程清单——server 永不发送此类）。
	 */
	kind: "tool_start" | "tool_end" | "note";
	name: string;
	/** start=参数摘要；end=结果摘要（截断）；note=旁白正文（截断） */
	detail?: string;
	/** 搜索主查询词，结构化传输以避免截断 JSON 后丢失 */
	query?: string;
	/** tool_end 专用：是否出错 */
	isError?: boolean;
}

/**
 * 右栏「助手」消息（独立会话，2026-07-14 职责拆分）。
 * 与剧情 WireMsg 分开：助手没有叙事通道语义，只有对话与过程。
 */
export interface AssistantMsg {
	role: "user" | "assistant";
	text: string;
	/** 模型思维链（折叠展示） */
	thinking?: string;
	/** 中间步骤（带工具调用的计划旁白）：面板折进「过程」，只露最终回复 */
	mid?: boolean;
	/** 本条消息期间的工具活动（live 由前端积累；历史由 toolCall+toolResult 还原） */
	activities?: WireActivity[];
	/** 助手交付的媒体（show_media 工具）：在助手对话里内联展示，不进剧情流 */
	media?: { src: string; kind: "image" | "audio" | "video"; caption?: string };
}

/** 助手当前模型信息（模型选择器数据） */
export interface AssistantModelInfo {
	provider: string;
	id: string;
	name: string;
}

/** Server → Client 帧 */
export type ServerFrame =
	| {
			type: "hello";
			/** hello 对齐时的事件位置与会话修订。 */
			sequence?: number;
			sessionRevision?: number;
			sessionId: string;
			charName: string;
			userName: string;
			/** 当前角色卡相对路径（空=未选卡） */
			cardPath?: string;
			messages: WireMsg[];
			state: WorldState | null;
			stats: WireStats | null;
			/** agent 自建面板：当前活跃面板全量（页签序） */
			panels: RpPanel[];
	  }
	| { type: "message"; message: WireMsg; sequence?: number; sessionRevision?: number }
	| { type: "delta"; kind: "text" | "thinking"; delta: string; sequence?: number; sessionRevision?: number }
	| {
			type: "generation";
			generationId: string;
			phase: "start" | "retry" | "end";
			outcome?: "completed" | "aborted" | "failed";
			attempt?: number;
			error?: string;
			sequence?: number;
			sessionRevision?: number;
	  }
	/** 丢弃当前流式半成品（中间 tool 轮被过滤后，避免计划旁白叠进下一轮 / 误落本地气泡） */
	| { type: "stream"; state: "clear"; sequence?: number; sessionRevision?: number }
	| { type: "agent"; state: "start" | "end"; sequence?: number; sessionRevision?: number }
	| { type: "activity"; activity: WireActivity; sequence?: number; sessionRevision?: number }
	| { type: "state"; state: WorldState; sequence?: number; sessionRevision?: number }
	/** agent 自建面板变化（panel_write/close 落盘、rewind 回退）：活跃面板全量推送（同 state 的 fs.watch 机制） */
	| { type: "panels"; panels: RpPanel[]; sequence?: number; sessionRevision?: number }
	| { type: "stats"; stats: WireStats; sequence?: number; sessionRevision?: number }
	| { type: "notify"; level: "info" | "warning" | "error"; text: string; sequence?: number; sessionRevision?: number }
	| { type: "compaction"; state: "start" | "end"; ok?: boolean; sequence?: number; sessionRevision?: number }
	| { type: "sessions"; list: WireSessionInfo[] }
	/** 剧情决策询问（ask_director 停笔）：前端渲染选择卡，等用户应答 */
	| { type: "choice"; id: string; question: string; options: string[]; placeholder?: string }
	/** 询问已决（本端应答成功 / 他端先答 / 超时/中止）：前端把未决卡收敛成留痕态 */
	| { type: "choice_resolved"; id: string; answer?: string; stopped?: boolean }
	/** 助手（右栏独立会话）：全量对齐（连接、面板打开、新对话、换模型后） */
	| {
			type: "assistant_hello";
			messages: AssistantMsg[];
			busy: boolean;
			/** 当前助手模型（null=尚无可用模型） */
			model: AssistantModelInfo | null;
			/** true=未单独指定，跟随剧情模型 */
			follow: boolean;
	  }
	| { type: "assistant_message"; message: AssistantMsg }
	| { type: "assistant_delta"; kind: "text" | "thinking"; delta: string }
	| { type: "assistant_state"; state: "start" | "end" }
	| { type: "assistant_activity"; activity: WireActivity }
	/** Novel Forge 作业进度（按用户工作区广播） */
	| {
			type: "forge_progress";
			jobId: string;
			stage: string;
			percent: number;
			message: string;
			chunkTotal: number;
			chunkDone: number;
			error?: string;
			updatedAt: number;
	  }
	| { type: "error"; text: string; sequence?: number; sessionRevision?: number };

/** Client → Server 帧 */
export type ClientFrame =
	| { type: "prompt"; text: string; webSearch?: boolean }
	| { type: "command"; text: string }
	| { type: "custom_message"; customType: string; content: string; display?: boolean; details?: unknown }
	| { type: "message_update"; id: string; content?: unknown; display?: boolean; details?: unknown }
	| { type: "message_delete"; id: string }
	| { type: "abort" }
	/**
	 * 重新生成最后一轮。
	 * - text 缺省：ST 式——同一条用户消息下新开 sibling 变体（原回复保留，不产生世界线）
	 * - text 给出：编辑用户输入后整轮重来（旧 user+回复进旁支）
	 */
	| { type: "reroll"; text?: string }
	/**
	 * ST 式变体导航 / 再生成（不写世界线）。
	 * prev|next：在同一 user 下的 sibling 间切换；在末条 next = 等同 reroll 无参。
	 * new：强制再生成一条变体。
	 */
	| { type: "swipe"; dir: "prev" | "next" | "new" }
	| { type: "compact" }
	| { type: "sessions" }
	| { type: "open"; path: string }
	/** 剧情决策应答：value=选项原文或自由输入；stop=停止本回合（笔还给用户） */
	| { type: "choice_reply"; id: string; value?: string; stop?: boolean }
	/** 助手（右栏独立会话）：发话 / 停止 / 新对话 / 请求全量 / 选模型（provider+id 均缺省 = 跟随剧情模型） */
	| { type: "assistant_prompt"; text: string; webSearch?: boolean }
	| { type: "assistant_abort" }
	| { type: "assistant_new" }
	| { type: "assistant_sync" }
	| { type: "assistant_model"; provider?: string; id?: string }
	| { type: "new" };

/** 翻译时需要的显示名 */
export interface WireNames {
	charName: string;
	userName: string;
	displayRegexScripts?: import("../src/types.ts").CardRegexScript[];
}

interface MsgLike {
	role?: unknown;
	content?: unknown;
	customType?: unknown;
	display?: unknown;
	details?: unknown;
	toolName?: unknown;
	isError?: unknown;
	usage?: unknown;
	timestamp?: unknown;
}

/** show_image 工具结果 → image 消息（图片通道 §6.5）；非该工具或出错返回 null */
function imageOfToolResult(msg: MsgLike): WireMsg | null {
	if (msg.toolName !== "show_image" || msg.isError === true) return null;
	const img =
		msg.details && typeof msg.details === "object"
			? (msg.details as { rpImage?: { src?: unknown; caption?: unknown } }).rpImage
			: undefined;
	if (!img || typeof img.src !== "string") return null;
	return { channel: "image", text: typeof img.caption === "string" ? img.caption : "", src: img.src };
}

/** show_audio / tts 工具结果 → audio 消息；非该工具或出错返回 null */
function audioOfToolResult(msg: MsgLike): WireMsg | null {
	if ((msg.toolName !== "show_audio" && msg.toolName !== "tts") || msg.isError === true) return null;
	const aud =
		msg.details && typeof msg.details === "object"
			? (msg.details as { rpAudio?: { src?: unknown; caption?: unknown } }).rpAudio
			: undefined;
	if (!aud || typeof aud.src !== "string") return null;
	return { channel: "audio", text: typeof aud.caption === "string" ? aud.caption : "", src: aud.src };
}

/** show_video 工具结果 → video 消息；非该工具或出错返回 null */
function videoOfToolResult(msg: MsgLike): WireMsg | null {
	if (msg.toolName !== "show_video" || msg.isError === true) return null;
	const vid =
		msg.details && typeof msg.details === "object"
			? (msg.details as { rpVideo?: { src?: unknown; caption?: unknown } }).rpVideo
			: undefined;
	if (!vid || typeof vid.src !== "string") return null;
	return { channel: "video", text: typeof vid.caption === "string" ? vid.caption : "", src: vid.src };
}

/** show_html 工具结果 → html 消息（对话流内嵌 UI 底座）；非该工具或出错返回 null */
function htmlOfToolResult(msg: MsgLike): WireMsg | null {
	if (msg.toolName !== "show_html" || msg.isError === true) return null;
	const h =
		msg.details && typeof msg.details === "object"
			? (msg.details as {
					rpHtml?: { html?: unknown; title?: unknown; scripts?: unknown; height?: unknown };
				}).rpHtml
			: undefined;
	if (!h || typeof h.html !== "string" || !h.html.trim()) return null;
	return {
		channel: "html",
		text: typeof h.title === "string" ? h.title : "",
		html: h.html,
		scripts: h.scripts === true,
		// 高度提示塞进 src 字段不合适；前端用 text 作标题，高度用默认
	};
}

/**
 * smart_search / world_time 工具结果不再转成独立 info 气泡。
 * 过程由 activity（tool_start/tool_end → ToolCallChip）展示，可展开 detail 看摘要，避免「chip + 结果气泡」双行。
 */
function searchOfToolResult(_msg: MsgLike): WireMsg | null {
	return null;
}

function timeOfToolResult(_msg: MsgLike): WireMsg | null {
	return null;
}

/**
 * ask_director 工具结果 → choice 消息（决策门禁，）。工具执行完成
 * 时用户已应答，结果里带着已决的选择卡（details.rpChoice），重放即还原留痕态。
 * 非该工具或结构不符返回 null。
 */
function choiceOfToolResult(msg: MsgLike): WireMsg | null {
	if (msg.toolName !== "ask_director") return null;
	const c =
		msg.details && typeof msg.details === "object"
			? (msg.details as { rpChoice?: { question?: unknown; options?: unknown; answer?: unknown; stopped?: unknown } }).rpChoice
			: undefined;
	if (!c || typeof c.question !== "string") return null;
	const options = Array.isArray(c.options)
		? c.options
				.filter((o): o is string => typeof o === "string")
				.map((o) => o.trim().replace(/^(?:选项\s*)?(?:[A-Za-z]|[1-9]\d*)[.、．)\]]\s*/i, "").trim())
				.filter(Boolean)
		: [];
	const choice: WireChoice = { question: c.question, options };
	if (typeof c.answer === "string") choice.answer = c.answer;
	if (c.stopped === true) choice.stopped = true;
	return { channel: "choice", text: "", choice };
}

/** 从消息 content（字符串或内容块数组）提取纯文本，thinking/toolCall 块丢弃 */
function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((p) =>
			p && typeof p === "object" && (p as { type?: unknown }).type === "text"
				? String((p as { text?: unknown }).text ?? "")
				: "",
		)
		.join("");
}

/** 提取 thinking 块文本（UI 折叠显示） */
function thinkingOf(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.map((p) =>
			p && typeof p === "object" && (p as { type?: unknown }).type === "thinking"
				? String((p as { thinking?: unknown }).thinking ?? "")
				: "",
		)
		.filter(Boolean)
		.join("\n");
}

/** assistant 消息 usage → 气泡 meta */
function metaOfAssistant(msg: MsgLike): WireMsgMeta | undefined {
	const u =
		msg.usage && typeof msg.usage === "object"
			? (msg.usage as {
					input?: unknown;
					output?: unknown;
					totalTokens?: unknown;
					cost?: { total?: unknown };
				})
			: undefined;
	if (!u) return undefined;
	const input = typeof u.input === "number" && Number.isFinite(u.input) ? Math.max(0, Math.round(u.input)) : undefined;
	const output =
		typeof u.output === "number" && Number.isFinite(u.output) ? Math.max(0, Math.round(u.output)) : undefined;
	const total =
		typeof u.totalTokens === "number" && Number.isFinite(u.totalTokens)
			? Math.max(0, Math.round(u.totalTokens))
			: input != null || output != null
				? (input ?? 0) + (output ?? 0)
				: undefined;
	const cost =
		u.cost && typeof u.cost.total === "number" && Number.isFinite(u.cost.total) ? u.cost.total : undefined;
	const ts = typeof msg.timestamp === "number" && Number.isFinite(msg.timestamp) ? msg.timestamp : undefined;
	// 仅有时间戳时无法推墙钟；duration 由客户端用流式起止补齐
	if (input == null && output == null && total == null && cost == null && ts == null) return undefined;
	const meta: WireMsgMeta = {};
	if (input != null) meta.inputTokens = input;
	if (output != null) meta.outputTokens = output;
	if (total != null) meta.totalTokens = total;
	if (cost != null && cost > 0) meta.cost = cost;
	return Object.keys(meta).length ? meta : undefined;
}

/** content 是否含 toolCall 块（agent 中间轮会夹带计划旁白 + 工具调用） */
function hasToolCall(content: unknown): boolean {
	if (!Array.isArray(content)) return false;
	return content.some(
		(p) => p && typeof p === "object" && (p as { type?: unknown }).type === "toolCall",
	);
}

/** 从 assistant content 提取 toolCall 名称与参数摘要（对齐 live tool_execution_start detail） */
function toolCallsOf(content: unknown): Array<{ name: string; detail?: string; query?: string }> {
	if (!Array.isArray(content)) return [];
	const out: Array<{ name: string; detail?: string; query?: string }> = [];
	for (const p of content) {
		if (!p || typeof p !== "object") continue;
		if ((p as { type?: unknown }).type !== "toolCall") continue;
		const name = typeof (p as { name?: unknown }).name === "string" ? (p as { name: string }).name : "";
		if (!name) continue;
		let detail = "";
		const args = (p as { arguments?: unknown; args?: unknown }).arguments ?? (p as { args?: unknown }).args;
		const query =
			args && typeof args === "object" && typeof (args as { query?: unknown }).query === "string"
				? (args as { query: string }).query.trim().slice(0, 240)
				: "";
		if (args != null) {
			try {
				detail = JSON.stringify(args);
				if (detail.length > 120) detail = `${detail.slice(0, 120)}…`;
			} catch {
				detail = "";
			}
		}
		out.push({ name, ...(detail ? { detail } : {}), ...(query ? { query } : {}) });
	}
	return out;
}

/** toolResult → 一对 tool_start/tool_end（用于历史重放 ToolCallChip） */
function activitiesOfToolResult(msg: MsgLike, openCall?: { name: string; detail?: string; query?: string }): WireActivity[] {
	const name =
		typeof msg.toolName === "string" && msg.toolName
			? msg.toolName
			: openCall?.name
				? openCall.name
				: "";
	if (!name) return [];
	const start: WireActivity = {
		kind: "tool_start",
		name,
		...(openCall?.detail ? { detail: openCall.detail } : {}),
		...(openCall?.query ? { query: openCall.query } : {}),
	};
	const end: WireActivity = {
		kind: "tool_end",
		name,
		detail: summarizeToolResult(msg),
		isError: msg.isError === true,
	};
	return [start, end];
}

/** 把挂起的工具活动并入目标消息（不可变） */
function withActivities<T extends { activities?: WireActivity[] }>(msg: T, acts: WireActivity[]): T {
	if (!acts.length) return msg;
	return { ...msg, activities: [...(msg.activities ?? []), ...acts] };
}

/**
 * 单条 AgentMessage → WireMsg。不属于叙事流的消息（rp-inject、toolResult、
 * 纯工具轮 / 带 toolCall 的中间 assistant、未知类型）返回 null，调用方跳过。
 * opts.backstage：该轮用户以 // 开头（幕后轮），助手回复走 backstage 通道
 * （显示通道：排版区隔，非上下文切割）。
 */
function toWireMsgBase(m: unknown, names: WireNames, opts?: { backstage?: boolean }): WireMsg | null {
	if (!m || typeof m !== "object") return null;
	const msg = m as MsgLike;
	const text = textOf(msg.content).trim();

	if (msg.role === "user") {
		if (!text) return null;
		return isBackstageText(text)
			? { channel: "user", name: names.userName, text, backstage: true }
			: { channel: "user", name: names.userName, text };
	}
	if (msg.role === "assistant") {
		// 纯工具/思考轮无正文：整条跳过
		if (!text) return null;
		// 含 toolCall 的中间轮：模型常写「先查 X 再落笔」类计划旁白；若进 narrative
		// 会叠出多条角色气泡。工具过程条由 activity 帧承担，最终 stop 正文单独展示。
		// （会话文件仍保留原文；仅影响 Web 显示层。）
		if (hasToolCall(msg.content)) return null;
		const channel: WireChannel = opts?.backstage ? "backstage" : "narrative";
		// 模型原生 thinking 块 + 预设假思维链（<thinking>/<draft_notes>…）折叠展示
		const modelThinking = thinkingOf(msg.content).trim();
		const scaffoldThinking = extractScaffoldThinking(text);
		const thinking = [modelThinking, scaffoldThinking].filter(Boolean).join("\n\n").trim();
		// 显示层剥离脚手架（会话文件仍保留原文；cleanAssistantText 另管送模历史）
		const display = channel === "narrative"
			? applyDisplayRegexScripts(displayAssistantText(text), names.displayRegexScripts ?? [], { charName: names.charName, userName: names.userName })
			: text;
		if (!display && !thinking) return null;
		const meta = metaOfAssistant(msg);
		const base = thinking
			? { channel, name: names.charName, text: display || "（脚手架已折叠，见思维链）", thinking }
			: { channel, name: names.charName, text: display };
		return meta ? { ...base, meta } : base;
	}
	if (msg.role === "custom") {
		if (msg.display === false) return null; // rp-inject 等幕后注入
		if (msg.customType === "rp-greeting") {
			if (!text) return null;
			const pick =
				msg.details && typeof msg.details === "object"
					? (msg.details as { rpGreeting?: { index?: unknown; total?: unknown } }).rpGreeting
					: undefined;
			// index = 非空序位 0-based（角标用 index+1）；total = 非空条数
			const index = typeof pick?.index === "number" && Number.isFinite(pick.index) ? Math.max(0, pick.index) : undefined;
			const total = typeof pick?.total === "number" && Number.isFinite(pick.total) ? Math.max(0, pick.total) : undefined;
			// 开场白同样走皮肤（HTML 开场 / 状态栏正则）
			const greetText = applyDisplayRegexScripts(displayAssistantText(text), names.displayRegexScripts ?? [], { charName: names.charName, userName: names.userName });
			return {
				channel: "greeting",
				name: names.charName,
				text: greetText || text,
				...(index !== undefined && total !== undefined && total > 0
					? { greetingPick: { index, total } }
					: {}),
			};
		}
		/** 用户手改后的角色回复：显示同叙事通道 */
		if (msg.customType === "rp-edited-reply") {
			return text
				? { channel: "narrative", name: names.charName, text: applyDisplayRegexScripts(displayAssistantText(text), names.displayRegexScripts ?? [], { charName: names.charName, userName: names.userName }) }
				: null;
		}
		if (msg.customType === "rp-import") {
			return text ? { channel: "import", text: displayAssistantText(text) } : null;
		}
		// 用户气泡「配音」写入的可展示音频（details.rpAudio；正文尽量不进 LLM 注意力，见 convert 侧仍可能带短标记）
		if (msg.customType === "rp-audio") {
			const aud =
				msg.details && typeof msg.details === "object"
					? (msg.details as { rpAudio?: { src?: unknown; caption?: unknown } }).rpAudio
					: undefined;
			if (aud && typeof aud.src === "string") {
				return {
					channel: "audio",
					text: typeof aud.caption === "string" ? aud.caption : text || "",
					src: aud.src,
				};
			}
		}
		// 其他可显示 custom（压缩摘要横幅等）走 info 通道
		return text ? { channel: "info", text } : null;
	}
	if (msg.role === "toolResult") {
		return (
			imageOfToolResult(msg) ??
			audioOfToolResult(msg) ??
			videoOfToolResult(msg) ??
			htmlOfToolResult(msg) ??
			searchOfToolResult(msg) ??
			timeOfToolResult(msg) ??
			choiceOfToolResult(msg)
		);
	}
	return null; // bash / 未知类型
}

/** 添加会话树稳定身份；普通单条转换保持历史兼容，不强制生成伪 ID。 */
export function toWireMsg(
	m: unknown,
	names: WireNames,
	opts?: { backstage?: boolean; identity?: WireIdentity },
): WireMsg | null {
	const result = toWireMsgBase(m, names, opts);
	if (!result || !opts?.identity) return result;
	return {
		...result,
		id: opts.identity.id,
		index: opts.identity.index,
		...(opts.identity.revision != null ? { revision: opts.identity.revision } : {}),
	};
}

function identityForEntry(raw: unknown, index: number): WireIdentity {
	if (raw && typeof raw === "object") {
		const entry = raw as Record<string, unknown>;
		const nested = entry.message && typeof entry.message === "object" ? (entry.message as Record<string, unknown>) : undefined;
		const id = typeof entry.id === "string" && entry.id.trim()
			? entry.id.trim()
			: typeof nested?.id === "string" && nested.id.trim()
				? nested.id.trim()
				: `session-message-${index}`;
		return { id, index };
	}
	return { id: `session-message-${index}`, index };
}

/**
 * 同一用户输入下的多条 narrative/backstage 折叠进一个气泡。
 * agent 多步工具轮若仍漏出多段正文，重放时也应是一泡而非叠楼。
 * 插图/选择卡等其它通道插在中间不打断「本轮角色泡」归属。
 */
export function foldTurnNarratives(msgs: WireMsg[]): WireMsg[] {
	const out: WireMsg[] = [];
	/** out 内当前剧情轮（上一条非 backstage user 之后）的 narrative/backstage 下标 */
	let turnRoleIdx = -1;
	let turnChannel: "narrative" | "backstage" | null = null;

	const join = (a?: string, b?: string) => [a, b].map((s) => (s ?? "").trim()).filter(Boolean).join("\n\n");

	for (const m of msgs) {
		if (m.channel === "user" && !m.backstage) {
			turnRoleIdx = -1;
			turnChannel = null;
			out.push({ ...m });
			continue;
		}
		if (m.channel === "narrative" || m.channel === "backstage") {
			if (turnRoleIdx >= 0 && turnChannel === m.channel) {
				const prev = out[turnRoleIdx];
				const thinking = join(prev.thinking, m.thinking);
				// meta：后段覆盖前段非空字段（token 常在最终 assistant；墙钟可能在首段）
				const meta =
					prev.meta || m.meta
						? {
								...(prev.meta || {}),
								...(m.meta || {}),
								// 墙钟取更完整的一段（优先已有 duration / ttft）
								durationMs: m.meta?.durationMs ?? prev.meta?.durationMs,
								ttftMs: m.meta?.ttftMs ?? prev.meta?.ttftMs,
								inputTokens: m.meta?.inputTokens ?? prev.meta?.inputTokens,
								outputTokens: m.meta?.outputTokens ?? prev.meta?.outputTokens,
								totalTokens: m.meta?.totalTokens ?? prev.meta?.totalTokens,
								cost: m.meta?.cost ?? prev.meta?.cost,
							}
						: undefined;
				const activities =
					prev.activities?.length || m.activities?.length
						? [...(prev.activities ?? []), ...(m.activities ?? [])]
						: undefined;
				out[turnRoleIdx] = {
					...prev,
					text: join(prev.text, m.text),
					...(thinking ? { thinking } : {}),
					// 变体元数据以最后一段为准（annotateSwipes 挂在末条）
					...(m.swipe ? { swipe: m.swipe } : prev.swipe ? { swipe: prev.swipe } : {}),
					...(m.name ? { name: m.name } : {}),
					...(meta && Object.values(meta).some((v) => v != null) ? { meta } : {}),
					...(activities?.length ? { activities } : {}),
				};
				continue;
			}
			turnRoleIdx = out.length;
			turnChannel = m.channel;
			out.push({ ...m });
			continue;
		}
		out.push({ ...m });
	}
	return out;
}

/** 全量历史 → wire 消息列表（hello 帧用）；沿途跟踪场外标记轮，助手回复分道 */
export function toWireHistory(messages: unknown[], names: WireNames): WireMsg[] {
	const out: WireMsg[] = [];
	let backstage = false;
	/** 未闭合的 toolCall 队列（按出现顺序与后续 toolResult 配对） */
	const pendingCalls: Array<{ name: string; detail?: string }> = [];
	/** 尚无 narrative 气泡可挂时暂存的工具活动（开场工具轮） */
	let orphanActs: WireActivity[] = [];
	/** 本轮（自最近 user 起）最后一条 narrative/backstage 在 out 中的下标 */
	let lastRoleIdx = -1;

	const flushOrphansOnto = (idx: number) => {
		if (idx < 0 || !orphanActs.length) return;
		out[idx] = withActivities(out[idx]!, orphanActs);
		orphanActs = [];
	};

	for (let i = 0; i < messages.length; i += 1) {
		const m = messages[i];
		if (!m || typeof m !== "object") continue;
		const msg = m as MsgLike;
		const role = msg.role;

		if (role === "user") {
			backstage = isBackstageText(textOf(msg.content));
			// 用户新轮：未挂上的 orphan 丢到上轮末泡；开启新轮计数
			if (orphanActs.length && lastRoleIdx >= 0) flushOrphansOnto(lastRoleIdx);
			orphanActs = [];
			lastRoleIdx = -1;
			const w = toWireMsg(msg, names, { backstage, identity: identityForEntry(m, i) });
			if (w) out.push(w);
			continue;
		}

		if (role === "assistant") {
			// 先记下本条 toolCall，再决定是否出 narrative 泡
			const calls = toolCallsOf(msg.content);
			for (const c of calls) pendingCalls.push(c);

			const w = toWireMsg(msg, names, { backstage, identity: identityForEntry(m, i) });
			if (w) {
				if (w.channel === "narrative" || w.channel === "backstage") {
					// 中间轮带 toolCall 的旁白已被 toWireMsg 滤掉；此处为最终定稿
					if (orphanActs.length) {
						out.push(withActivities(w, orphanActs));
						orphanActs = [];
					} else {
						out.push(w);
					}
					lastRoleIdx = out.length - 1;
				} else {
					out.push(w);
				}
			}
			continue;
		}

		if (role === "toolResult") {
			const open = pendingCalls.shift();
			const acts = activitiesOfToolResult(msg, open);
			if (acts.length) {
				if (lastRoleIdx >= 0) {
					out[lastRoleIdx] = withActivities(out[lastRoleIdx]!, acts);
				} else {
					orphanActs.push(...acts);
				}
			}
			// 媒体/抉择等可见通道仍走 toWireMsg
			const w = toWireMsg(msg, names, { backstage, identity: identityForEntry(m, i) });
			if (w) out.push(w);
			continue;
		}

		const w = toWireMsg(msg, names, { backstage, identity: identityForEntry(m, i) });
		if (w) out.push(w);
	}

	// 收尾：剩余 orphan 挂到最后一条角色泡
	if (orphanActs.length && lastRoleIdx >= 0) flushOrphansOnto(lastRoleIdx);

	return foldTurnNarratives(out);
}

/**
 * 助手会话历史 → AssistantMsg 列表（assistant_hello 用）。
 * 只保留 user / assistant 对话面 + show_media 的媒体交付；注入 custom、空轮丢弃；
 * 中间 tool 轮折叠进下一条可见 assistant 的 activities（刷新后 ToolCallChip 不丢）。
 */
export function toAssistantHistory(messages: unknown[]): AssistantMsg[] {
	const out: AssistantMsg[] = [];
	/** 尚未配对的 toolCall（顺序队列） */
	const pendingCalls: Array<{ name: string; detail?: string }> = [];
	/** 已完成的工具活动，挂到下一条可见 assistant */
	let pendingActs: WireActivity[] = [];

	const takeActs = (): WireActivity[] | undefined => {
		if (!pendingActs.length) return undefined;
		const a = pendingActs;
		pendingActs = [];
		return a;
	};

	for (const m of messages) {
		if (!m || typeof m !== "object") continue;
		const msg = m as MsgLike;
		const text = textOf(msg.content).trim();

		if (msg.role === "user") {
			// 用户开口前若仍有未挂工具，并入上一条 assistant（若无则丢弃，避免悬空 chip）
			if (pendingActs.length && out.length) {
				const last = out[out.length - 1]!;
				if (last.role === "assistant") {
					out[out.length - 1] = withActivities(last, pendingActs);
					pendingActs = [];
				}
			}
			if (text) out.push({ role: "user", text });
			continue;
		}

		if (msg.role === "assistant") {
			const calls = toolCallsOf(msg.content);
			for (const c of calls) pendingCalls.push(c);

			const thinking = thinkingOf(msg.content).trim();
			const mid = hasToolCall(msg.content);
			// 纯工具/思考中间轮：不单独出泡，活动等 toolResult 补齐后再并入最终回复
			if (mid && !text && !thinking) continue;
			// 带正文的中间轮（计划旁白）：仍标 mid，不单独展示（前端可按 mid 折叠）；
			// 但若仅有旁白+toolCall，也跳过正文，只保留工具条到最终回复
			if (mid) continue;

			if (!text && !thinking) continue;
			const acts = takeActs();
			out.push({
				role: "assistant",
				text: text || "（本轮只有思考与工具调用）",
				...(thinking ? { thinking } : {}),
				...(acts?.length ? { activities: acts } : {}),
			});
			continue;
		}

		if (msg.role === "toolResult") {
			const open = pendingCalls.shift();
			const acts = activitiesOfToolResult(msg, open);
			if (acts.length) pendingActs.push(...acts);

			const media = assistantMediaOfToolResult(msg);
			if (media) {
				const actsForMedia = takeActs();
				out.push(actsForMedia?.length ? withActivities(media, actsForMedia) : media);
			}
			// smart_search / world_time 等：仅 activities，不生成结果气泡
		}
	}

	// 会话以工具结束（尚无最终 assistant）：把活动挂到最后一条 assistant
	if (pendingActs.length && out.length) {
		const last = out[out.length - 1]!;
		if (last.role === "assistant") {
			out[out.length - 1] = withActivities(last, pendingActs);
		}
	}

	return out;
}

/** show_media 工具结果 → 助手媒体消息；非该工具或结构不符返回 null */
export function assistantMediaOfToolResult(msg: MsgLike): AssistantMsg | null {
	if (msg.toolName !== "show_media" || msg.isError === true) return null;
	const md =
		msg.details && typeof msg.details === "object"
			? (msg.details as { asstMedia?: { src?: unknown; kind?: unknown; caption?: unknown } }).asstMedia
			: undefined;
	if (!md || typeof md.src !== "string") return null;
	const kind = md.kind === "audio" || md.kind === "video" ? md.kind : "image";
	return {
		role: "assistant",
		text: typeof md.caption === "string" ? md.caption : "",
		media: { src: md.src, kind, ...(typeof md.caption === "string" ? { caption: md.caption } : {}) },
	};
}

/**
 * smart_search / world_time 不再生成助手可见气泡（避免与 ToolCallChip 双行）。
 * 保留导出以兼容旧 import；恒返回 null。
 */
export function assistantSearchOfToolResult(_msg: MsgLike): AssistantMsg | null {
	return null;
}

export function assistantTimeOfToolResult(_msg: MsgLike): AssistantMsg | null {
	return null;
}

/**
 * 从会话 JSONL 文本解析 rp-card 自描述条目。
 * 取**最后一条**（换卡后会补写新标记；旧标记可能仍留在文件前部）。
 * 读前若干 KB 通常够；大会话若标记在尾部由调用方扩大窗口。
 */
export function parseCardFromSessionHead(headText: string): { card: string; name: string } | null {
	let found: { card: string; name: string } | null = null;
	for (const line of headText.split(/\r?\n/)) {
		if (!line.includes('"rp-card"')) continue; // 快速跳过
		try {
			const e = JSON.parse(line) as { type?: unknown; customType?: unknown; data?: { card?: unknown; name?: unknown } };
			if (e.type === "custom" && e.customType === "rp-card" && e.data && typeof e.data.card === "string") {
				found = { card: e.data.card, name: typeof e.data.name === "string" ? e.data.name : "" };
			}
		} catch {
			// 半行/损坏行跳过
		}
	}
	return found;
}

/** 工具结果 → 过程条摘要文本（取首个 text 块，截断） */
export function summarizeToolResult(result: unknown, maxChars = 200): string {
	if (!result || typeof result !== "object") return "";
	const content = (result as { content?: unknown }).content;
	if (!Array.isArray(content)) return "";
	for (const p of content) {
		if (p && typeof p === "object" && (p as { type?: unknown }).type === "text") {
			const t = String((p as { text?: unknown }).text ?? "").trim();
			if (t) return t.length > maxChars ? `${t.slice(0, maxChars)}…` : t;
		}
	}
	return "";
}
