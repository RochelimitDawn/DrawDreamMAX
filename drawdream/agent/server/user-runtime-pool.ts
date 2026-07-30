/**
 * 按 userId 管理 UserRuntime 生命周期：懒创建、连接计数、空闲回收、上限。
 * 与具体 Agent 实现解耦，create 由宿主注入。
 */

export class RuntimePoolFullError extends Error {
	readonly code = "RUNTIME_POOL_FULL" as const;
	constructor(max: number) {
		super(`UserRuntime 池已满（上限 ${max}）`);
		this.name = "RuntimePoolFullError";
	}
}

export class RuntimeCreateError extends Error {
	readonly code = "RUNTIME_CREATE_FAILED" as const;
	constructor(cause: unknown) {
		super(cause instanceof Error ? cause.message : String(cause));
		this.name = "RuntimeCreateError";
	}
}

export type PooledRuntime = {
	userId: string;
	workspaceCwd: string;
	/** 当前挂在该 runtime 上的 WS 数（可为 getter） */
	readonly connectionCount: number;
	isStreaming: () => boolean;
	lastActiveAt: number;
	dispose: () => Promise<void>;
};

export type UserRuntimePoolOptions<T extends PooledRuntime> = {
	maxRuntimes: number;
	idleTtlMs: number;
	evictIntervalMs: number;
	create: (userId: string, workspaceCwd: string) => Promise<T>;
	/** 可选日志 */
	log?: (msg: string) => void;
};

export type PoolStats = {
	runtimes: number;
	maxRuntimes: number;
	connections: number;
	users: Array<{
		userId: string;
		connections: number;
		streaming: boolean;
		lastActiveAt: number;
		idleMs: number;
	}>;
};

export class UserRuntimePool<T extends PooledRuntime> {
	private readonly map = new Map<string, T>();
	private readonly inflight = new Map<string, Promise<T>>();
	private readonly opts: UserRuntimePoolOptions<T>;
	private timer: ReturnType<typeof setInterval> | undefined;

	constructor(opts: UserRuntimePoolOptions<T>) {
		this.opts = opts;
		if (opts.evictIntervalMs > 0) {
			this.timer = setInterval(() => {
				void this.evictIdle();
			}, opts.evictIntervalMs);
			this.timer.unref?.();
		}
	}

	get size(): number {
		return this.map.size;
	}

	get(userId: string): T | undefined {
		return this.map.get(userId);
	}

	stats(): PoolStats {
		const now = Date.now();
		let connections = 0;
		const users: PoolStats["users"] = [];
		for (const r of this.map.values()) {
			connections += r.connectionCount;
			users.push({
				userId: r.userId,
				connections: r.connectionCount,
				streaming: r.isStreaming(),
				lastActiveAt: r.lastActiveAt,
				idleMs: Math.max(0, now - r.lastActiveAt),
			});
		}
		return {
			runtimes: this.map.size,
			maxRuntimes: this.opts.maxRuntimes,
			connections,
			users,
		};
	}

	touch(userId: string): void {
		const r = this.map.get(userId);
		if (r) r.lastActiveAt = Date.now();
	}

	async acquire(userId: string, workspaceCwd: string): Promise<T> {
		const existing = this.map.get(userId);
		if (existing) {
			existing.lastActiveAt = Date.now();
			return existing;
		}
		const pending = this.inflight.get(userId);
		if (pending) return pending;

		if (this.map.size >= this.opts.maxRuntimes) {
			// 先尝试回收空闲再判断
			await this.evictIdle();
			if (this.map.size >= this.opts.maxRuntimes) {
				throw new RuntimePoolFullError(this.opts.maxRuntimes);
			}
		}

		const job = (async () => {
			try {
				const created = await this.opts.create(userId, workspaceCwd);
				created.lastActiveAt = Date.now();
				this.map.set(userId, created);
				this.opts.log?.(`[pool] acquire user=${userId.slice(0, 8)}… runtimes=${this.map.size}`);
				return created;
			} catch (e) {
				throw e instanceof RuntimePoolFullError || e instanceof RuntimeCreateError
					? e
					: new RuntimeCreateError(e);
			} finally {
				this.inflight.delete(userId);
			}
		})();
		this.inflight.set(userId, job);
		return job;
	}

	/** 强制释放指定用户 runtime（踢下线 / 删用户） */
	async release(userId: string): Promise<boolean> {
		const r = this.map.get(userId);
		if (!r) return false;
		this.map.delete(userId);
		this.inflight.delete(userId);
		try {
			await r.dispose();
			this.opts.log?.(`[pool] release user=${userId.slice(0, 8)}…`);
		} catch (e) {
			this.opts.log?.(
				`[pool] release dispose failed user=${userId.slice(0, 8)}…: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
		return true;
	}

	async evictIdle(): Promise<number> {
		const now = Date.now();
		const ttl = this.opts.idleTtlMs;
		const victims: T[] = [];
		for (const r of this.map.values()) {
			if (r.connectionCount > 0) continue;
			if (r.isStreaming()) continue;
			if (now - r.lastActiveAt < ttl) continue;
			victims.push(r);
		}
		for (const r of victims) {
			this.map.delete(r.userId);
			try {
				await r.dispose();
				this.opts.log?.(`[pool] evict idle user=${r.userId.slice(0, 8)}…`);
			} catch (e) {
				this.opts.log?.(
					`[pool] dispose failed user=${r.userId.slice(0, 8)}…: ${e instanceof Error ? e.message : String(e)}`,
				);
			}
		}
		return victims.length;
	}

	async disposeAll(): Promise<void> {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		const all = [...this.map.values()];
		this.map.clear();
		this.inflight.clear();
		for (const r of all) {
			try {
				await r.dispose();
			} catch {
				/* best-effort */
			}
		}
	}
}

export function readPoolEnv(): {
	maxRuntimes: number;
	idleTtlMs: number;
	evictIntervalMs: number;
} {
	const max = Number(process.env.DD_MAX_USER_RUNTIMES ?? 20);
	const idle = Number(process.env.DD_RUNTIME_IDLE_TTL_MS ?? 20 * 60 * 1000);
	const interval = Number(process.env.DD_RUNTIME_EVICT_INTERVAL_MS ?? 60 * 1000);
	return {
		maxRuntimes: Number.isFinite(max) && max > 0 ? Math.floor(max) : 20,
		idleTtlMs: Number.isFinite(idle) && idle > 0 ? Math.floor(idle) : 20 * 60 * 1000,
		evictIntervalMs: Number.isFinite(interval) && interval >= 0 ? Math.floor(interval) : 60 * 1000,
	};
}
