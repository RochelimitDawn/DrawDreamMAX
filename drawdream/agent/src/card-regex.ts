import type { CardRegexScript } from "./types.ts";

const MAX_PATTERN = 1_000;
const MAX_REPLACEMENT = 8_000;
const MAX_SCRIPTS = 32;

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function numberArray(value: unknown): number[] {
	return Array.isArray(value) ? value.filter((x): x is number => typeof x === "number" && Number.isInteger(x)) : [];
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

/** 读取 ST 的 snake_case/camelCase 两套字段，保持未知扩展原样留在卡文件中。 */
export function normalizeCardRegexScripts(value: unknown): CardRegexScript[] {
	if (!Array.isArray(value)) return [];
	return value.slice(0, MAX_SCRIPTS).flatMap((item, index) => {
		if (!item || typeof item !== "object") return [];
		const raw = item as Record<string, unknown>;
		const scriptName = stringValue(raw.scriptName ?? raw.script_name) || `regex-${index + 1}`;
		const findRegex = stringValue(raw.findRegex ?? raw.find_regex);
		const replaceString = stringValue(raw.replaceString ?? raw.replace_string);
		if (!findRegex || findRegex.length > MAX_PATTERN || replaceString.length > MAX_REPLACEMENT) return [];
		return [{
			id: stringValue(raw.id) || `${index}:${scriptName}`,
			scriptName,
			findRegex,
			replaceString,
			trimStrings: stringArray(raw.trimStrings ?? raw.trim_strings),
			placement: numberArray(raw.placement),
			disabled: raw.disabled === true,
			markdownOnly: raw.markdownOnly === true || raw.markdown_only === true,
			promptOnly: raw.promptOnly === true || raw.prompt_only === true,
			runOnEdit: raw.runOnEdit === true || raw.run_on_edit === true,
			...(typeof raw.minDepth === "number" || typeof raw.min_depth === "number" ? { minDepth: Number(raw.minDepth ?? raw.min_depth) } : {}),
			...(typeof raw.maxDepth === "number" || typeof raw.max_depth === "number" ? { maxDepth: Number(raw.maxDepth ?? raw.max_depth) } : {}),
		}];
	});
}

function compileRegex(source: string): RegExp | null {
	try {
		// ST commonly stores /pattern/flags, while some exports store only pattern.
		const slash = source.match(/^\/(.*)\/([dgimsuvy]*)$/s);
		return slash ? new RegExp(slash[1], slash[2]) : new RegExp(source, "gi");
	} catch {
		return null;
	}
}

export type RegexPlacement = "display" | "prompt" | "user-input" | "world-info" | "reasoning";

export interface RegexTrace {
	scriptId: string;
	scriptName: string;
	placement: RegexPlacement;
	matched: boolean;
	inputLength: number;
	outputLength: number;
	error?: string;
}

function appliesTo(script: CardRegexScript, placement: RegexPlacement, options: { markdownOnly?: boolean; depth?: number; edit?: boolean }): boolean {
	const numeric = placement === "display" ? 2 : placement === "user-input" ? 1 : placement === "prompt" ? 4 : placement === "world-info" ? 5 : 6;
	if (script.disabled || script.promptOnly && placement === "display" || script.markdownOnly && !options.markdownOnly) return false;
	if (script.placement.length > 0 && !script.placement.includes(numeric)) return false;
	if (options.edit && !script.runOnEdit) return false;
	if (options.depth != null && script.minDepth != null && options.depth < script.minDepth) return false;
	if (options.depth != null && script.maxDepth != null && options.depth > script.maxDepth) return false;
	return true;
}

export function applyRegexScripts(text: string, scripts: CardRegexScript[], placement: RegexPlacement, options: { markdownOnly?: boolean; depth?: number; edit?: boolean } = {}): { text: string; traces: RegexTrace[] } {
	let output = text;
	const traces: RegexTrace[] = [];
	for (const script of scripts) {
		if (!appliesTo(script, placement, options)) continue;
		const input = output;
		const regex = compileRegex(script.findRegex);
		if (!regex) {
			traces.push({ scriptId: script.id, scriptName: script.scriptName, placement, matched: false, inputLength: input.length, outputLength: output.length, error: "invalid-regex" });
			continue;
		}
		try {
			const replacement = script.replaceString.replace(/\{\{match\}\}/gi, "$&");
			const next = output.replace(regex, replacement);
			for (const trim of script.trimStrings) if (trim) output = next.split(trim).join("");
			if (script.trimStrings.length === 0) output = next;
			traces.push({ scriptId: script.id, scriptName: script.scriptName, placement, matched: next !== input, inputLength: input.length, outputLength: output.length });
		} catch (error) {
			traces.push({ scriptId: script.id, scriptName: script.scriptName, placement, matched: false, inputLength: input.length, outputLength: output.length, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return { text: output, traces };
}

/**
 * 只执行显示阶段的声明式替换。脚本、网络请求和 ST API 均不会被执行。
 * placement=2 视为显示层；空 placement 也兼容为显示层。
 */
export function applyDisplayRegexScripts(text: string, scripts: CardRegexScript[]): string {
	return applyRegexScripts(text, scripts, "display").text;
}
