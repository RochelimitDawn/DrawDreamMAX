/**
 * DrawDream 叙事流水线辅助纯函数（窗口截断、骰子等）。
 */

export type PipelineMode = "off" | "merged" | "full";

/** n+m 分段稳定前缀窗口：生长到 n+m 后截断最早 m+1 条，回到 n */
export function stableWindow<T>(items: T[], n: number, m: number): T[] {
	const nn = Math.max(0, Math.floor(n));
	const mm = Math.max(0, Math.floor(m));
	if (items.length === 0 || nn === 0) return [];
	const window: T[] = [];
	for (const item of items) {
		window.push(item);
		if (window.length > nn + mm) {
			window.splice(0, mm + 1);
		}
	}
	return window;
}

export type DiceMode = "normal" | "advantage" | "disadvantage" | "exploding";

export interface DiceResult {
	expression: string;
	mode: DiceMode;
	rolls: number[];
	allRolls?: number[][];
	modifier: number;
	total: number;
	explosions?: number[];
	dc?: number | null;
	success?: boolean | null;
	critical?: "success" | "failure" | null;
}

const DICE_RE = /^(\d*)d(\d+)([+-]\d+)?$/i;

/** 解析 1d20、2d6+3 等；非法返回 null */
export function parseDiceExpr(expr: string): { count: number; sides: number; modifier: number } | null {
	const t = expr.replace(/\s+/g, "");
	const m = t.match(DICE_RE);
	if (!m) return null;
	const count = m[1] ? parseInt(m[1], 10) : 1;
	const sides = parseInt(m[2], 10);
	const modifier = m[3] ? parseInt(m[3], 10) : 0;
	if (!Number.isFinite(count) || count < 1 || count > 100) return null;
	if (!Number.isFinite(sides) || sides < 2 || sides > 1000) return null;
	return { count, sides, modifier };
}

function rollOnce(sides: number, rng: () => number): number {
	return 1 + Math.floor(rng() * sides);
}

/**
 * 确定性骰子（可注入 rng 便于测试）。
 * exploding：掷出最大值时追加，深度上限 10。
 */
export function rollDice(
	expr: string,
	mode: DiceMode = "normal",
	opts?: { dc?: number | null; rng?: () => number },
): DiceResult | { error: string } {
	const parsed = parseDiceExpr(expr);
	if (!parsed) return { error: `非法骰子表达式：${expr}` };
	const rng = opts?.rng ?? Math.random;
	const { count, sides, modifier } = parsed;
	const dc = opts?.dc ?? null;

	const rollSet = (): number[] => {
		const rolls: number[] = [];
		for (let i = 0; i < count; i++) rolls.push(rollOnce(sides, rng));
		return rolls;
	};

	let rolls: number[] = [];
	let allRolls: number[][] | undefined;
	let explosions: number[] | undefined;

	if (mode === "advantage" || mode === "disadvantage") {
		const a = rollSet();
		const b = rollSet();
		allRolls = [a, b];
		const sumA = a.reduce((s, x) => s + x, 0);
		const sumB = b.reduce((s, x) => s + x, 0);
		rolls = mode === "advantage" ? (sumA >= sumB ? a : b) : sumA <= sumB ? a : b;
	} else if (mode === "exploding") {
		rolls = rollSet();
		explosions = [];
		let depth = 0;
		let extra = rolls.filter((r) => r === sides);
		while (extra.length > 0 && depth < 10) {
			const next: number[] = [];
			for (const _ of extra) {
				const r = rollOnce(sides, rng);
				explosions.push(r);
				next.push(r);
			}
			extra = next.filter((r) => r === sides);
			depth++;
		}
	} else {
		rolls = rollSet();
	}

	const base = rolls.reduce((s, x) => s + x, 0) + (explosions?.reduce((s, x) => s + x, 0) ?? 0);
	const total = base + modifier;

	let critical: "success" | "failure" | null = null;
	if (mode !== "exploding" && rolls.length === 1) {
		if (rolls[0] === 20 && sides === 20) critical = "success";
		else if (rolls[0] === 1) critical = "failure";
	}

	const success = dc != null ? total >= dc : null;

	return {
		expression: expr.replace(/\s+/g, ""),
		mode,
		rolls,
		allRolls,
		modifier,
		total,
		explosions,
		dc,
		success,
		critical,
	};
}

export function formatDiceResult(r: DiceResult): string {
	const modeLabel =
		r.mode === "advantage" ? " [优势]" : r.mode === "disadvantage" ? " [劣势]" : r.mode === "exploding" ? " [爆炸]" : "";
	const criticalLabel = r.critical === "success" ? " ★大成功" : r.critical === "failure" ? " ★大失败" : "";
	const successText =
		r.critical === "success"
			? "大成功"
			: r.critical === "failure"
				? "大失败"
				: r.success === true
					? "成功"
					: r.success === false
						? "失败"
						: "无DC";
	let rollDetail: string;
	if (r.allRolls && r.allRolls.length === 2) {
		rollDetail = `${r.allRolls[0].join(", ")} 和 ${r.allRolls[1].join(", ")}，取${r.mode === "advantage" ? "高" : "低"}`;
	} else if (r.explosions && r.explosions.length > 0) {
		rollDetail = `${r.rolls.join(", ")}，爆炸: ${r.explosions.join(", ")}`;
	} else {
		rollDetail = r.rolls.join(", ");
	}
	const mod = r.modifier >= 0 ? `+${r.modifier}` : `${r.modifier}`;
	const dcPart = r.dc != null ? ` (DC ${r.dc})` : "";
	return `检定结果${modeLabel}：${r.expression} = [${rollDetail}]${mod} = ${r.total}${dcPart} → ${successText}${criticalLabel}`;
}

/** 规划阶段 JSON（full 模式；P1 仅 schema/解析就绪） */
export interface WritingGuide {
	narrative_direction: string;
	scene_setting: string;
	key_points: string[];
	tone: string;
	pacing: string;
	continuity_notes: string[];
	tool_hints: { tool: string; params?: Record<string, unknown> }[];
	recall_queries: string[];
}

export function emptyWritingGuide(): WritingGuide {
	return {
		narrative_direction: "",
		scene_setting: "",
		key_points: [],
		tone: "中",
		pacing: "中",
		continuity_notes: [],
		tool_hints: [],
		recall_queries: [],
	};
}

function asStringArray(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim());
}

export function parseWritingGuide(text: string): WritingGuide | null {
	let t = text.trim();
	const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fence) t = fence[1].trim();
	const start = t.indexOf("{");
	const end = t.lastIndexOf("}");
	if (start === -1 || end <= start) return null;
	try {
		const obj = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
		const tool_hints: WritingGuide["tool_hints"] = [];
		if (Array.isArray(obj.tool_hints)) {
			for (const h of obj.tool_hints) {
				if (h && typeof h === "object" && typeof (h as { tool?: unknown }).tool === "string") {
					const item = h as { tool: string; params?: unknown };
					tool_hints.push({
						tool: item.tool,
						params:
							item.params && typeof item.params === "object" && !Array.isArray(item.params)
								? (item.params as Record<string, unknown>)
								: undefined,
					});
				}
			}
		}
		// 兼容 narrative-agent 的 tool_calls 字段名
		if (tool_hints.length === 0 && Array.isArray(obj.tool_calls)) {
			for (const h of obj.tool_calls) {
				if (h && typeof h === "object") {
					const item = h as { tool?: unknown; params?: unknown };
					if (typeof item.tool === "string") {
						tool_hints.push({
							tool: item.tool,
							params:
								item.params && typeof item.params === "object" && !Array.isArray(item.params)
									? (item.params as Record<string, unknown>)
									: undefined,
						});
					}
				}
			}
		}
		let recall_queries = asStringArray(obj.recall_queries);
		if (!recall_queries.length && Array.isArray(obj.text_recall)) {
			recall_queries = obj.text_recall.map((n) => String(n)).filter((s) => s.trim().length > 0);
		}
		return {
			narrative_direction: typeof obj.narrative_direction === "string" ? obj.narrative_direction : "",
			scene_setting: typeof obj.scene_setting === "string" ? obj.scene_setting : "",
			key_points: asStringArray(obj.key_points),
			tone: typeof obj.tone === "string" ? obj.tone : "中",
			pacing: typeof obj.pacing === "string" ? obj.pacing : "中",
			continuity_notes: asStringArray(obj.continuity_notes),
			tool_hints,
			recall_queries,
		};
	} catch {
		return null;
	}
}

export function formatWritingGuideForInject(guide: WritingGuide): string {
	const lines: string[] = [];
	if (guide.narrative_direction) lines.push(`叙事方向：${guide.narrative_direction}`);
	if (guide.scene_setting) lines.push(`场景：${guide.scene_setting}`);
	if (guide.key_points.length) lines.push(`要点：\n${guide.key_points.map((k, i) => `${i + 1}. ${k}`).join("\n")}`);
	if (guide.tone || guide.pacing) lines.push(`基调：${guide.tone || "中"}；节奏：${guide.pacing || "中"}`);
	if (guide.continuity_notes.length) lines.push(`延续：${guide.continuity_notes.join("；")}`);
	if (!lines.length) return "";
	return lines.join("\n");
}

export function resolvePipelineMode(config: { pipeline?: { mode?: string } }): PipelineMode {
	const m = config.pipeline?.mode;
	if (m === "off" || m === "merged" || m === "full") return m;
	return "merged";
}
