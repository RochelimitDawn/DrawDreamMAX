import type { CharacterCard, LorebookEntry, MacroContext } from "./types.ts";
import { applyRegexScripts, type RegexTrace } from "./card-regex.ts";
import { scanEntries } from "./lorebook.ts";

export interface TavernMacroContext extends MacroContext {
	lastMessage?: string;
	chatId?: string;
	messageCount?: number;
	date?: string;
	time?: string;
}

export interface MacroTrace {
	macro: string;
	value: string;
	known: boolean;
}

export interface MacroResult {
	text: string;
	traces: MacroTrace[];
}

const macroPattern = /\{\{\s*([^{}]+?)\s*\}\}/g;

function resolveMacro(raw: string, context: TavernMacroContext): { value: string; known: boolean } {
	const key = raw.trim();
	const lower = key.toLowerCase();
	if (lower === "char") return { value: context.charName, known: true };
	if (lower === "user") return { value: context.userName, known: true };
	if (lower === "lastmessage") return { value: context.lastMessage ?? "", known: true };
	if (lower === "chatid") return { value: context.chatId ?? "", known: true };
	if (lower === "messagecount") return { value: String(context.messageCount ?? 0), known: true };
	if (lower === "date") return { value: context.date ?? new Date().toISOString().slice(0, 10), known: true };
	if (lower === "time") return { value: context.time ?? new Date().toISOString().slice(11, 19), known: true };
	if (lower.startsWith("random:")) {
		const values = key.slice(key.indexOf(":") + 1).split("|").map((value) => value.trim()).filter(Boolean);
		return { value: values.length ? values[0] : "", known: values.length > 0 };
	}
	return { value: `{{${raw}}}`, known: false };
}

export function substituteTavernMacros(text: string, context: TavernMacroContext): MacroResult {
	const traces: MacroTrace[] = [];
	const output = text.replace(macroPattern, (full, raw: string) => {
		const resolved = resolveMacro(raw, context);
		traces.push({ macro: raw.trim(), value: resolved.value, known: resolved.known });
		return resolved.value;
	});
	return { text: output, traces };
}

export interface PromptSection {
	id: string;
	kind: "system" | "character" | "persona" | "world-info" | "history" | "post-history" | "agent";
	text: string;
	order: number;
}

export interface PromptAssembly {
	sections: PromptSection[];
	text: string;
	macroTraces: MacroTrace[];
	regexTraces: RegexTrace[];
}

export interface WorldInfoActivation {
	entries: LorebookEntry[];
	scannedText: string;
}

export function activateTavernWorldInfo(input: {
	entries: LorebookEntry[];
	recentMessages: string[];
	scanDepth?: number;
	maxEntries?: number;
}): WorldInfoActivation {
	const depth = Math.max(0, Math.floor(input.scanDepth ?? input.recentMessages.length));
	const recent = input.recentMessages.slice(-depth);
	const scannedText = recent.join("\n\n");
	const constant = input.entries.filter((entry) => entry.enabled && entry.constant);
	const activated = scanEntries(input.entries, scannedText, Math.max(0, input.maxEntries ?? 3));
	const seen = new Set<string>();
	const entries = [...constant, ...activated].filter((entry) => {
		const key = entry.content.trim();
		if (!key || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	return { entries, scannedText };
}

export function assembleTavernPrompt(input: {
	card: CharacterCard;
	macro: TavernMacroContext;
	persona?: string;
	worldInfo?: LorebookEntry[];
	history?: string;
	agent?: string;
	depthPrompt?: string;
	authorNote?: string;
	recentMessages?: string[];
	scanDepth?: number;
	maxWorldInfo?: number;
}): PromptAssembly {
	const sections: PromptSection[] = [];
	if (input.card.systemPrompt.trim()) sections.push({ id: "card-system", kind: "system", text: input.card.systemPrompt, order: 10 });
	const character = [input.card.description, input.card.personality, input.card.scenario].filter(Boolean).join("\n\n");
	if (character) sections.push({ id: "character", kind: "character", text: character, order: 20 });
	if (input.persona?.trim()) sections.push({ id: "persona", kind: "persona", text: input.persona, order: 30 });
	const activatedWorldInfo = input.worldInfo ?? activateTavernWorldInfo({
		entries: input.card.book,
		recentMessages: input.recentMessages ?? (input.history ? [input.history] : []),
		scanDepth: input.scanDepth,
		maxEntries: input.maxWorldInfo,
	}).entries;
	const lore = activatedWorldInfo.filter((entry) => entry.enabled && entry.content.trim()).sort((a, b) => a.order - b.order).map((entry) => entry.content).join("\n\n");
	if (lore) sections.push({ id: "world-info", kind: "world-info", text: lore, order: 40 });
	if (input.history?.trim()) sections.push({ id: "history", kind: "history", text: input.history, order: 50 });
	if (input.agent?.trim()) sections.push({ id: "agent", kind: "agent", text: input.agent, order: 60 });
	if (input.depthPrompt?.trim()) sections.push({ id: "depth-prompt", kind: "post-history", text: input.depthPrompt, order: 65 });
	if (input.authorNote?.trim()) sections.push({ id: "author-note", kind: "post-history", text: input.authorNote, order: 66 });
	if (input.card.postHistoryInstructions.trim()) sections.push({ id: "post-history", kind: "post-history", text: input.card.postHistoryInstructions, order: 70 });
	const macroTraces: MacroTrace[] = [];
	const regexTraces: RegexTrace[] = [];
	const resolved = sections.sort((a, b) => a.order - b.order).map((section) => {
		const result = substituteTavernMacros(section.text, input.macro);
		macroTraces.push(...result.traces);
		const regex = applyRegexScripts(result.text, input.card.compat?.regexScripts ?? [], "prompt");
		regexTraces.push(...regex.traces);
		return { ...section, text: regex.text };
	});
	return { sections: resolved, text: resolved.map((section) => section.text).join("\n\n"), macroTraces, regexTraces };
}
