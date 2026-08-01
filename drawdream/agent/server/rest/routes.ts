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

function pickHandler(urlPath: string): Handler {
	// urlPath like /api/models or /api/agent-profiles/one
	const seg = urlPath.split("/", 3)[2] ?? "";
	return BY_SEGMENT[seg] ?? handleMiscRoutes;
}

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse, host: RestHost): Promise<boolean> {
	const url = (req.url ?? "/").split("?")[0];
	if (!url.startsWith("/api/")) return false;
	const query = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
	const route = `${req.method} ${url}`;

	const refuseWhileStreaming = (): boolean => {
		if (!host.isStreaming()) return false;
		sendJson(res, 409, { error: "正在生成回复，请稍候（或先停止）再操作" });
		return true;
	};

	const ctx: RouteCtx = { req, res, host, query, route, refuseWhileStreaming };

	try {
		const handled = await pickHandler(url)(ctx);
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
