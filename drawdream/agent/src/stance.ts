/**
 * OOC / 助手改道路由标记检测（server、wire、楼层计数共用）。
 *
 * 带标记的消息改道右侧「助手」会话（剥标记后送达）；叙事会话只处理剧情输入。
 * 兼容：历史会话中的场外轮折叠显示、不占楼层；账本/swipe 跳过旧场外轮。
 *
 * 标记：`//` 前缀 · `((`/`（（` · 整条 `(…)` / `（…）`
 */
export function isBackstageText(text: string): boolean {
	const t = text.trim();
	if (!t) return false;
	if (t.startsWith("//") || t.startsWith("((") || t.startsWith("（（")) return true;
	const first = t[0];
	const last = t[t.length - 1];
	return (first === "(" || first === "（") && (last === ")" || last === "）");
}

/**
 * 剥掉场外标记，取用户真正想说的话（改道助手会话时用）：
 * `//text`、`((text))`、`（（text））`、整条 `(text)` / `（text）` → text。
 * 剥完为空时返回原文（防御畸形输入）。
 */
export function stripBackstageMarker(text: string): string {
	const t = text.trim();
	if (!t) return t;
	let out = t;
	if (t.startsWith("//")) {
		out = t.slice(2);
	} else if (t.startsWith("((") || t.startsWith("（（")) {
		out = t.slice(2);
		const tail = out.trimEnd();
		if (tail.endsWith("))") || tail.endsWith("））")) out = tail.slice(0, -2);
	} else {
		const first = t[0];
		const last = t[t.length - 1];
		if ((first === "(" || first === "（") && (last === ")" || last === "）")) out = t.slice(1, -1);
	}
	const clean = out.trim();
	return clean || t;
}
