import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { openAuthDb } from "../src/auth/db.ts";
import { bootstrapAuth } from "../src/auth/bootstrap.ts";
import { createUser, verifyUserLogin, setUserDisabled, deleteUser, findUserById } from "../src/auth/users.ts";
import { issueSessionToken, resolveSessionToken, revokeSessionToken } from "../src/auth/tokens.ts";
import { sessionWing, appendDrawer, searchDrawers } from "../src/palace.ts";
import {
	userWorkspacePath,
	ensureUserWorkspace,
	assertInsideWorkspace,
	purgeUserHome,
} from "../src/auth/workspace.ts";
import { existsSync } from "node:fs";

const root = mkdtempSync(join(tmpdir(), "dd-auth-test-"));
after(() => {
	try {
		rmSync(root, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});

describe("multi-user auth", () => {
	it("bootstraps admin and issues tokens", () => {
		openAuthDb(root);
		const b = bootstrapAuth(root);
		assert.ok(b.adminId);
		const issued = issueSessionToken(b.adminId!);
		const u = resolveSessionToken(issued.token);
		assert.equal(u?.username, "admin");
		assert.equal(u?.role, "admin");
		assert.ok(issued.sessionId);
		revokeSessionToken(issued.token);
		assert.equal(resolveSessionToken(issued.token), null);
	});

	it("registers and isolates workspaces", () => {
		openAuthDb(root);
		const a = createUser({ username: "u_a", password: "pass1234" });
		const b = createUser({ username: "u_b", password: "pass1234" });
		assert.ok(a.ok && b.ok);
		const wa = userWorkspacePath(root, a.user.id);
		const wb = userWorkspacePath(root, b.user.id);
		ensureUserWorkspace(wa);
		ensureUserWorkspace(wb);
		assert.notEqual(wa, wb);
		assert.ok(assertInsideWorkspace(wa, join(wa, ".drawdream-palace")).startsWith(wa));
		assert.throws(() => assertInsideWorkspace(wa, join(wb, "x")));
	});

	it("disables user login", () => {
		openAuthDb(root);
		const r = createUser({ username: "disabled_me", password: "pass1234" });
		assert.ok(r.ok);
		setUserDisabled(r.user.id, true);
		const login = verifyUserLogin("disabled_me", "pass1234");
		assert.equal(login.ok, false);
		if (!login.ok) assert.equal(login.code, "USER_DISABLED");
	});

	it("deletes user and purges workspace", () => {
		openAuthDb(root);
		const actor = createUser({ username: "admin_del", password: "pass1234", role: "admin" });
		const target = createUser({ username: "to_purge", password: "pass1234" });
		assert.ok(actor.ok && target.ok);
		const ws = userWorkspacePath(root, target.user.id);
		ensureUserWorkspace(ws);
		assert.ok(existsSync(ws));
		const bad = deleteUser(target.user.id, { actorId: actor.user.id, confirmUsername: "wrong" });
		assert.equal(bad.ok, false);
		const ok = deleteUser(target.user.id, { actorId: actor.user.id, confirmUsername: "to_purge" });
		assert.equal(ok.ok, true);
		assert.equal(findUserById(target.user.id), null);
		assert.ok(purgeUserHome(root, target.user.id));
		assert.equal(existsSync(ws), false);
	});

	it("session memory isolation still holds", () => {
		const w1 = sessionWing("chat-1");
		const w2 = sessionWing("chat-2");
		appendDrawer(root, { wing: w1, text: "仅会话一记住了血色车票约定。", hall: "promises" });
		const hits = searchDrawers(root, "血色车票", { wing: w2, limit: 5 });
		assert.equal(hits.length, 0);
	});
});
