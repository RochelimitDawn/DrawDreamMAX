import { createHash } from "node:crypto";
import type { CardRegexScript, CharacterCard, RuntimeDiagnostic, TavernRuntimeManifest } from "./types.ts";

const MAX_SCRIPT_ENTRIES = 64;
const MAX_EXTERNAL_MODULES = 32;
const MAX_PLACEHOLDERS = 64;
const URL_RE = /https?:\/\/[^\s"'`<>]+/gi;
const PLACEHOLDER_RE = /<([A-Za-z][\w.-]*)(?:\s[^>]*)?\s*\/?\s*>/g;

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function uniqueStrings(values: string[], limit: number): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit);
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	const record = asRecord(value);
	if (!record) return JSON.stringify(value);
	return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function fingerprint(card: CharacterCard): string {
	return createHash("sha256").update(stableJson({
		name: card.name,
		description: card.description,
		firstMes: card.firstMes,
		alternateGreetings: card.alternateGreetings,
		book: card.book,
		compat: card.compat,
	})).digest("hex");
}

function collectStrings(value: unknown, output: string[], depth = 0): void {
	if (depth > 8 || output.length >= MAX_EXTERNAL_MODULES * 8) return;
	if (typeof value === "string") {
		output.push(value);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectStrings(item, output, depth + 1);
		return;
	}
	const record = asRecord(value);
	if (!record) return;
	for (const item of Object.values(record)) collectStrings(item, output, depth + 1);
}

function externalModules(extensions: Record<string, unknown>, diagnostics: RuntimeDiagnostic[]): Array<{ url: string }> {
	const strings: string[] = [];
	collectStrings(extensions, strings);
	const urls = uniqueStrings(strings.flatMap((value) => value.match(URL_RE) ?? []), MAX_EXTERNAL_MODULES);
	for (const url of urls) {
		if (!/^https:\/\//i.test(url)) {
			diagnostics.push({ code: "external-module-insecure", level: "error", message: `拒绝非 HTTPS 外部模块：${url}`, path: "extensions" });
			continue;
		}
		if (!/\.(?:js|mjs|cjs|ts)(?:[?#]|$)/i.test(url) && !/\/bundle(?:\.min)?\.js(?:[?#]|$)/i.test(url)) {
			diagnostics.push({ code: "external-resource-unclassified", level: "warning", message: `检测到外部 URL，运行时需要单独确认资源类型：${url}`, path: "extensions" });
		}
	}
	return urls.filter((url) => /^https:\/\//i.test(url)).map((url) => ({ url }));
}

function entrypoints(extensions: Record<string, unknown>): TavernRuntimeManifest["entrypoints"] {
	const values: string[] = [];
	collectStrings(extensions, values);
	const result = { html: [] as string[], css: [] as string[], javascript: [] as string[] };
	for (const value of values) {
		if (/\.(?:html?|htm)(?:[?#]|$)/i.test(value)) result.html.push(value);
		else if (/\.css(?:[?#]|$)/i.test(value)) result.css.push(value);
		else if (/\.(?:js|mjs|cjs|ts)(?:[?#]|$)/i.test(value)) result.javascript.push(value);
	}
	return {
		html: uniqueStrings(result.html, 16),
		css: uniqueStrings(result.css, 16),
		javascript: uniqueStrings(result.javascript, 16),
	};
}

export function mapCardPlaceholder(name: string): { name: string; surface: "state-panel" | "card-ui" } {
	return /^(?:StatusPlaceHolderImpl|statusplaceholderimpl)$/i.test(name)
		? { name, surface: "state-panel" }
		: { name, surface: "card-ui" };
}

function placeholders(card: CharacterCard): string[] {
	const source = [card.firstMes, ...card.alternateGreetings, ...card.book.map((entry) => entry.content)].join("\n");
	const matches: string[] = [];
	let match: RegExpExecArray | null;
	while ((match = PLACEHOLDER_RE.exec(source)) !== null && matches.length < MAX_PLACEHOLDERS) {
		if (match[1]) matches.push(match[1]);
	}
	return uniqueStrings(matches, MAX_PLACEHOLDERS);
}

function extensionScripts(extensions: Record<string, unknown>, diagnostics: RuntimeDiagnostic[]): Record<string, unknown>[] {
	const candidates: unknown[] = [];
	const tavernHelper = asRecord(extensions.tavern_helper ?? extensions.tavernHelper);
	if (tavernHelper?.scripts && Array.isArray(tavernHelper.scripts)) candidates.push(...tavernHelper.scripts);
	// Also check alternative field paths used by some cards
	const jsSlashRunner = asRecord(extensions.js_slash_runner ?? extensions.jsSlashRunner);
	if (jsSlashRunner?.scripts && Array.isArray(jsSlashRunner.scripts)) candidates.push(...jsSlashRunner.scripts);
	if (Array.isArray(extensions.scripts)) candidates.push(...extensions.scripts);
	if (!candidates.length) return [];
	return candidates.slice(0, MAX_SCRIPT_ENTRIES).flatMap((script, index) => {
		const record = asRecord(script);
		if (!record) {
			diagnostics.push({ code: "invalid-extension-script", level: "warning", message: `忽略第 ${index + 1} 个无效扩展脚本`, path: "extensions.scripts" });
			return [];
		}
		return [{ ...record }];
	});
}

function initialVariables(extensions: Record<string, unknown>): Record<string, unknown> {
	for (const candidate of [extensions.variables, extensions.mvu, extensions.stat_data]) {
		const record = asRecord(candidate);
		if (record) return { ...record };
	}
	const tavernHelper = asRecord(extensions.tavern_helper ?? extensions.tavernHelper);
	const nested = asRecord(tavernHelper?.variables);
	return nested ? { ...nested } : {};
}

function requiredCapabilities(card: CharacterCard, scripts: Record<string, unknown>[], modules: Array<{ url: string }>, found: string[]): string[] {
	const capabilities = new Set<string>();
	if (card.compat?.regexScripts.length) capabilities.add("regex.display");
	if (scripts.length) {
		capabilities.add("tavern-helper");
		capabilities.add("variables.read");
		capabilities.add("variables.write");
	}
	if (modules.length) capabilities.add("external.module");
	if (found.length) capabilities.add("card.ui");
	if (found.some((name) => /status|placeholder|mvu/i.test(name))) capabilities.add("mvu.ui");
	return [...capabilities].sort();
}

export function buildTavernRuntimeManifest(card: CharacterCard): TavernRuntimeManifest {
	const diagnostics: RuntimeDiagnostic[] = [];
	const extensions = card.compat?.unknownExtensions ?? {};
	const scripts = extensionScripts(extensions, diagnostics);
	const modules = externalModules(extensions, diagnostics);
	const foundPlaceholders = placeholders(card);
	if (foundPlaceholders.includes("StatusPlaceHolderImpl")) {
		diagnostics.push({ code: "status-placeholder", level: "info", message: "检测到 StatusPlaceHolderImpl，将由 TavernFrameHost 注入兼容运行时", path: "first_mes" });
	}
	if (scripts.some((script) => stringValue(script.type) === "script")) {
		diagnostics.push({ code: "script-execution-required", level: "warning", message: "角色卡包含 TavernHelper 脚本，执行前需要卡片级能力授权", path: "extensions.tavern_helper.scripts" });
	}
	if (modules.length) {
		diagnostics.push({ code: "external-module-required", level: "warning", message: "角色卡引用外部模块，运行时需要网络或本地缓存", path: "extensions" });
	}
	return {
		version: 1,
		cardFingerprint: fingerprint(card),
		entrypoints: entrypoints(extensions),
		uiModules: foundPlaceholders.map((name) => ({ name, placeholder: name, surface: mapCardPlaceholder(name).surface })),
		csp: {
			scriptSrc: ["'self'"],
			styleSrc: ["'self'", "'unsafe-inline'"],
			connectSrc: ["'self'", ...modules.map((module) => new URL(module.url).origin)],
		},
		mobile: { supported: true, safeArea: true, responsiveHeight: true, touchEvents: true },
		requiredCapabilities: requiredCapabilities(card, scripts, modules, foundPlaceholders),
		regexScripts: (card.compat?.regexScripts ?? []).map((script: CardRegexScript) => ({ ...script, placement: [...script.placement], trimStrings: [...script.trimStrings] })),
		extensionScripts: scripts,
		externalModules: modules,
		placeholders: foundPlaceholders,
		worldBooks: card.book.map((entry) => entry.comment || `entry-${entry.uid}`),
		initialVariables: initialVariables(extensions),
		diagnostics,
	};
}
