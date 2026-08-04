/**
 * DrawDream 数据路径（无历史兼容层）。
 * Agent 内核（@drawdream/agent-runtime）configDir 默认 `.drawdream`。
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** 项目配置主文件 */
export const CONFIG_FILE = "drawdream.config.json";

/** 预设默认文件名 */
export const PRESET_FILE = "drawdream-preset.json";

/** 数据目录（相对项目根） */
export const DIRS = {
	state: ".drawdream-state",
	artifacts: ".drawdream-artifacts",
	/** 右栏「助手」的独立会话树（绝不进剧情会话列表/世界线） */
	assistant: ".drawdream-assistant",
	cache: ".drawdream-cache",
	codex: ".drawdream-codex",
	lore: ".drawdream-lore",
	media: ".drawdream-media",
	audio: ".drawdream-audio",
	skills: ".drawdream-skills",
	uploads: ".drawdream-uploads",
	worldline: ".drawdream-worldline",
	/** 记忆：原文抽屉（verbatim drawers，按翼/厅索引） */
	palace: ".drawdream-palace",
	/** 叙事流水线：跨轮故事进度摘要（Turn Summary Store） */
	summaries: ".drawdream-summaries",
} as const;

export const PERSONAS_FILE = ".drawdream-personas.json";

export function dir(cwd: string, key: keyof typeof DIRS): string {
	return join(cwd, DIRS[key]);
}

/** 消息/API 里存的相对路径前缀（uploads） */
export const UPLOAD_PREFIX = `${DIRS.uploads}/`;
export const MEDIA_PREFIX = `${DIRS.media}/`;

/** 归一数据路径（当前仅透传；保留 API 供调用方使用） */
export function normalizeDataPath(p: string): string {
	return p;
}

/**
 * 启动时确保数据目录存在（不再做历史布局迁移）。
 */
export function migrateLegacyLayout(cwd: string): string[] {
	const log: string[] = [];
	for (const key of Object.keys(DIRS) as (keyof typeof DIRS)[]) {
		const d = join(cwd, DIRS[key]);
		if (!existsSync(d)) {
			try {
				mkdirSync(d, { recursive: true });
			} catch {
				/* ignore */
			}
		}
	}
	const cfgDir = join(cwd, ".drawdream");
	if (!existsSync(cfgDir)) {
		try {
			mkdirSync(cfgDir, { recursive: true });
		} catch {
			/* ignore */
		}
	}
	return log;
}

export function resolveConfigPath(cwd: string): string {
	return join(cwd, CONFIG_FILE);
}

export function resolvePresetPath(cwd: string, configured?: string): string {
	if (configured) {
		const p =
			configured.startsWith(".") || configured.includes("/") || configured.includes("\\")
				? join(cwd, configured)
				: join(cwd, configured);
		return p;
	}
	return join(cwd, PRESET_FILE);
}

/**
 * 将用户级 agent 目录指到 ~/.drawdream/agent。
 * 须在 createAgentSession / getAgentDir 之前调用。
 */
export function preferDrawdreamAgentHome(): string {
	const target = join(homedir(), ".drawdream", "agent");
	const existing = process.env.DRAWDREAM_CODING_AGENT_DIR?.trim();
	if (!existing) {
		process.env.DRAWDREAM_CODING_AGENT_DIR = target;
	}
	// 与 pi 内核 ENV 对齐（APP_NAME=drawdream → DRAWDREAM_CODING_AGENT_DIR）
	const resolved = process.env.DRAWDREAM_CODING_AGENT_DIR || target;
	try {
		mkdirSync(resolved, { recursive: true });
	} catch {
		/* ignore */
	}
	return resolved;
}

/** 最近一次 merge 说明（兼容旧调用；恒为空） */
export function takeAgentMergeLog(): string[] {
	return [];
}
