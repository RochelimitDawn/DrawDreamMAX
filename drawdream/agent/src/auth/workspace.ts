/**
 * 每用户工作区路径与骨架目录。
 */

import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { DIRS } from "../paths.ts";

export function dataRootFromEnv(cwd: string): string {
	const env = process.env.DD_DATA_ROOT?.trim();
	if (env) return resolve(env);
	return join(cwd, "data");
}

function safeUserSegment(userId: string): string {
	return userId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "unknown";
}

/** 用户数据根目录 data/users/<id>/（含 workspace） */
export function userHomePath(dataRoot: string, userId: string): string {
	return join(dataRoot, "users", safeUserSegment(userId));
}

export function userWorkspacePath(dataRoot: string, userId: string): string {
	return join(userHomePath(dataRoot, userId), "workspace");
}

/** 删除用户目录（默认随删用户一并 purge） */
export function purgeUserHome(dataRoot: string, userId: string): boolean {
	const root = resolve(dataRoot);
	const usersRoot = resolve(join(root, "users"));
	const home = resolve(userHomePath(dataRoot, userId));
	if (home === usersRoot || home === root) return false;
	if (!(home === usersRoot || home.startsWith(usersRoot + "/") || home.startsWith(usersRoot + "\\"))) {
		return false;
	}
	if (!existsSync(home)) return true;
	rmSync(home, { recursive: true, force: true });
	return true;
}

/** 确保路径落在用户 workspace 内（防穿越） */
export function assertInsideWorkspace(workspaceCwd: string, targetPath: string): string {
	const root = resolve(workspaceCwd);
	const abs = resolve(targetPath);
	if (abs === root || abs.startsWith(root + "/") || abs.startsWith(root + "\\")) return abs;
	throw new Error("path_outside_workspace");
}

/** 产品自带角色卡目录（安装树 process.cwd()/assets/cards） */
function productCardsDir(): string {
	return join(process.cwd(), "assets", "cards");
}

/**
 * 把安装包内示例卡拷进用户 workspace（仅补缺、不覆盖）。
 * 返回拷贝进库的相对路径列表（assets/cards/...）。
 */
/** 非 ASCII 文件名在部分 Android/WebView 链路更易出问题：种子卡落盘用 ASCII 名 */
function asciiSafeCardFileName(name: string): string {
	const extM = name.match(/(\.(?:png|json))$/i);
	const ext = extM ? extM[1].toLowerCase() : ".png";
	const stem = name.slice(0, name.length - ext.length);
	const ascii = stem
		.normalize("NFKD")
		.replace(/[^\x20-\x7E]/g, "")
		.replace(/[\\/:*?"<>|]+/g, "-")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	return `${ascii || "sample-card"}${ext}`;
}

export function seedProductCardsIntoWorkspace(workspaceCwd: string): string[] {
	const destDir = join(workspaceCwd, "assets", "cards");
	mkdirSync(destDir, { recursive: true });
	const srcDir = productCardsDir();
	if (!existsSync(srcDir)) return [];
	const seeded: string[] = [];
	for (const name of readdirSync(srcDir)) {
		if (!/\.(png|json)$/i.test(name)) continue;
		const from = join(srcDir, name);
		const safe = asciiSafeCardFileName(name);
		const to = join(destDir, safe);
		try {
			if (!statSync(from).isFile()) continue;
			if (!existsSync(to)) {
				copyFileSync(from, to);
				seeded.push(`assets/cards/${basename(safe)}`);
			}
		} catch {
			/* 单文件失败不挡骨架 */
		}
	}
	return seeded;
}

/** 用户卡库内第一张可用卡（按文件名） */
export function firstLibraryCardPath(workspaceCwd: string): string {
	const dir = join(workspaceCwd, "assets", "cards");
	if (!existsSync(dir)) return "";
	try {
		const names = readdirSync(dir)
			.filter((n) => /\.(png|json)$/i.test(n))
			.sort((a, b) => a.localeCompare(b, "zh"));
		return names[0] ? `assets/cards/${names[0]}` : "";
	} catch {
		return "";
	}
}

export function ensureUserWorkspace(workspaceCwd: string): void {
	mkdirSync(workspaceCwd, { recursive: true });
	for (const key of Object.keys(DIRS) as (keyof typeof DIRS)[]) {
		mkdirSync(join(workspaceCwd, DIRS[key]), { recursive: true });
	}
	mkdirSync(join(workspaceCwd, "assets", "cards"), { recursive: true });
	mkdirSync(join(workspaceCwd, "assets", "presets"), { recursive: true });
	mkdirSync(join(workspaceCwd, "assets", "lore"), { recursive: true });
	mkdirSync(join(workspaceCwd, "assets", "lorebooks"), { recursive: true });
	// 将产品自带默认书（RP Tok UI 说明书）补到用户工作区
	const productLoreDir = join(process.cwd(), "assets", "lorebooks");
	if (existsSync(productLoreDir)) {
		for (const name of readdirSync(productLoreDir)) {
			if (!name.endsWith(".json")) continue;
			const from = join(productLoreDir, name);
			const to = join(workspaceCwd, "assets", "lorebooks", name);
			try {
				if (!existsSync(to) && statSync(from).isFile()) {
					copyFileSync(from, to);
				}
			} catch {
				/* skip */
			}
		}
	}
	// 新用户 / 空库：拷贝产品示例卡，避免「卡库空白 → 对话空态请选卡面」
	seedProductCardsIntoWorkspace(workspaceCwd);
	const cfg = join(workspaceCwd, "drawdream.config.json");
	const fallbackCard = firstLibraryCardPath(workspaceCwd);
	if (!existsSync(cfg)) {
		writeFileSync(
			cfg,
			JSON.stringify(
				{
					card: fallbackCard,
					userName: "用户",
					language: "zh",
					backendControl: false,
					pipeline: { mode: "merged", maxSummaries: 40 },
				},
				null,
				"\t",
			),
			"utf8",
		);
		return;
	}
	if (!fallbackCard) return;
	// 已有配置但 card 为空/指向不存在文件 → 自动落第一张库内卡
	try {
		const raw = JSON.parse(readFileSync(cfg, "utf8")) as Record<string, unknown>;
		const cur = typeof raw.card === "string" ? raw.card.trim() : "";
		const abs = cur ? (cur.startsWith("/") ? cur : join(workspaceCwd, cur)) : "";
		if (!cur || !existsSync(abs)) {
			raw.card = fallbackCard;
			writeFileSync(cfg, `${JSON.stringify(raw, null, "\t")}\n`, "utf8");
		}
	} catch {
		/* 坏配置留给后续 loadConfig 处理 */
	}
}

/**
 * 将进程 cwd 下旧的单机数据迁入 bootstrap admin workspace（仅一次）。
 * 检测：存在 .drawdream-palace 或 .drawdream sessions 痕迹且 data 下尚无 migrated 标记。
 */
export function maybeMigrateLegacyIntoAdmin(
	processCwd: string,
	dataRoot: string,
	adminUserId: string,
	alreadyMigrated: boolean,
): string[] {
	const log: string[] = [];
	if (alreadyMigrated) return log;
	const markers = [".drawdream-palace", ".drawdream-state", ".drawdream", "assets"];
	const hasLegacy = markers.some((m) => existsSync(join(processCwd, m)));
	if (!hasLegacy) return log;

	const dest = userWorkspacePath(dataRoot, adminUserId);
	ensureUserWorkspace(dest);

	const moveNames = [
		".drawdream-palace",
		".drawdream-state",
		".drawdream-artifacts",
		".drawdream-assistant",
		".drawdream-cache",
		".drawdream-codex",
		".drawdream-lore",
		".drawdream-media",
		".drawdream-audio",
		".drawdream-skills",
		".drawdream-uploads",
		".drawdream-worldline",
		".drawdream-summaries",
		".drawdream-personas.json",
		".drawdream",
		"assets",
		"drawdream.config.json",
		"drawdream-preset.json",
		"drawdream.agent.json",
	];

	for (const name of moveNames) {
		const from = join(processCwd, name);
		const to = join(dest, name);
		if (!existsSync(from)) continue;
		if (existsSync(to)) {
			log.push(`保留 ${name}（目标已存在）`);
			continue;
		}
		try {
			renameSync(from, to);
			log.push(`${name} → users/${adminUserId}/workspace/`);
		} catch (e) {
			log.push(`迁移失败 ${name}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	// sessions 可能在 .drawdream/agent/sessions
	try {
		const entries = readdirSync(processCwd);
		for (const e of entries) {
			if (!e.startsWith(".") && e !== "data" && e !== "node_modules" && e !== "dist") {
				const st = statSync(join(processCwd, e));
				if (st.isDirectory() && (e === "sessions" || e.endsWith("-sessions"))) {
					const from = join(processCwd, e);
					const to = join(dest, e);
					if (!existsSync(to)) {
						renameSync(from, to);
						log.push(`${e} → admin workspace`);
					}
				}
			}
		}
	} catch {
		/* ignore */
	}

	return log;
}
