import type { LorebookEntry } from "./types.ts";

export interface HybridPromptSection {
	id: string;
	kind: "agent" | "search" | "tools" | "sources";
	text: string;
	order: number;
}

export interface HybridPromptInput {
	agent?: string;
	toolResults?: string;
	searchResults?: string;
	sources?: string[];
}

export function buildHybridPromptSections(input: HybridPromptInput): HybridPromptSection[] {
	const sections: HybridPromptSection[] = [];
	if (input.agent?.trim()) sections.push({ id: "drawdream-agent", kind: "agent", text: input.agent.trim(), order: 60 });
	if (input.toolResults?.trim()) sections.push({ id: "drawdream-tools", kind: "tools", text: input.toolResults.trim(), order: 61 });
	if (input.searchResults?.trim()) sections.push({ id: "drawdream-search", kind: "search", text: input.searchResults.trim(), order: 62 });
	const sources = (input.sources ?? []).map((source) => source.trim()).filter(Boolean);
	if (sources.length) sections.push({ id: "source-citations", kind: "sources", text: sources.map((source, index) => `[${index + 1}] ${source}`).join("\n"), order: 63 });
	return sections.sort((a, b) => a.order - b.order);
}

export function formatHybridWorldInfo(entries: LorebookEntry[]): string {
	return entries.filter((entry) => entry.enabled && entry.content.trim()).sort((a, b) => a.order - b.order).map((entry) => `- ${entry.comment ? `【${entry.comment}】` : ""}${entry.content}`).join("\n");
}
