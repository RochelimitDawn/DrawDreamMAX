/**
 * 多用户 SQLite（node:sqlite DatabaseSync）。
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type UserRole = "user" | "admin";

export type DbUser = {
	id: string;
	username: string;
	password_salt: string;
	password_hash: string;
	role: UserRole;
	disabled: number;
	created_at: number;
	updated_at: number;
};

export type DbToken = {
	token_hash: string;
	user_id: string;
	created_at: number;
	expires_at: number | null;
	user_agent: string | null;
	/** 稳定会话 id（展示/吊销用，非 cookie 明文） */
	session_id?: string | null;
	ip?: string | null;
	location?: string | null;
	device_name?: string | null;
	browser?: string | null;
	os?: string | null;
	last_seen_at?: number | null;
};

let db: DatabaseSync | null = null;
let dbPath = "";

export function getDbPath(): string {
	return dbPath;
}

export function openAuthDb(dataRoot: string): DatabaseSync {
	const path = join(dataRoot, "drawdream.sqlite");
	mkdirSync(dirname(path), { recursive: true });
	if (db && dbPath === path) return db;
	if (db) {
		try {
			db.close();
		} catch {
			/* ignore */
		}
	}
	db = new DatabaseSync(path);
	dbPath = path;
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA foreign_keys = ON;");
	migrate(db);
	return db;
}

export function getAuthDb(): DatabaseSync {
	if (!db) throw new Error("auth db not opened");
	return db;
}

function migrate(database: DatabaseSync): void {
	database.exec(`
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL UNIQUE COLLATE NOCASE,
			password_salt TEXT NOT NULL,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL CHECK(role IN ('user','admin')),
			disabled INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS sessions_token (
			token_hash TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			created_at INTEGER NOT NULL,
			expires_at INTEGER,
			user_agent TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_token_user ON sessions_token(user_id);
		CREATE TABLE IF NOT EXISTS user_settings (
			user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			payload_json TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS instance_meta (
			key TEXT PRIMARY KEY,
			value_json TEXT NOT NULL
		);
	`);
}

export function getMeta(key: string): unknown | null {
	const row = getAuthDb()
		.prepare("SELECT value_json FROM instance_meta WHERE key = ?")
		.get(key) as { value_json: string } | undefined;
	if (!row) return null;
	try {
		return JSON.parse(row.value_json) as unknown;
	} catch {
		return null;
	}
}

export function setMeta(key: string, value: unknown): void {
	getAuthDb()
		.prepare(
			`INSERT INTO instance_meta(key, value_json) VALUES(?, ?)
			 ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`,
		)
		.run(key, JSON.stringify(value));
}
