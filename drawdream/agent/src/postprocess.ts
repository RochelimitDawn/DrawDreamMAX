/**
 * DrawDream 输出后处理。
 * cleanAssistantText：清洗送入 LLM 的历史（防 few-shot 增殖；磁盘会话保留原文）。
 * displayAssistantText：显示层剥离草稿/注释包装，保留状态栏与 RP 语义标签给前端。
 * 显示层后处理：剥离脚手架并保留结构化内容。
 */


/** 送模历史：整块剥离（含状态栏，避免 few-shot 增殖） */
export const STRIP_BLOCK_TAGS = [
	"descriptive_analysis",
	"normal_status",
	"special_status",
	"thinking",
	"think",
	"draft_notes",
	"draft",
	"reasoning",
	"status",
	"statusbar",
	"StatusBlock",
	"status_block",
	"statusblock",
];

/**
 * 仅显示层剥掉的脚手架（用户不该当正文读的假思维/草稿）。
 * 注意：不含 StatusBlock / normal_status / special_status——那些要进状态面板。
 */
export const DISPLAY_STRIP_SCAFFOLD_TAGS = [
	"descriptive_analysis",
	"thinking",
	"think",
	"draft_notes",
	"draft",
	"reasoning",
];

/** 只拆包装保留内容（正文容器类；场景/人物/心声/状态留给前端 RichMessage） */
export const UNWRAP_BLOCK_TAGS = [
	"plot",
	"splot",
	"content",
	"narrative",
	"main",
	"story",
	"正文",
	"maintext",
	"main_text",
	"message",
	"reply",
];

const escapeReg = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function stripBlocks(text: string, tags: string[]): string {
	let t = text;
	for (const tag of tags) {
		const k = escapeReg(tag);
		t = t.replace(new RegExp(`<${k}(?:\\s[^>]*)?>[\\s\\S]*?</${k}>`, "gi"), "");
		// 悬挂开标签（截断输出）：剥到末尾
		t = t.replace(new RegExp(`<${k}(?:\\s[^>]*)?>[\\s\\S]*$`, "gi"), "");
	}
	return t;
}

function unwrapBlocks(text: string, tags: string[]): string {
	let t = text;
	for (const tag of tags) {
		const k = escapeReg(tag);
		t = t.replace(new RegExp(`<${k}(?:\\s[^>]*)?>([\\s\\S]*?)</${k}>`, "gi"), "$1");
		t = t.replace(new RegExp(`</?${k}(?:\\s[^>]*)?>`, "gi"), "");
	}
	return t;
}

/** 空白收敛 */
function tidyWhitespace(text: string): string {
	return text
		.replace(/[ \t]+$/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** 历史送模用：剥脚手架+状态栏，拆正文包装 */
export function cleanAssistantText(text: string): string {
	let t = stripBlocks(text, STRIP_BLOCK_TAGS);
	t = unwrapBlocks(t, UNWRAP_BLOCK_TAGS);
	return tidyWhitespace(t);
}

/**
 * 显示层用：
 * - 剥假思维链 / 草稿 / 分析
 * - 拆 content/plot 包装，只留叙事
 * - **保留** StatusBlock / normal_status / special_status 给 RichContent 画状态面板
 * - **保留** scene/char 等 RP 语义标签（RichMessage 依赖）
 * - 去掉 HTML 注释与「### 正文」分隔行
 */
export function displayAssistantText(text: string): string {
	let t = text;
	t = stripBlocks(t, DISPLAY_STRIP_SCAFFOLD_TAGS);
	t = unwrapBlocks(t, UNWRAP_BLOCK_TAGS);
	// ST/预设常用 HTML 注释作导演旁注（Prism 等）
	t = t.replace(/<!--[\s\S]*?-->/g, "");
	// 常见分隔标题（单独成行）
	t = t.replace(/^\s*#{1,6}\s*正文\s*$/gim, "");
	t = t.replace(/^\s*#{1,6}\s*(thinking|draft|notes?)\s*$/gim, "");
	// 残留空标签行——保留状态栏与 RP 语义标签给前端
	t = t.replace(
		/^\s*<\/?(?!(?:StatusBlock|status_block|statusblock|normal_status|special_status|status|scene|char|character|inner_voice|innervoice|aside|user|letter|mail|sms|phone|chatlog|diary|journal|note|document|notice|quest|inventory|itemcard|skill|combat|meter|dice|location|time|weather|relationship|profile|memory|secret|clue|evidence|event|chapter|system|broadcast|ask_director|choice|choices|options)\b)[A-Za-z][\w-]*\s*>\s*$/gim,
		"",
	);
	return tidyWhitespace(t);
}

/**
 * 从助手原文中抽出应折叠展示的「假思维链」块（供 UI ThinkingBlock）。
 */
export function extractScaffoldThinking(text: string): string {
	const parts: string[] = [];
	for (const tag of ["thinking", "think", "draft_notes", "draft", "reasoning", "descriptive_analysis"]) {
		const k = escapeReg(tag);
		const re = new RegExp(`<${k}(?:\\s[^>]*)?>([\\s\\S]*?)</${k}>`, "gi");
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			const body = m[1].trim();
			if (body) parts.push(body);
		}
	}
	return parts.join("\n\n---\n\n").trim();
}
