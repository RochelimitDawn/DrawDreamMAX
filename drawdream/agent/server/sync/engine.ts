/**
 * 同步引擎（每用户单例）：上行本地变更 + 下行拉取应用 + presence。
 *
 * 生命周期由 UserHost 创建/销毁：
 * - start()：建 TiDBClient（若已启用），起 watcher + 上行聚合，起 poll 循环，发 presence 心跳。
 * - stop()：flush 待同步，停 watcher/poll，下线标记。
 *
 * 下行应用写回本地后，通过 events 回调通知宿主（rest-host）让前端感知数据变化
 * （宿主可选择推送 WS 帧或刷新会话列表）。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ConflictStore } from "./conflicts.ts";
import { SyncCursor } from "./cursor.ts";
import { fieldMerge } from "./merger.ts";
import { PendingQueue } from "./queue.ts";
import { checkSessionMerge } from "./session-merge.ts";
import { TiDBClient, classifyTidbError } from "./tidb.ts";
import type { ChangeBatch, EntityType, SessionEntryLine, SyncStatus } from "./types.ts";
import { SyncFileWatcher, defaultTargets } from "./watcher.ts";

export interface SyncEngineOptions {
	workspaceCwd: string;
	/** 会话 JSONL 所在目录（~/.drawdream/agent/sessions/--<encoded-cwd>--） */
	sessionDir: string;
	deviceId: string;
	deviceName: string;
	groupId: string;
	config: TiDBClient["config"];
	onApplied?: (batch: ChangeBatch) => void;
	onStatusChange?: (status: SyncStatus) => void;
}

const POLL_ACTIVE_MS = 800;
const POLL_IDLE_MS = 5000;
const FETCH_LIMIT = 200;

export class SyncEngine {
	private readonly opts: SyncEngineOptions;
	private client: TiDBClient;
	private readonly cursor: SyncCursor;
	private readonly queue: PendingQueue;
	private readonly conflicts: ConflictStore;
	private watcher: SyncFileWatcher | null = null;
	private pollTimer: ReturnType<typeof setTimeout> | null = null;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private running = false;
	private lastError?: string;
	private lastSyncedAt?: number;
	private lastRemoteMax = 0;

	constructor(opts: SyncEngineOptions) {
		this.opts = opts;
		this.client = new TiDBClient(opts.config, opts.groupId);
		this.cursor = new SyncCursor(opts.workspaceCwd);
		this.queue = new PendingQueue(opts.workspaceCwd);
		this.conflicts = new ConflictStore(opts.workspaceCwd);
	}

	get status(): SyncStatus {
		return {
			enabled: this.running,
			connecting: this.running && !this.client.connected,
			connected: this.running && this.client.connected,
			lastSeq: this.cursor.lastSeq,
			remoteMaxSeq: this.lastRemoteMax,
			pendingCount: this.queue.count,
			conflictCount: this.conflicts.count,
			lastError: this.lastError,
			lastSyncedAt: this.lastSyncedAt,
		};
	}

	/** 底层 TiDBClient（供账号/设备管理路由使用）。 */
	get tidb(): TiDBClient {
		return this.client;
	}

	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.lastError = undefined;
		try {
			await this.client.ping();
			await this.client.migrate();
		} catch (err) {
			this.lastError = classifyTidbError(err).message;
			this.running = false;
			throw err;
		}
		// 起 watcher 监听本地变更
		const targets = defaultTargets(this.opts.workspaceCwd, this.opts.sessionDir);
		this.watcher = new SyncFileWatcher(targets);
		this.watcher.watch((batch) => this.onLocalBatch(batch));
		// 立即同步一次（上行 outbox + 下行全量/增量）
		await this.syncNow();
		// poll 循环
		this.schedulePoll(true);
		// presence 心跳
		this.heartbeatTimer = setInterval(() => {
			void this.heartbeat();
		}, 30_000);
		void this.heartbeat();
	}

	async stop(): Promise<void> {
		if (!this.running) return;
		this.running = false;
		if (this.watcher) {
			this.watcher.stop();
			this.watcher = null;
		}
		if (this.pollTimer) clearTimeout(this.pollTimer);
		this.pollTimer = null;
		if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
		this.heartbeatTimer = null;
		try {
			await this.flushOutbox();
			// 下线标记
			await this.client.upsertDevice({
				deviceId: this.opts.deviceId,
				name: this.opts.deviceName,
				lastSeenAt: Date.now(),
				createdAt: Date.now(),
				active: false,
			});
		} catch {
			/* ignore */
		}
	}

	/** 手动立即同步（UI 触发）。 */
	async syncNow(): Promise<void> {
		if (!this.running) return;
		try {
			await this.flushOutbox();
			await this.poll();
		} catch (err) {
			this.lastError = classifyTidbError(err).message;
			this.notifyStatus();
		}
	}

	/**
	 * 全量拉取（新设备首次加入 / 用户手动触发）：拉取全部实体到本地。
	 * - 增量类：从 seq=1 拉取全部 append 行。
	 * - 版本类：以云端 entity_versions 最新版本覆盖本地。
	 */
	async fullPull(): Promise<number> {
		if (!this.running) return 0;
		// 版本类：整体覆盖
		const versions = await this.client.fetchEntityVersions();
		for (const v of versions) {
			await this.applyEntry(0, v.entityType, v.entityId, v.payload, v.updatedBy);
		}
		// 增量类：从 1 拉到远端 max，游标统一推进
		const remoteMax = await this.client.maxSeq();
		let after = 0;
		let applied = 0;
		for (;;) {
			const entries = await this.client.fetchEntries(after, FETCH_LIMIT);
			if (entries.length === 0) break;
			for (const e of entries) {
				await this.applyEntry(e.seq, e.entityType, e.entityId, e.payload, e.deviceId);
				after = e.seq;
				applied++;
			}
			if (entries.length < FETCH_LIMIT) break;
		}
		if (after > 0) this.cursor.advance(after);
		this.lastRemoteMax = remoteMax;
		this.lastSyncedAt = Date.now();
		this.notifyStatus();
		return applied;
	}

	private schedulePoll(active: boolean): void {
		if (!this.running) return;
		const delay = active ? POLL_ACTIVE_MS : POLL_IDLE_MS;
		this.pollTimer = setTimeout(() => {
			void (async () => {
				try {
					await this.poll();
					this.schedulePoll(true);
				} catch (err) {
					this.lastError = classifyTidbError(err).message;
					this.notifyStatus();
					// 出错后指数退避：先试 5s，失败递增
					this.schedulePoll(false);
				}
			})();
		}, delay);
	}

	/** 上行：本地 watcher 批次 → sync_entries（失败进 outbox）。 */
	private async onLocalBatch(batch: ChangeBatch): Promise<void> {
		if (!this.running) return;
		try {
			await this.client.insertEntries([
				{
					seq: 0,
					entityType: batch.entityType,
					entityId: batch.entityId,
					payload: batch.payload,
					deviceId: this.opts.deviceId,
					createdAt: Date.now(),
				},
			]);
			this.lastSyncedAt = Date.now();
			this.lastError = undefined;
			this.notifyStatus();
		} catch {
			// 网络失败：进 outbox，恢复后重放
			this.queue.enqueue(batch);
			this.notifyStatus();
		}
	}

	/** 重放 outbox 中所有待同步批次。 */
	private async flushOutbox(): Promise<void> {
		const pending = this.queue.peek();
		if (pending.length === 0) return;
		for (const batch of pending) {
			try {
				await this.client.insertEntries([
					{
						seq: 0,
						entityType: batch.entityType,
						entityId: batch.entityId,
						payload: batch.payload,
						deviceId: this.opts.deviceId,
						createdAt: Date.now(),
					},
				]);
				this.queue.ack(batch);
			} catch {
				break; // 恢复失败，保留剩余
			}
		}
		this.lastSyncedAt = Date.now();
		this.notifyStatus();
	}

	/** 下行：拉取 seq > cursor 的增量并应用写回本地。 */
	async poll(): Promise<void> {
		if (!this.running) return;
		const remoteMax = await this.client.maxSeq();
		this.lastRemoteMax = remoteMax;
		if (remoteMax <= this.cursor.lastSeq) {
			this.notifyStatus();
			return;
		}
		let after = this.cursor.lastSeq;
		let applied = 0;
		for (;;) {
			const entries = await this.client.fetchEntries(after, FETCH_LIMIT);
			if (entries.length === 0) break;
			for (const e of entries) {
				await this.applyEntry(e.seq, e.entityType, e.entityId, e.payload, e.deviceId);
				after = e.seq;
				applied++;
			}
			if (entries.length < FETCH_LIMIT) break;
		}
		if (applied > 0) {
			this.cursor.advance(after);
			this.lastSyncedAt = Date.now();
			this.lastError = undefined;
		}
		this.notifyStatus();
	}

	/** 应用单条云端 entry 到本地。 */
	private async applyEntry(seq: number, entityType: EntityType, entityId: string, payload: unknown, fromDeviceId: string): Promise<void> {
		// 忽略自己设备的回显（已在本地，避免重复）
		if (fromDeviceId === this.opts.deviceId) return;
		const rel = entityId.startsWith(`${entityType}:`) ? entityId.slice(entityType.length + 1) : entityId;
		let targetPath: string;
		if (entityType === "session") {
			targetPath = join(this.opts.sessionDir, rel);
		} else {
			targetPath = join(this.opts.workspaceCwd, rel);
		}
		if (Array.isArray(payload)) {
			// append 类型：追加行
			mkdirSync(targetPath.replace(/\/[^/]+$/, ""), { recursive: true });
			const lines = (payload as string[]).filter((l) => l && l.trim()).map((l) => l.trim());
			if (entityType === "session") {
				// 会话合并：兄弟分支语义校验（追加行全部保留，不丢数据）
				this.validateSessionAppend(targetPath, lines);
			}
			appendFileSync(targetPath, lines.join("\n") + "\n");
		} else if (typeof payload === "string" && isJsonlLike(payload)) {
			mkdirSync(targetPath.replace(/\/[^/]+$/, ""), { recursive: true });
			appendFileSync(targetPath, payload.trim() + "\n");
		} else {
			// replace 类型：字段级合并（仅对 JSON 对象生效；非对象直接覆盖）
			this.applyVersioned(entityType, entityId, rel, targetPath, payload);
		}
		// 通知宿主（前端刷新）
		this.opts.onApplied?.({
			entityType,
			entityId,
			kind: Array.isArray(payload) ? "append" : "replace",
			payload,
			ts: Date.now(),
		});
	}

	/**
	 * 版本类实体应用：读取本地现有内容作为 local，云端 payload 作为 remote，
	 * 云端旧版本作为 base，执行字段级合并；合并冲突登记到 ConflictStore。
	 */
	private applyVersioned(
		entityType: EntityType,
		entityId: string,
		rel: string,
		targetPath: string,
		remotePayload: unknown,
	): void {
		mkdirSync(targetPath.replace(/\/[^/]+$/, ""), { recursive: true });
		if (!isPlainObjectLike(remotePayload)) {
			// 非对象（如媒体二进制占位）：直接覆盖
			const content = typeof remotePayload === "string" ? remotePayload : JSON.stringify(remotePayload, null, 2);
			writeFileSync(targetPath, content);
			return;
		}
		const remoteObj = remotePayload;
		let localObj: Record<string, unknown> | null = null;
		let localTs = 0;
		if (existsSync(targetPath)) {
			try {
				const parsed = JSON.parse(readFileSync(targetPath, "utf8")) as unknown;
				if (isPlainObjectLike(parsed)) {
					localObj = parsed;
					localTs = statSyncMtimeMs(targetPath);
				}
			} catch {
				/* ignore */
			}
		}
		if (!localObj) {
			// 本地无该文件：直接写入远端内容
			writeFileSync(targetPath, JSON.stringify(remoteObj, null, 2));
			return;
		}
		// 字段级合并：云端无 base 历史时，以 remote 为 base（远端视为权威初值）
		const remoteTs = Date.now();
		const result = fieldMerge({
			entityType,
			entityId,
			local: localObj,
			remote: remoteObj,
			base: null,
			localTs,
			remoteTs,
		});
		writeFileSync(targetPath, JSON.stringify(result.merged, null, 2));
		for (const c of result.conflicts) {
			this.conflicts.upsert(c);
		}
	}

	/** 会话追加前做兄弟分支语义校验（仅记录，不阻塞追加）。 */
	private validateSessionAppend(targetPath: string, lines: string[]): void {
		try {
			if (!existsSync(targetPath)) return;
			const existing = readFileSync(targetPath, "utf8")
				.split("\n")
				.filter((l) => l.trim())
				.map((l) => {
					try {
						return JSON.parse(l) as SessionEntryLine;
					} catch {
						return null;
					}
				})
				.filter((l): l is SessionEntryLine => l !== null);
			const newEntries = lines
				.map((l) => {
					try {
						return JSON.parse(l) as SessionEntryLine;
					} catch {
						return null;
					}
				})
				.filter((l): l is SessionEntryLine => l !== null);
			const result = checkSessionMerge(existing, newEntries);
			// 孤儿行不丢弃（兄弟分支仍追加），仅在状态上标记
			if (result.orphanIds.length > 0) {
				this.lastError = `session merge: ${result.orphanIds.length} orphan branch(es) preserved`;
			}
		} catch {
			/* ignore */
		}
	}

	private async heartbeat(): Promise<void> {
		if (!this.running) return;
		try {
			await this.client.upsertDevice({
				deviceId: this.opts.deviceId,
				name: this.opts.deviceName,
				lastSeenAt: Date.now(),
				createdAt: Date.now(),
				active: true,
			});
		} catch {
			/* ignore */
		}
	}

	private notifyStatus(): void {
		this.opts.onStatusChange?.(this.status);
	}
}

function isJsonlLike(s: string): boolean {
	return s.includes("\n") && s.trimStart().startsWith("{");
}

function isPlainObjectLike(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function statSyncMtimeMs(p: string): number {
	try {
		return statSync(p).mtimeMs;
	} catch {
		return 0;
	}
}
