/**
 * DrawDream REST 路由分发（/api/*）。
 * 按路径前缀 O(1) 选域处理器，避免 11 域线性扫描。
 * 域路由：./routes/{misc,codex,skills,mcp,sessions,cards,personas,presets,lore,agent,forge}.ts
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { RestHost } from "./types.ts";
import { sendJson } from "./http.ts";
import type { RouteCtx } from "./routes/context.ts";
import { handleMiscRoutes } from "./routes/misc.ts";
import { handleCodexRoutes } from "./routes/codex.ts";
import { handleSkillsRoutes } from "./routes/skills.ts";
import { handleMcpRoutes } from "./routes/mcp.ts";
import { handleSessionsRoutes } from "./routes/sessions.ts";
import { handleCardsRoutes } from "./routes/cards.ts";
import { handlePersonasRoutes } from "./routes/personas.ts";
import { handlePresetsRoutes } from "./routes/presets.ts";
import { handleLoreRoutes } from "./routes/lore.ts";
import { handleAgentRoutes } from "./routes/agent.ts";
import { handleForgeRoutes } from "./routes/forge.ts";
import { handleCompatibilityRoutes } from "./routes/compatibility.ts";
import { handleExtensionsRoutes } from "./routes/extensions.ts";
import { handleSillyTavernCompatRoutes } from "./routes/sillytavern-compat.ts";

type Handler = (ctx: RouteCtx) => Promise<boolean>;

/** 第二路径段 → 域处理器（/api/<seg>/...） */
const BY_SEGMENT: Record<string, Handler> = {
	forge: handleForgeRoutes,
	mcp: handleMcpRoutes,
	skills: handleSkillsRoutes,
	codex: handleCodexRoutes,
	sessions: handleSessionsRoutes,
	cards: handleCardsRoutes,
	card: handleCardsRoutes,
	greeting: handleCardsRoutes,
	personas: handlePersonasRoutes,
	presets: handlePresetsRoutes,
	preset: handlePresetsRoutes,
	lorebooks: handleLoreRoutes,
	lorebook: handleLoreRoutes,
	models: handleAgentRoutes,
	auth: handleAgentRoutes,
	"agent-profiles": handleAgentRoutes,
	"agent-config": handleAgentRoutes,
	"models-json": handleAgentRoutes,
	channels: handleAgentRoutes,
	config: handleAgentRoutes,
	compatibility: handleCompatibilityRoutes,
	extensions: handleExtensionsRoutes,
};

/** SillyTavern 原生路径前缀（需在 DrawDream 自有路由之前匹配） */
const ST_COMPAT_SEGMENTS = new Set([
	"characters", "chats", "groups", "settings", "worldinfo",
	"presets", "themes", "quick-replies", "moving-ui",
	"backends", "stats", "secrets", "backups",
	"tokenizers", "files", "images", "backgrounds",
	"image-metadata", "avatars", "sprites", "assets",
	"content", "horde", "users", "ping", "sd",
]);

/** SillyTavern 原生 /api/presets/* 具体方法（仅这些被兼容层接管，其余归 DrawDream presets 域路由） */
const ST_PRESET_METHODS = new Set([
	"POST /api/presets/save",
	"POST /api/presets/delete",
	"POST /api/presets/restore",
]);

/** 非 /api/* 前缀的 SillyTavern 原生路径 */
const ST_ROOT_PATHS = new Set(["/csrf-token", "/version"]);

/** 是否 SillyTavern 兼容路径（导出供测试） */
export function isStCompatPath(urlPath: string, method = "GET"): boolean {
	if (ST_ROOT_PATHS.has(urlPath)) return true;
	if (!urlPath.startsWith("/api/")) return false;
	// /api/presets/*：仅 SillyTavern 兼容层明确接管的方法（save/delete/restore）走兼容层；
	// 其余（preview/import/select/saveas/rename/export 等）归 DrawDream presets 域路由。
	if (urlPath.startsWith("/api/presets")) {
		return ST_PRESET_METHODS.has(`${method} ${urlPath}`);
	}
	const seg = urlPath.split("/", 3)[2] ?? "";
	return ST_COMPAT_SEGMENTS.has(seg);
}

function pickHandler(urlPath: string): Handler {
	// SillyTavern 原生路径优先匹配兼容层
	if (isStCompatPath(urlPath)) return handleSillyTavernCompatRoutes;
	// DrawDream 自有 /api/* 路由
	const seg = urlPath.split("/", 3)[2] ?? "";
	return BY_SEGMENT[seg] ?? handleMiscRoutes;
}

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse, host: RestHost): Promise<boolean> {
	const url = (req.url ?? "/").split("?")[0];
	// SillyTavern 原生根路径（/csrf-token, /version）也走兼容层
	if (ST_ROOT_PATHS.has(url) || url.startsWith("/api/")) {
		const query = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
		const route = `${req.method} ${url}`;

		const refuseWhileStreaming = (): boolean => {
			if (!host.isStreaming()) return false;
			sendJson(res, 409, { error: "正在生成回复，请稍候（或先停止）再操作" });
			return true;
		};

		const ctx: RouteCtx = { req, res, host, query, route, url, refuseWhileStreaming };

		try {
			const handler = isStCompatPath(url, req.method ?? "GET") ? handleSillyTavernCompatRoutes : pickHandler(url);
			const handled = await handler(ctx);
			if (handled) return true;
			sendJson(res, 404, { error: `未知接口：${route}` });
			return true;
		} catch (err) {
			if (err && typeof err === 'object' && 'toJSON' in err && typeof (err as { toJSON?: unknown }).toJSON === 'function') {
				const body = (err as { toJSON: () => Record<string, unknown> }).toJSON()
				sendJson(res, body.code === 'COMPATIBILITY_UNSUPPORTED' ? 404 : 400, body)
				return true
			}
			sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
			return true;
		}
	}
	return false;
}
