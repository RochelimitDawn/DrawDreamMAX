import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, after } from "node:test";

import {
	appendDrawer,
	buildWakePack,
	formatWakeContext,
	inferHall,
	listRooms,
	loadDrawers,
	loadIdentity,
	loadTunnels,
	rebuildIdentity,
	searchDrawers,
	searchTunnels,
	sessionWing,
	sweepTurn,
	wingKey,
} from "../src/palace.ts";

const root = mkdtempSync(join(tmpdir(), "dd-palace-"));
after(() => {
	try {
		rmSync(root, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});

describe("palace memory", () => {
	it("wingKey sanitizes", () => {
		assert.equal(wingKey("  青梧·雨夜  "), "青梧_雨夜");
	});

	it("sessionWing isolates by sessionId", () => {
		const a = sessionWing("sess-aaa-111");
		const b = sessionWing("sess-bbb-222");
		assert.notEqual(a, b);
		assert.match(a, /^s_/);
		appendDrawer(root, {
			wing: a,
			text: "会话A里用户承诺只在本场使用血色车票。",
			hall: "promises",
		});
		appendDrawer(root, {
			wing: b,
			text: "会话B里用户说他讨厌下雨天出门。",
			hall: "preferences",
		});
		const hitsA = searchDrawers(root, "血色车票", { wing: a, limit: 5 });
		const hitsB = searchDrawers(root, "血色车票", { wing: b, limit: 5 });
		assert.equal(hitsA.length, 1);
		assert.equal(hitsB.length, 0);
		const wakeB = formatWakeContext(root, { wing: b, query: "血色车票", limit: 4 });
		assert.ok(!wakeB.includes("血色车票"));
	});

	it("append is idempotent by content hash", () => {
		const a = appendDrawer(root, {
			wing: "demo",
			text: "用户说不要叫他小明，要叫阿远。",
			hall: "preferences",
		});
		assert.ok(a);
		const b = appendDrawer(root, {
			wing: "demo",
			text: "用户说不要叫他小明，要叫阿远。",
			hall: "preferences",
		});
		assert.equal(b, null);
		assert.equal(loadDrawers(root, "demo").length, 1);
	});

	it("search finds Chinese keywords", () => {
		appendDrawer(root, {
			wing: "demo",
			room: "name",
			hall: "preferences",
			text: "阿远不喜欢别人提起旧城门的血色车票。",
			source: "manual",
		});
		const hits = searchDrawers(root, "血色车票", { wing: "demo", limit: 3 });
		assert.ok(hits.length >= 1);
		assert.ok(hits[0]!.drawer.text.includes("血色车票"));
	});

	it("sweepTurn stores user and assistant", () => {
		const n = sweepTurn(root, {
			wing: "卡A",
			userText: "我想去听雨轩找青梧，记住我带了油纸伞。",
			assistantText:
				"夜雨敲在听雨轩的廊瓦上。青梧抬眼看见你袖口的水渍，声音很轻：「伞呢？」风从门缝里挤进来，烛火晃了一下。",
			room: "听雨轩",
		});
		assert.ok(n >= 1);
		const wake = formatWakeContext(root, { wing: "卡A", query: "油纸伞", limit: 4 });
		assert.ok(wake.includes("油纸伞") || wake.length > 0);
	});

	it("inferHall classifies promises and preferences", () => {
		assert.equal(inferHall("我保证下次一定带油纸伞来听雨轩。", "user"), "promises");
		assert.equal(inferHall("请不要叫我小明，要叫阿远。", "user"), "preferences");
		assert.equal(inferHall("原来青梧的真名是青梧。", "assistant"), "discoveries");
	});

	it("identity L0/L1 merges from preferences and wake includes L1", () => {
		appendDrawer(root, {
			wing: "idwing",
			hall: "preferences",
			text: "用户明确说讨厌别人提起旧城门的血色车票。",
		});
		appendDrawer(root, {
			wing: "idwing",
			hall: "promises",
			text: "青梧答应在听雨轩等阿远一整夜。",
		});
		const id = loadIdentity(root, "idwing");
		assert.ok(id.preferences.length >= 1);
		assert.ok(id.promises.length >= 1);
		const pack = buildWakePack(root, { wing: "idwing", query: "听雨轩", limit: 3 });
		assert.ok(pack.identity.includes("偏好") || pack.identity.includes("承诺"));
		assert.ok(pack.combined.includes("〔常驻·L0/L1〕"));
	});

	it("rebuildIdentity from drawers", () => {
		appendDrawer(root, {
			wing: "rebuild",
			hall: "facts",
			text: "阿远本名不详，只以旧城门的绰号行走。",
		});
		const id = rebuildIdentity(root, "rebuild");
		assert.ok(id.facts.length >= 1);
	});

	it("listRooms indexes hall counts", () => {
		appendDrawer(root, {
			wing: "rooms",
			room: "听雨轩",
			hall: "events",
			text: "听雨轩的廊灯在雨里忽明忽暗，有人落座。",
		});
		const rooms = listRooms(root, "rooms");
		assert.ok(rooms.some((r) => r.room === "听雨轩" && r.hall === "events"));
	});

	it("tunnels link shared tags across drawers", () => {
		appendDrawer(root, {
			wing: "w1",
			room: "a",
			hall: "events",
			text: "阿远把油纸伞靠在听雨轩柱边。",
			tags: ["油纸伞", "听雨轩"],
		});
		appendDrawer(root, {
			wing: "w2",
			room: "b",
			hall: "events",
			text: "青梧认出了那把油纸伞上的旧城纹样。",
			tags: ["油纸伞"],
		});
		const tuns = loadTunnels(root);
		assert.ok(tuns.some((t) => t.topic === "油纸伞" && t.drawerIds.length >= 2));
		const hits = searchDrawers(root, "油纸伞", { wing: "w1", followTunnels: true, limit: 5 });
		assert.ok(hits.some((h) => h.drawer.wing === "w2"));
		const st = searchTunnels(root, "油纸伞", 3);
		assert.ok(st.length >= 1);
	});
});
