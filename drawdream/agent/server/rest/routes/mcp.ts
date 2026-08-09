/**
 * MCP 外设 路由。
 */

import {
	join,
} from "node:path";
import {
	allocateServerId,
	discoverMcpCatalog,
	getMcpHub,
	loadMcpConfig,
	probeMcpServer,
	saveMcpConfig,
	sanitizeServerId,
	setDefaultEnabled,
	validateServerConfig,
	type McpServerConfig,
} from "../../../src/mcp.ts";
import {
	readBody,
	sendJson,
} from "../http.ts";
import type { RouteCtx } from "./context.ts";

export async function handleMcpRoutes(ctx: RouteCtx): Promise<boolean> {
	const { req, res, host, query } = ctx;
	const refuseWhileStreaming = ctx.refuseWhileStreaming;

	switch (ctx.route) {
			case "GET /api/mcp": {
				const hub = getMcpHub(host.cwd);
				const catalog = discoverMcpCatalog(host.cwd);
				const statuses = hub.statusList();
				// hub 尚未 session_start 时 sessionEnabled 为空：仍展示目录，enabled 全 false
				const byId = new Map(statuses.map((s) => [s.id, s]));
				const servers = catalog.map((e) => {
					const st = byId.get(e.id);
					if (st) return st;
					return {
						id: e.id,
						name: e.name,
						enabled: false,
						defaultEnabled: e.enabled,
						transport: e.transport,
						status: "disconnected" as const,
						tools: [],
						summary:
							e.transport === "stdio"
								? `${e.command ?? ""} ${(e.args ?? []).join(" ")}`.trim()
								: (e.url ?? ""),
						source: e.source,
						sources: e.sources,
						discovered: e.discovered,
					};
				});
				const project = loadMcpConfig(host.cwd);
				sendJson(res, 200, {
					servers,
					sessionEnabled: hub.getSessionEnabled(),
					// 项目手写条目（编辑表单回填）
					config: project.servers,
					// 发现摘要（调试/面板提示）
					discovered: catalog.length,
				});
				return true;
			}
			case "POST /api/mcp/sync": {
				try {
					await host.promptCommand("/mcpsync");
				} catch {
					// 扩展未装载：仅 hub 侧对账
					const hub = getMcpHub(host.cwd);
					await hub.sync();
				}
				sendJson(res, 200, { ok: true, servers: getMcpHub(host.cwd).statusList() });
				return true;
			}
			// 本对话启用/关闭（agent 绑会话）；可选写入「新对话默认」
			case "POST /api/mcp/enable": {
				const body = JSON.parse(await readBody(req)) as {
					id?: string;
					enabled?: boolean;
					/** true=同时写入项目 defaults，影响之后的新对话 */
					persistDefault?: boolean;
				};
				const id = sanitizeServerId(String(body.id ?? ""));
				if (!id) throw new Error("缺少 id");
				const on = body.enabled === true;
				if (body.persistDefault === true) {
					setDefaultEnabled(host.cwd, id, on);
				}
				try {
					await host.promptCommand(`/mcpset ${id} ${on ? "on" : "off"}`);
				} catch (e) {
					throw new Error(`切换失败：${e instanceof Error ? e.message : String(e)}`);
				}
				sendJson(res, 200, {
					ok: true,
					id,
					enabled: on,
					servers: getMcpHub(host.cwd).statusList(),
					sessionEnabled: getMcpHub(host.cwd).getSessionEnabled(),
				});
				return true;
			}
			case "POST /api/mcp/servers": {
				const body = JSON.parse(await readBody(req)) as Partial<McpServerConfig> & { id?: string };
				const cfg = loadMcpConfig(host.cwd);
				const name = String(body.name ?? body.id ?? "").trim();
				if (!name && !body.command && !body.url) throw new Error("请填写名称，以及 command 或 url");
				const id = body.id?.trim()
					? sanitizeServerId(body.id)
					: allocateServerId(host.cwd, name || body.command || "server");
				if (!id) throw new Error("无效的服务器 id");
				if (cfg.servers.some((s) => s.id === id)) throw new Error(`id「${id}」已在项目配置中`);
				// 手写添加默认关（与发现一致）；调用方可显式 enabled:true
				const server: McpServerConfig = {
					id,
					name: name || id,
					enabled: body.enabled === true,
					transport: body.transport === "http" || body.transport === "sse" ? body.transport : "stdio",
					command: typeof body.command === "string" ? body.command.trim() : undefined,
					args: Array.isArray(body.args) ? body.args.filter((x): x is string => typeof x === "string") : undefined,
					env: body.env && typeof body.env === "object" ? (body.env as Record<string, string>) : undefined,
					cwd: typeof body.cwd === "string" ? body.cwd.trim() : undefined,
					url: typeof body.url === "string" ? body.url.trim() : undefined,
					headers: body.headers && typeof body.headers === "object" ? (body.headers as Record<string, string>) : undefined,
				};
				const v = validateServerConfig(server);
				if (v) throw new Error(v);
				cfg.servers.push(server);
				if (server.enabled) {
					cfg.defaults = { ...(cfg.defaults ?? {}), [id]: true };
				}
				saveMcpConfig(host.cwd, cfg);
				if (server.enabled) {
					try {
						await host.promptCommand(`/mcpset ${id} on`);
					} catch {
						// ignore
					}
				}
				host.notify("info", `MCP「${server.name}」已写入项目配置`);
				sendJson(res, 200, {
					ok: true,
					server,
					servers: getMcpHub(host.cwd).statusList(),
				});
				return true;
			}
			case "PUT /api/mcp/servers": {
				const body = JSON.parse(await readBody(req)) as Partial<McpServerConfig> & { id?: string };
				const id = sanitizeServerId(String(body.id ?? ""));
				if (!id) throw new Error("缺少 id");
				const cfg = loadMcpConfig(host.cwd);
				const idx = cfg.servers.findIndex((s) => s.id === id);
				// 仅项目手写可改 endpoint；发现项请用 enable 开关
				if (idx < 0) {
					if (typeof body.enabled === "boolean") {
						// 发现项：只改开关
						setDefaultEnabled(host.cwd, id, body.enabled);
						try {
							await host.promptCommand(`/mcpset ${id} ${body.enabled ? "on" : "off"}`);
						} catch {
							// ignore
						}
						sendJson(res, 200, {
							ok: true,
							servers: getMcpHub(host.cwd).statusList(),
							sessionEnabled: getMcpHub(host.cwd).getSessionEnabled(),
						});
						return true;
					}
					throw new Error(`项目中无手写条目「${id}」（发现项只能开关，或先「添加」做项目覆盖）`);
				}
				const prev = cfg.servers[idx];
				const server: McpServerConfig = {
					...prev,
					name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : prev.name,
					enabled: typeof body.enabled === "boolean" ? body.enabled : prev.enabled,
					transport:
						body.transport === "http" || body.transport === "sse" || body.transport === "stdio"
							? body.transport
							: prev.transport,
					command: body.command !== undefined ? String(body.command).trim() : prev.command,
					args: body.args !== undefined
						? Array.isArray(body.args)
							? body.args.filter((x): x is string => typeof x === "string")
							: prev.args
						: prev.args,
					env: body.env !== undefined
						? body.env && typeof body.env === "object"
							? (body.env as Record<string, string>)
							: undefined
						: prev.env,
					cwd: body.cwd !== undefined ? String(body.cwd).trim() || undefined : prev.cwd,
					url: body.url !== undefined ? String(body.url).trim() || undefined : prev.url,
					headers: body.headers !== undefined
						? body.headers && typeof body.headers === "object"
							? (body.headers as Record<string, string>)
							: undefined
						: prev.headers,
				};
				const v = validateServerConfig(server);
				if (v) throw new Error(v);
				cfg.servers[idx] = server;
				cfg.defaults = { ...(cfg.defaults ?? {}), [id]: server.enabled === true };
				saveMcpConfig(host.cwd, cfg);
				try {
					await host.promptCommand(`/mcpset ${id} ${server.enabled ? "on" : "off"}`);
				} catch {
					// ignore
				}
				sendJson(res, 200, { ok: true, server, servers: getMcpHub(host.cwd).statusList() });
				return true;
			}
			case "DELETE /api/mcp/servers": {
				const id = sanitizeServerId(query.get("id") ?? "");
				if (!id) throw new Error("缺少 id");
				const cfg = loadMcpConfig(host.cwd);
				const next = cfg.servers.filter((s) => s.id !== id);
				if (next.length === cfg.servers.length) {
					throw new Error(`项目中无手写「${id}」（发现项不能删除，关掉即可）`);
				}
				cfg.servers = next;
				if (cfg.defaults) {
					const d = { ...cfg.defaults };
					delete d[id];
					cfg.defaults = d;
				}
				saveMcpConfig(host.cwd, cfg);
				try {
					await host.promptCommand(`/mcpset ${id} off`);
				} catch {
					// ignore
				}
				host.notify("info", `已删除项目 MCP「${id}」`);
				sendJson(res, 200, { ok: true, servers: getMcpHub(host.cwd).statusList() });
				return true;
			}
			case "POST /api/mcp/probe": {
				const body = JSON.parse(await readBody(req)) as Partial<McpServerConfig> & { id?: string };
				// 允许只传 id：从目录取 endpoint
				let server: McpServerConfig;
				if (body.id && !body.command && !body.url) {
					const hit = discoverMcpCatalog(host.cwd).find((s) => s.id === sanitizeServerId(body.id!));
					if (!hit) throw new Error(`目录中无「${body.id}」`);
					server = {
						id: hit.id,
						name: hit.name,
						enabled: true,
						transport: hit.transport,
						command: hit.command,
						args: hit.args,
						env: hit.env,
						cwd: hit.cwd,
						url: hit.url,
						headers: hit.headers,
					};
				} else {
					server = {
						id: sanitizeServerId(String(body.id ?? "probe")) || "probe",
						name: String(body.name ?? "probe"),
						enabled: true,
						transport: body.transport === "http" || body.transport === "sse" ? body.transport : "stdio",
						command: typeof body.command === "string" ? body.command.trim() : undefined,
						args: Array.isArray(body.args) ? body.args.filter((x): x is string => typeof x === "string") : undefined,
						env: body.env && typeof body.env === "object" ? (body.env as Record<string, string>) : undefined,
						cwd: typeof body.cwd === "string" ? body.cwd.trim() : undefined,
						url: typeof body.url === "string" ? body.url.trim() : undefined,
						headers:
							body.headers && typeof body.headers === "object" ? (body.headers as Record<string, string>) : undefined,
					};
				}
				const result = await probeMcpServer(server);
				sendJson(res, 200, result);
				return true;
			}

			// ---- Agent 自建面板：drawdream-panels 社区格式导入。导出走前端（内容已在 wire，零服务端） ----
			default:
				return false;
	}
}
