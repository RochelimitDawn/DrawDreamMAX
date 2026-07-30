/**
 * switchToCard 路径选择纯逻辑（与 rest-host 内 cardsMatch / 按卡过滤一致）。
 * 防回归：不得再「随便开一个非当前会话」。
 */
import assert from "node:assert/strict";
import test from "node:test";

function normalizeCardRel(p: string): string {
	return p.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function cardsMatch(a: string, b: string): boolean {
	const na = normalizeCardRel(a);
	const nb = normalizeCardRel(b);
	if (!na || !nb) return false;
	if (na === nb) return true;
	return na.endsWith(`/${nb}`) || nb.endsWith(`/${na}`);
}

type Lite = { path: string; current: boolean; cardPath?: string; modified: number };

function pickSessionForCard(list: Lite[], wantCard: string): Lite | undefined {
	const want = normalizeCardRel(wantCard);
	if (!want) return undefined;
	// 假定 list 已按 modified 倒序
	return list.find((s) => s.cardPath && cardsMatch(s.cardPath, want));
}

test("cardsMatch exact and suffix", () => {
	assert.ok(cardsMatch("assets/cards/a.png", "assets/cards/a.png"));
	assert.ok(cardsMatch("assets/cards/a.png", "./assets/cards/a.png"));
	assert.equal(cardsMatch("assets/cards/a.png", "assets/cards/b.png"), false);
});

test("pickSessionForCard ignores other cards even if not current", () => {
	const list: Lite[] = [
		{ path: "/s/old-other.jsonl", current: false, cardPath: "assets/cards/other.png", modified: 300 },
		{ path: "/s/mine.jsonl", current: false, cardPath: "assets/cards/mine.png", modified: 200 },
		{ path: "/s/cur.jsonl", current: true, cardPath: "assets/cards/other.png", modified: 100 },
	];
	const hit = pickSessionForCard(list, "assets/cards/mine.png");
	assert.equal(hit?.path, "/s/mine.jsonl");
});

test("pickSessionForCard empty when card has no sessions", () => {
	const list: Lite[] = [
		{ path: "/s/a.jsonl", current: true, cardPath: "assets/cards/a.png", modified: 1 },
		{ path: "/s/b.jsonl", current: false, cardPath: "assets/cards/b.png", modified: 2 },
	];
	assert.equal(pickSessionForCard(list, "assets/cards/new.png"), undefined);
});

test("old bug: first non-current is wrong", () => {
	const list: Lite[] = [
		{ path: "/s/wrong.jsonl", current: false, cardPath: "assets/cards/wrong.png", modified: 9 },
		{ path: "/s/right.jsonl", current: false, cardPath: "assets/cards/right.png", modified: 1 },
	];
	const buggy = list.find((s) => !s.current);
	assert.equal(buggy?.path, "/s/wrong.jsonl");
	const fixed = pickSessionForCard(list, "assets/cards/right.png");
	assert.equal(fixed?.path, "/s/right.jsonl");
});
