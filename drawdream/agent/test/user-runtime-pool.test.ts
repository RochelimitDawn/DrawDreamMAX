import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	RuntimePoolFullError,
	UserRuntimePool,
	type PooledRuntime,
} from "../server/user-runtime-pool.ts";

function mockRuntime(userId: string, workspaceCwd: string): PooledRuntime & { disposed: boolean } {
	const r = {
		userId,
		workspaceCwd,
		connectionCount: 0,
		lastActiveAt: Date.now(),
		disposed: false,
		streaming: false,
		isStreaming: () => r.streaming,
		dispose: async () => {
			r.disposed = true;
		},
	};
	return r;
}

describe("UserRuntimePool", () => {
	it("acquire is idempotent per userId", async () => {
		let creates = 0;
		const pool = new UserRuntimePool({
			maxRuntimes: 5,
			idleTtlMs: 60_000,
			evictIntervalMs: 0,
			create: async (id, cwd) => {
				creates++;
				return mockRuntime(id, cwd);
			},
		});
		const a1 = await pool.acquire("u1", "/w1");
		const a2 = await pool.acquire("u1", "/w1");
		assert.equal(a1, a2);
		assert.equal(creates, 1);
		assert.equal(pool.size, 1);
		await pool.disposeAll();
	});

	it("allows concurrent users up to max", async () => {
		const pool = new UserRuntimePool({
			maxRuntimes: 2,
			idleTtlMs: 60_000,
			evictIntervalMs: 0,
			create: async (id, cwd) => mockRuntime(id, cwd),
		});
		await pool.acquire("a", "/a");
		await pool.acquire("b", "/b");
		await assert.rejects(() => pool.acquire("c", "/c"), (e: unknown) => e instanceof RuntimePoolFullError);
		await pool.disposeAll();
	});

	it("evicts idle runtimes without connections", async () => {
		const pool = new UserRuntimePool({
			maxRuntimes: 2,
			idleTtlMs: 10,
			evictIntervalMs: 0,
			create: async (id, cwd) => mockRuntime(id, cwd),
		});
		const r = await pool.acquire("a", "/a");
		r.lastActiveAt = Date.now() - 1000;
		r.connectionCount = 0;
		const n = await pool.evictIdle();
		assert.equal(n, 1);
		assert.equal(pool.size, 0);
		assert.equal((r as { disposed: boolean }).disposed, true);
		// 腾出槽位后可再 acquire
		await pool.acquire("c", "/c");
		assert.equal(pool.size, 1);
		await pool.disposeAll();
	});

	it("does not evict streaming or connected runtimes", async () => {
		const pool = new UserRuntimePool({
			maxRuntimes: 5,
			idleTtlMs: 1,
			evictIntervalMs: 0,
			create: async (id, cwd) => mockRuntime(id, cwd),
		});
		const s = await pool.acquire("s", "/s");
		s.lastActiveAt = 0;
		(s as { streaming: boolean }).streaming = true;
		const c = await pool.acquire("c", "/c");
		c.lastActiveAt = 0;
		c.connectionCount = 1;
		assert.equal(await pool.evictIdle(), 0);
		assert.equal(pool.size, 2);
		await pool.disposeAll();
	});

	it("coalesces parallel acquire for same user", async () => {
		let creates = 0;
		const pool = new UserRuntimePool({
			maxRuntimes: 5,
			idleTtlMs: 60_000,
			evictIntervalMs: 0,
			create: async (id, cwd) => {
				creates++;
				await new Promise((r) => setTimeout(r, 30));
				return mockRuntime(id, cwd);
			},
		});
		const [x, y] = await Promise.all([pool.acquire("u", "/w"), pool.acquire("u", "/w")]);
		assert.equal(x, y);
		assert.equal(creates, 1);
		await pool.disposeAll();
	});
});
