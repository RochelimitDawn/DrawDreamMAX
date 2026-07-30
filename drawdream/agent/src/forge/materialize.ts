/**
 * 将 elevate 产物写入 assets/cards 与 assets/lorebooks，并可选挂载。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CharacterCard, LorebookEntry, RpConfig } from "../types.ts";
import { exportStLorebook, mountedLorebookPaths, setMountedLorebooks } from "../lorebook.ts";
import type { LoreDraftEntry } from "./types.ts";

const CARDS_DIR = "assets/cards";
const LOREBOOKS_DIR = "assets/lorebooks";

function safeFileStem(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "forge";
}

function uniquePath(dir: string, stem: string, ext: string): { abs: string; rel: string; file: string } {
	let file = `${stem}${ext}`;
	let abs = join(dir, file);
	let n = 2;
	while (existsSync(abs)) {
		file = `${stem}-${n}${ext}`;
		abs = join(dir, file);
		n += 1;
	}
	const base = dir.includes(`${join("assets", "cards")}`) || dir.endsWith("cards")
		? CARDS_DIR
		: LOREBOOKS_DIR;
	// rel 用正斜杠
	const relBase = abs.includes("lorebooks") ? LOREBOOKS_DIR : CARDS_DIR;
	return { abs, rel: `${relBase}/${file}`, file };
}

export function loreDraftsToEntries(drafts: LoreDraftEntry[]): LorebookEntry[] {
	return drafts.map((d, i) => ({
		uid: i,
		keys: d.keys,
		secondaryKeys: [],
		comment: d.title,
		content: d.content,
		constant: d.constant,
		enabled: true,
		selective: false,
		order: d.order,
	}));
}

export function cardToV2Json(card: CharacterCard): Record<string, unknown> {
	return {
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name: card.name,
			description: card.description,
			personality: card.personality,
			scenario: card.scenario,
			first_mes: card.firstMes,
			mes_example: card.mesExample,
			system_prompt: card.systemPrompt,
			post_history_instructions: card.postHistoryInstructions,
			creator_notes: card.creatorNotes,
			alternate_greetings: card.alternateGreetings,
			tags: card.tags,
			character_book: {
				entries: card.book.map((e, i) => ({
					id: e.uid || i,
					keys: e.keys,
					secondary_keys: e.secondaryKeys,
					comment: e.comment,
					content: e.content,
					constant: e.constant,
					selective: e.selective,
					enabled: e.enabled,
					insertion_order: e.order,
				})),
			},
		},
	};
}

export interface MaterializeResult {
	cardPath: string;
	lorebookPath: string;
	cardName: string;
	entryCount: number;
	config: RpConfig;
	extraCardPaths: string[];
}

export function materializeForgeAssets(input: {
	cwd: string;
	card: CharacterCard;
	loreDrafts: LoreDraftEntry[];
	config: RpConfig;
	switchCard?: boolean;
	mountLore?: boolean;
	bookName?: string;
	/** 额外角色卡（不切换为当前卡） */
	extraCards?: CharacterCard[];
}): MaterializeResult {
	const { cwd, card, loreDrafts, config } = input;
	const cardsAbs = join(cwd, CARDS_DIR);
	const loreAbs = join(cwd, LOREBOOKS_DIR);
	mkdirSync(cardsAbs, { recursive: true });
	mkdirSync(loreAbs, { recursive: true });

	const stem = safeFileStem(card.name);
	const cardPaths = uniquePath(cardsAbs, stem, ".json");
	const bookStem = safeFileStem(input.bookName || `${card.name}-世界书`);
	const lorePaths = uniquePath(loreAbs, bookStem, ".json");

	const entries = loreDraftsToEntries(loreDrafts);
	const stBook = exportStLorebook(input.bookName || `${card.name}世界书`, entries);
	writeFileSync(cardPaths.abs, `${JSON.stringify(cardToV2Json(card), null, "\t")}\n`, "utf8");
	writeFileSync(lorePaths.abs, `${JSON.stringify(stBook, null, "\t")}\n`, "utf8");

	const extraCardPaths: string[] = [];
	for (const ec of input.extraCards ?? []) {
		if (!ec?.name) continue;
		const p = uniquePath(cardsAbs, safeFileStem(ec.name), ".json");
		writeFileSync(p.abs, `${JSON.stringify(cardToV2Json(ec), null, "\t")}\n`, "utf8");
		extraCardPaths.push(p.rel);
	}

	let next: RpConfig = { ...config };
	if (input.switchCard !== false) {
		next = { ...next, card: cardPaths.rel };
		delete (next as { displayName?: string }).displayName;
		delete (next as { greetingIndex?: number }).greetingIndex;
	}
	if (input.mountLore !== false) {
		const mounted = mountedLorebookPaths(next);
		if (!mounted.includes(lorePaths.rel)) {
			next = setMountedLorebooks(next, [...mounted, lorePaths.rel]);
		}
	}

	return {
		cardPath: cardPaths.rel,
		lorebookPath: lorePaths.rel,
		cardName: card.name,
		entryCount: entries.length,
		config: next,
		extraCardPaths,
	};
}
