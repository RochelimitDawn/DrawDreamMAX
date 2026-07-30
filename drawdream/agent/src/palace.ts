/**
 * 记忆宫：原文抽屉 + 厅室索引 + 隧道 + 分层唤醒。
 * 一期：jsonl 抽屉、词法检索、sweep/wake。
 * 二期：L0/L1 分层注入、bigram 检索增强、hall/room 索引、跨翼隧道、更智能 sweep 分类。
 * 向量检索 / 外部 embedding 留待后续。
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { dir } from "./paths.ts";

export type PalaceHall = "facts" | "events" | "discoveries" | "preferences" | "promises";

export interface PalaceDrawer {
	id: string;
	wing: string;
	room: string;
	hall: PalaceHall;
	text: string;
	source: "user" | "assistant" | "manual" | "sweep";
	ts: number;
	/** content hash for idempotent writes */
	hash: string;
	/** optional entity/topic tags for tunnels & filters */
	tags?: string[];
}

export interface PalaceSearchHit {
	drawer: PalaceDrawer;
	score: number;
}

/** L0 身份层 + L1 关键事实（短，常驻注入） */
export interface PalaceIdentity {
	wing: string;
	/** 一句角色/翼身份（可空） */
	who: string;
	/** 稳定偏好与硬约束（原文短句） */
	preferences: string[];
	/** 未兑现或长期有效的承诺 */
	promises: string[];
	/** 其它稳定事实 */
	facts: string[];
	updatedAt: number;
}

export interface PalaceTunnel {
	id: string;
	/** 主题标签，如「油纸伞」「旧城门」 */
	topic: string;
	/** 连接的抽屉 id */
	drawerIds: string[];
	/** 涉及的 wing */
	wings: string[];
	ts: number;
}

export interface WakePack {
	/** L0+L1 短文（常驻） */
	identity: string;
	/** L2 相关原文列表正文 */
	episodes: string;
	/** 合并后供 buildTurnInjection 的完整 wake 正文 */
	combined: string;
}

const HALLS: PalaceHall[] = ["facts", "events", "discoveries", "preferences", "promises"];

const PREF_RE =
	/喜欢|偏好|不要|别叫|别提|希望|记住|以后|讨厌|害怕|最爱|请叫|称呼|我是|我叫|别再|务必|一定要|千万/;
const PROMISE_RE = /答应|承诺|保证|约好|说好|发誓|我保证|我会|一定来|下次|等我|约定|立誓/;
const FACT_RE = /真名|本名|真身|身份|其实是|其实是|来自|故乡|姓|本名|真名是|叫做|名讳/;
const DISC_RE = /发现|原来|秘密|揭开|真相|竟然|原来如此|得知|获悉/;

function drawersPath(cwd: string): string {
	return join(dir(cwd, "palace"), "drawers.jsonl");
}

function identityPath(cwd: string): string {
	return join(dir(cwd, "palace"), "identity.json");
}

function tunnelsPath(cwd: string): string {
	return join(dir(cwd, "palace"), "tunnels.jsonl");
}

function ensurePalaceDir(cwd: string): string {
	const d = dir(cwd, "palace");
	if (!existsSync(d)) mkdirSync(d, { recursive: true });
	return d;
}

export function contentHash(text: string): string {
	return createHash("sha1").update(text.trim()).digest("hex").slice(0, 16);
}

export function makeDrawerId(wing: string, hash: string, ts: number): string {
	return `${wing.slice(0, 24)}_${hash}_${ts.toString(36)}`;
}

/** 安全 wing 名：角色卡名或 session 键 */
export function wingKey(name: string): string {
	const s = (name || "default").trim().replace(/[^\w\u4e00-\u9fff.-]+/g, "_").slice(0, 64);
	return s || "default";
}

/**
 * 会话级记忆命名空间（严格隔离：新开对话不继承旧会话记忆）。
 * 格式 s:<sessionId>，经 wingKey 清洗。
 */
export function sessionWing(sessionId: string): string {
	const id = (sessionId || "").trim() || "unknown";
	return wingKey(`s:${id}`);
}

export function isPalaceHall(v: string): v is PalaceHall {
	return (HALLS as string[]).includes(v);
}

export function loadDrawers(cwd: string, wing?: string): PalaceDrawer[] {
	const path = drawersPath(cwd);
	if (!existsSync(path)) return [];
	const out: PalaceDrawer[] = [];
	const raw = readFileSync(path, "utf8");
	for (const line of raw.split("\n")) {
		const t = line.trim();
		if (!t) continue;
		try {
			const d = JSON.parse(t) as PalaceDrawer;
			if (!d || typeof d.text !== "string" || !d.id) continue;
			if (wing && d.wing !== wing) continue;
			out.push(d);
		} catch {
			/* skip bad line */
		}
	}
	return out;
}

export function appendDrawer(
	cwd: string,
	input: {
		wing: string;
		room?: string;
		hall?: PalaceHall;
		text: string;
		source?: PalaceDrawer["source"];
		ts?: number;
		tags?: string[];
	},
): PalaceDrawer | null {
	const text = input.text.trim();
	if (!text || text.length < 8) return null;
	const wing = wingKey(input.wing);
	const hash = contentHash(text);
	const existing = loadDrawers(cwd, wing);
	if (existing.some((d) => d.hash === hash)) return null;

	ensurePalaceDir(cwd);
	const ts = input.ts ?? Date.now();
	const tags = (input.tags || extractTags(text)).slice(0, 12);
	const drawer: PalaceDrawer = {
		id: makeDrawerId(wing, hash, ts),
		wing,
		room: (input.room || "general").slice(0, 80),
		hall: input.hall && HALLS.includes(input.hall) ? input.hall : "events",
		text: text.slice(0, 4000),
		source: input.source ?? "manual",
		ts,
		hash,
		tags: tags.length ? tags : undefined,
	};
	appendFileSync(drawersPath(cwd), `${JSON.stringify(drawer)}\n`, "utf8");
	// 关键 L0/L1 与隧道（轻量、同步）
	if (drawer.hall === "preferences" || drawer.hall === "promises" || drawer.hall === "facts") {
		mergeIdentityFromDrawer(cwd, drawer);
	}
	maybeLinkTunnels(cwd, drawer);
	return drawer;
}

/** 从正文抽短标签：中文 2–4 字专名倾向 + 英文词 */
export function extractTags(text: string): string[] {
	const tags: string[] = [];
	const en = text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
	for (const w of en) {
		if (w.length <= 24) tags.push(w);
	}
	// 连续中文专名候选：2–4 字，过滤极常见字串
	const zhRuns = text.match(/[\u4e00-\u9fff]{2,8}/g) ?? [];
	const stop = new Set([
		"一个",
		"我们",
		"你们",
		"他们",
		"什么",
		"怎么",
		"因为",
		"所以",
		"然后",
		"已经",
		"可以",
		"没有",
		"知道",
		"时候",
		"自己",
		"这个",
		"那个",
		"这里",
		"那里",
		"现在",
		"今天",
		"明天",
		"昨天",
		"一下",
		"一些",
		"不是",
		"只是",
		"还是",
		"如果",
		"但是",
		"而且",
		"或者",
		"开始",
		"继续",
		"忽然",
		"突然",
		"轻轻",
		"慢慢",
	]);
	for (const run of zhRuns) {
		if (run.length >= 2 && run.length <= 4 && !stop.has(run)) tags.push(run);
		if (run.length > 4) {
			for (let i = 0; i <= run.length - 2 && tags.length < 20; i++) {
				const g = run.slice(i, i + 2);
				if (!stop.has(g)) tags.push(g);
			}
		}
	}
	return [...new Set(tags)].slice(0, 12);
}

export function inferHall(text: string, _role: "user" | "assistant"): PalaceHall {
	if (PROMISE_RE.test(text)) return "promises";
	if (PREF_RE.test(text)) return "preferences";
	// 发现句优先于事实（常含「真名」「原来」等）
	if (DISC_RE.test(text)) return "discoveries";
	if (FACT_RE.test(text)) return "facts";
	return "events";
}

// ---------- Identity (L0/L1) ----------

function emptyIdentity(wing: string): PalaceIdentity {
	return {
		wing: wingKey(wing),
		who: "",
		preferences: [],
		promises: [],
		facts: [],
		updatedAt: 0,
	};
}

export function loadIdentity(cwd: string, wing: string): PalaceIdentity {
	const path = identityPath(cwd);
	const key = wingKey(wing);
	if (!existsSync(path)) return emptyIdentity(key);
	try {
		const all = JSON.parse(readFileSync(path, "utf8")) as Record<string, PalaceIdentity>;
		const id = all[key];
		if (!id) return emptyIdentity(key);
		return {
			wing: key,
			who: id.who || "",
			preferences: Array.isArray(id.preferences) ? id.preferences : [],
			promises: Array.isArray(id.promises) ? id.promises : [],
			facts: Array.isArray(id.facts) ? id.facts : [],
			updatedAt: id.updatedAt || 0,
		};
	} catch {
		return emptyIdentity(key);
	}
}

export function saveIdentity(cwd: string, identity: PalaceIdentity): void {
	ensurePalaceDir(cwd);
	const path = identityPath(cwd);
	let all: Record<string, PalaceIdentity> = {};
	if (existsSync(path)) {
		try {
			all = JSON.parse(readFileSync(path, "utf8")) as Record<string, PalaceIdentity>;
		} catch {
			all = {};
		}
	}
	const key = wingKey(identity.wing);
	all[key] = { ...identity, wing: key, updatedAt: Date.now() };
	writeFileSync(path, `${JSON.stringify(all, null, 2)}\n`, "utf8");
}

function pushUnique(list: string[], line: string, max: number): void {
	const t = line.trim().slice(0, 160);
	if (t.length < 6) return;
	if (list.some((x) => x === t || contentHash(x) === contentHash(t))) return;
	// 近重复：包含关系
	if (list.some((x) => x.includes(t) || t.includes(x))) return;
	list.unshift(t);
	while (list.length > max) list.pop();
}

export function mergeIdentityFromDrawer(cwd: string, drawer: PalaceDrawer): PalaceIdentity {
	const id = loadIdentity(cwd, drawer.wing);
	const line = drawer.text.replace(/\s+/g, " ").trim().slice(0, 160);
	if (drawer.hall === "preferences") pushUnique(id.preferences, line, 8);
	else if (drawer.hall === "promises") pushUnique(id.promises, line, 6);
	else if (drawer.hall === "facts") pushUnique(id.facts, line, 8);
	if (!id.who && drawer.hall === "facts" && line.length <= 80) {
		id.who = line;
	}
	saveIdentity(cwd, id);
	return id;
}

/** 从本翼抽屉重建 L1（运维/测试） */
export function rebuildIdentity(cwd: string, wing: string): PalaceIdentity {
	const key = wingKey(wing);
	const id = emptyIdentity(key);
	const drawers = loadDrawers(cwd, key).sort((a, b) => b.ts - a.ts);
	for (const d of drawers) {
		const line = d.text.replace(/\s+/g, " ").trim().slice(0, 160);
		if (d.hall === "preferences") pushUnique(id.preferences, line, 8);
		else if (d.hall === "promises") pushUnique(id.promises, line, 6);
		else if (d.hall === "facts") pushUnique(id.facts, line, 8);
	}
	if (!id.who && id.facts[0]) id.who = id.facts[0]!;
	saveIdentity(cwd, id);
	return id;
}

export function formatIdentityBlock(id: PalaceIdentity): string {
	const lines: string[] = [];
	if (id.who) lines.push(`身份：${id.who}`);
	if (id.preferences.length) lines.push(`偏好：${id.preferences.slice(0, 5).join("；")}`);
	if (id.promises.length) lines.push(`承诺：${id.promises.slice(0, 4).join("；")}`);
	if (id.facts.length) lines.push(`事实：${id.facts.slice(0, 5).join("；")}`);
	return lines.join("\n");
}

// ---------- Tunnels ----------

export function loadTunnels(cwd: string): PalaceTunnel[] {
	const path = tunnelsPath(cwd);
	if (!existsSync(path)) return [];
	const out: PalaceTunnel[] = [];
	for (const line of readFileSync(path, "utf8").split("\n")) {
		const t = line.trim();
		if (!t) continue;
		try {
			const x = JSON.parse(t) as PalaceTunnel;
			if (x?.topic && Array.isArray(x.drawerIds)) out.push(x);
		} catch {
			/* skip */
		}
	}
	return out;
}

function saveTunnelAppend(cwd: string, tunnel: PalaceTunnel): void {
	ensurePalaceDir(cwd);
	appendFileSync(tunnelsPath(cwd), `${JSON.stringify(tunnel)}\n`, "utf8");
}

function rewriteTunnels(cwd: string, tunnels: PalaceTunnel[]): void {
	ensurePalaceDir(cwd);
	const body = tunnels.map((t) => JSON.stringify(t)).join("\n");
	writeFileSync(tunnelsPath(cwd), body ? `${body}\n` : "", "utf8");
}

/**
 * 同 topic 标签的抽屉连成隧道；跨 wing 自动合并。
 * 仅在 tags 命中已有其它抽屉时创建/更新。
 */
export function maybeLinkTunnels(cwd: string, drawer: PalaceDrawer): PalaceTunnel[] {
	const tags = drawer.tags?.filter((t) => t.length >= 2) ?? [];
	if (tags.length === 0) return [];
	const all = loadDrawers(cwd);
	const tunnels = loadTunnels(cwd);
	const touched: PalaceTunnel[] = [];

	for (const topic of tags.slice(0, 4)) {
		const peers = all.filter(
			(d) => d.id !== drawer.id && (d.tags?.includes(topic) || d.text.includes(topic)),
		);
		if (peers.length === 0) continue;

		const ids = [...new Set([drawer.id, ...peers.map((p) => p.id)])].slice(0, 12);
		const wings = [
			...new Set([drawer.wing, ...peers.map((p) => p.wing)]),
		];
		let existing = tunnels.find((t) => t.topic === topic);
		if (existing) {
			existing.drawerIds = [...new Set([...existing.drawerIds, ...ids])].slice(0, 12);
			existing.wings = [...new Set([...existing.wings, ...wings])];
			existing.ts = Date.now();
			touched.push(existing);
		} else {
			const tunnel: PalaceTunnel = {
				id: `tun_${contentHash(topic)}_${Date.now().toString(36)}`,
				topic,
				drawerIds: ids,
				wings,
				ts: Date.now(),
			};
			tunnels.push(tunnel);
			touched.push(tunnel);
		}
	}

	if (touched.length) rewriteTunnels(cwd, tunnels);
	return touched;
}

export function searchTunnels(cwd: string, query: string, limit = 5): PalaceTunnel[] {
	const toks = tokens(query);
	if (toks.length === 0) return [];
	const tunnels = loadTunnels(cwd);
	const scored = tunnels
		.map((t) => {
			const body = `${t.topic} ${t.wings.join(" ")}`.toLowerCase();
			let score = 0;
			for (const k of toks) {
				if (body.includes(k) || t.topic.includes(k)) score += k.length >= 2 ? 3 : 1;
			}
			return { t, score };
		})
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score);
	return scored.slice(0, limit).map((x) => x.t);
}

// ---------- Index / rooms ----------

export interface RoomIndexEntry {
	room: string;
	hall: PalaceHall;
	count: number;
	lastTs: number;
}

export function listRooms(cwd: string, wing: string): RoomIndexEntry[] {
	const map = new Map<string, RoomIndexEntry>();
	for (const d of loadDrawers(cwd, wingKey(wing))) {
		const key = `${d.room}\0${d.hall}`;
		const cur = map.get(key);
		if (!cur) {
			map.set(key, { room: d.room, hall: d.hall, count: 1, lastTs: d.ts });
		} else {
			cur.count++;
			if (d.ts > cur.lastTs) cur.lastTs = d.ts;
		}
	}
	return [...map.values()].sort((a, b) => b.lastTs - a.lastTs || b.count - a.count);
}

// ---------- Search ----------

/** 分词：中文 bigram + 单字弱权 + 英文词 */
function tokens(q: string): string[] {
	const lower = q.toLowerCase();
	const en = lower.match(/[a-z0-9_]{2,}/g) ?? [];
	const zh = lower.match(/[\u4e00-\u9fff]+/g) ?? [];
	const grams: string[] = [];
	for (const run of zh) {
		if (run.length === 1) grams.push(run);
		else {
			for (let i = 0; i < run.length - 1; i++) grams.push(run.slice(i, i + 2));
			if (run.length >= 3) {
				for (let i = 0; i < run.length - 2; i++) grams.push(run.slice(i, i + 3));
			}
		}
	}
	return [...new Set([...en, ...grams])].filter(Boolean);
}

export function searchDrawers(
	cwd: string,
	query: string,
	opts?: {
		wing?: string;
		hall?: PalaceHall;
		room?: string;
		limit?: number;
		/** 是否沿隧道扩展到其它 wing 的抽屉 */
		followTunnels?: boolean;
	},
): PalaceSearchHit[] {
	const limit = opts?.limit ?? 5;
	const toks = tokens(query);
	if (toks.length === 0) return [];
	const wing = opts?.wing ? wingKey(opts.wing) : undefined;
	let drawers = loadDrawers(cwd, wing);

	if (opts?.followTunnels && wing) {
		const tuns = searchTunnels(cwd, query, 3);
		const extraIds = new Set<string>();
		for (const t of tuns) {
			for (const id of t.drawerIds) extraIds.add(id);
		}
		if (extraIds.size) {
			const all = loadDrawers(cwd);
			const have = new Set(drawers.map((d) => d.id));
			for (const d of all) {
				if (extraIds.has(d.id) && !have.has(d.id)) drawers.push(d);
			}
		}
	}

	const hits: PalaceSearchHit[] = [];
	const now = Date.now();
	const qLower = query.toLowerCase().trim();

	for (const d of drawers) {
		if (opts?.hall && d.hall !== opts.hall) continue;
		if (opts?.room && d.room !== opts.room) continue;
		const body = `${d.room} ${d.hall} ${(d.tags || []).join(" ")} ${d.text}`.toLowerCase();
		let score = 0;

		// 整句/子串强命中
		if (qLower.length >= 2 && body.includes(qLower)) score += 12;

		for (const t of toks) {
			if (!body.includes(t)) continue;
			score += t.length >= 3 ? 4 : t.length >= 2 ? 3 : 1;
			const c = body.split(t).length - 1;
			if (c > 1) score += Math.min(c - 1, 3);
		}

		// hall 与查询意图弱对齐
		if (/喜欢|偏好|不要|称呼/.test(query) && d.hall === "preferences") score += 2;
		if (/答应|承诺|保证|约定/.test(query) && d.hall === "promises") score += 2;
		if (/发现|秘密|真相/.test(query) && d.hall === "discoveries") score += 2;

		if (score <= 0) continue;

		const ageDays = (now - d.ts) / 86_400_000;
		if (ageDays < 7) score += 2;
		else if (ageDays < 30) score += 1;

		// 本翼优先
		if (wing && d.wing === wing) score += 1;

		hits.push({ drawer: d, score });
	}

	hits.sort((a, b) => b.score - a.score || b.drawer.ts - a.drawer.ts);
	return hits.slice(0, limit);
}

// ---------- Wake (L0/L1 + L2) ----------

/** 会话开始 / 每轮注入：身份层 + 相关/最近原文 */
export function formatWakeContext(
	cwd: string,
	opts: { wing: string; query?: string; limit?: number },
): string {
	return buildWakePack(cwd, opts).combined;
}

export function buildWakePack(
	cwd: string,
	opts: { wing: string; query?: string; limit?: number },
): WakePack {
	const limit = opts.limit ?? 4;
	const wing = wingKey(opts.wing);
	const id = loadIdentity(cwd, wing);
	const identity = formatIdentityBlock(id);

	let picks: PalaceDrawer[] = [];
	if (opts.query?.trim()) {
		picks = searchDrawers(cwd, opts.query, {
			wing,
			limit,
			followTunnels: true,
		}).map((h) => h.drawer);
	}
	if (picks.length < limit) {
		// 优先 preferences/promises/facts 再 events
		const hallOrder: PalaceHall[] = ["promises", "preferences", "facts", "discoveries", "events"];
		const recent = loadDrawers(cwd, wing)
			.sort((a, b) => {
				const ha = hallOrder.indexOf(a.hall);
				const hb = hallOrder.indexOf(b.hall);
				if (ha !== hb) return ha - hb;
				return b.ts - a.ts;
			})
			.filter((d) => !picks.some((p) => p.id === d.id))
			.slice(0, limit - picks.length);
		picks = [...picks, ...recent];
	}

	const episodes = picks
		.map((d) => {
			const when = new Date(d.ts).toISOString().slice(0, 16).replace("T", " ");
			const head = d.room !== "general" ? `【${d.room}/${d.hall}】` : `【${d.hall}】`;
			const body = d.text.length > 280 ? `${d.text.slice(0, 280)}…` : d.text;
			const wingMark = d.wing !== wing ? `(翼:${d.wing})` : "";
			return `- ${when} ${head}${wingMark}${body}`;
		})
		.join("\n");

	const parts: string[] = [];
	if (identity) parts.push(`〔常驻·L0/L1〕\n${identity}`);
	if (episodes) parts.push(`〔情景·L2〕\n${episodes}`);
	return {
		identity,
		episodes,
		combined: parts.join("\n"),
	};
}

/**
 * 从一轮对话原文写入抽屉（idempotent）。
 * 用户句 → preferences/promises/events；助手最终叙述 → events/discoveries。
 */
export function sweepTurn(
	cwd: string,
	opts: {
		wing: string;
		userText: string;
		assistantText: string;
		room?: string;
	},
): number {
	const wing = wingKey(opts.wing);
	const room = opts.room || "general";
	let n = 0;
	const user = opts.userText.trim();
	if (user.length >= 12 && user.length <= 2000 && !user.startsWith("/")) {
		const hall = inferHall(user, "user");
		if (
			appendDrawer(cwd, {
				wing,
				room,
				hall,
				text: user,
				source: "user",
				tags: extractTags(user),
			})
		)
			n++;
	}
	const asst = opts.assistantText.trim();
	if (asst.length >= 40) {
		const clean = asst
			.replace(/<\/?(?:tool|function)[^>]*>/gi, " ")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
		const chunk = clean.length > 1200 ? clean.slice(0, 1200) : clean;
		const hall = inferHall(chunk, "assistant");
		// 助手长叙事默认 events；仅明确发现句进 discoveries
		const finalHall = hall === "discoveries" ? "discoveries" : "events";
		if (
			appendDrawer(cwd, {
				wing,
				room,
				hall: finalHall,
				text: chunk,
				source: "assistant",
				tags: extractTags(chunk),
			})
		)
			n++;

		// 从助手正文再抽一条短承诺/偏好（若有对话引号句）
		const quoted = chunk.match(/[「『"]([^」』"]{8,80})[」』"]/);
		if (quoted?.[1] && (PROMISE_RE.test(quoted[1]) || PREF_RE.test(quoted[1]))) {
			if (
				appendDrawer(cwd, {
					wing,
					room,
					hall: inferHall(quoted[1], "assistant"),
					text: quoted[1],
					source: "sweep",
					tags: extractTags(quoted[1]),
				})
			)
				n++;
		}
	}
	return n;
}

/** 测试/运维：重写整个 jsonl（谨慎） */
export function rewriteDrawers(cwd: string, drawers: PalaceDrawer[]): void {
	ensurePalaceDir(cwd);
	const body = drawers.map((d) => JSON.stringify(d)).join("\n");
	writeFileSync(drawersPath(cwd), body ? `${body}\n` : "", "utf8");
}
