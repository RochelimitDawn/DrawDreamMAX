/**
 * 跨端云同步核心类型定义。
 */

export type EntityType =
	| "session" // 会话 JSONL（增量类，按行追加）
	| "palace" // 记忆 palace JSONL（增量类）
	| "summary" // 叙事摘要 JSONL（增量类）
	| "state" // 世界状态 JSON（版本类）
	| "artifacts" // 右栏面板 JSON（版本类）
	| "config" // drawdream.config.json 等配置（版本类）
	| "card" // 角色卡（版本类）
	| "preset" // 预设（版本类）
	| "persona" // 人设（版本类）
	| "lorebook" // 世界书（版本类）
	| "worldline" // 世界线 meta（版本类）
	| "media"; // 媒体/上传（版本类，元数据 + 按需下载）

/** TiDB Serverless 连接配置（V1：TLS 直连，无 E2EE） */
export interface TidbConfig {
	host: string;
	port: number;
	user: string;
	password: string;
	database: string;
}

/** sync_entries 表行：统一增量变更日志 */
export interface SyncEntryRow {
	seq: number;
	entityType: EntityType;
	entityId: string;
	payload: unknown;
	deviceId: string;
	createdAt: number;
}

/** entity_versions 表行：版本类实体最新版本 */
export interface EntityVersionRow {
	entityType: EntityType;
	entityId: string;
	version: number;
	contentHash: string;
	payload: unknown;
	updatedBy: string;
	updatedAt: number;
}

/** devices 表行 */
export interface DeviceRow {
	deviceId: string;
	name: string;
	lastSeenAt: number;
	createdAt: number;
	active: boolean;
}

/** accounts 表行 */
export interface AccountRow {
	id: string;
	username: string;
	passwordSalt: string;
	passwordHash: string;
	kdf: string;
	ownerDeviceId: string;
	createdAt: number;
	updatedAt: number;
}

/** 变更类型：追加行（增量类）或整体替换（版本类） */
export type ChangeKind = "append" | "replace";

/** 文件监听上报的变更批次 */
export interface ChangeBatch {
	entityType: EntityType;
	entityId: string;
	kind: ChangeKind;
	/** append：追加的行；replace：新的完整内容 */
	payload: unknown;
	/** 追加时从文件哪一行开始（1-based），用于幂等 */
	fromSeq?: number;
	ts: number;
}

/** 同步状态（供前端 /api/sync/status） */
export interface SyncStatus {
	enabled: boolean;
	connecting: boolean;
	connected: boolean;
	lastSeq: number;
	remoteMaxSeq: number;
	pendingCount: number;
	conflictCount: number;
	lastError?: string;
	lastSyncedAt?: number;
}

/** 字段级合并冲突记录 */
export interface MergeConflict {
	entityType: EntityType;
	entityId: string;
	fieldPath: string;
	localValue: unknown;
	remoteValue: unknown;
	localTs: number;
	remoteTs: number;
	resolved: boolean;
	resolvedValue?: unknown;
}

/** 字段级合并输入/结果 */
export interface MergeInput {
	entityType: EntityType;
	entityId: string;
	local: Record<string, unknown>;
	remote: Record<string, unknown>;
	base: Record<string, unknown> | null;
	localTs: number;
	remoteTs: number;
}

export interface MergeResult {
	merged: Record<string, unknown>;
	conflicts: MergeConflict[];
}

/** 会话 JSONL 单行 entry 的字段子集（追加行识别所需） */
export interface SessionEntryLine {
	type: string;
	id: string;
	parentId?: string | null;
	timestamp?: string;
	[key: string]: unknown;
}
