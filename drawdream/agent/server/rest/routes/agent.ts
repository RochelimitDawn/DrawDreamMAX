/**
 * 模型/鉴权/Agent 配置/渠道 路由。
 */

import {
	deleteProfile,
	enableProfile,
	listProfiles,
	loadAgentConfig,
	loadProfile,
	materializeEnvKeysInConfig,
	mergeModelsById,
	normalizeAgentConfig,
	normalizeModels,
	publicProvider,
	saveProfile,
	type AgentModelEntry,
	type AgentProvider,
} from "../../../src/agent-config.ts";
import {
	readBody,
	sendJson,
} from "../http.ts";
import {
	applyConfigPatch,
	configPath,
	loadConfig,
	loadOrSeedAgentConfig,
	markAgentConfigSynced,
	persistAgentConfig,
	normalizeBaseUrlForApi,
	probeModelsEndpoint,
	rebindCurrentModel,
	writeJsonWithBackup,
} from "../config.ts";
import type { RouteCtx } from "./context.ts";

export async function handleAgentRoutes(ctx: RouteCtx): Promise<boolean> {
	const { req, res, host, query } = ctx;
	const refuseWhileStreaming = ctx.refuseWhileStreaming;

	switch (ctx.route) {
			case "GET /api/models": {
				// agent.json 变更时 sync+refresh（mtime 缓存）；仅在同步实际发生后 rebind，避免热路径反复 selectModel
				const before = host.listModels().current;
				const { config } = loadOrSeedAgentConfig(host);
				const afterRefresh = host.listModels().current;
				const needRebind =
					!before ||
					before.provider === "unknown" ||
					!afterRefresh ||
					afterRefresh.provider === "unknown" ||
					before.provider !== afterRefresh.provider ||
					before.id !== afterRefresh.id ||
					before.contextWindow !== afterRefresh.contextWindow ||
					before.maxTokens !== afterRefresh.maxTokens ||
					(config.defaultProvider && config.defaultModel &&
						(afterRefresh.provider !== config.defaultProvider || afterRefresh.id !== config.defaultModel));
				if (needRebind) await rebindCurrentModel(host, config);
				sendJson(res, 200, host.listModels());
				return true;
			}
			case "POST /api/models/select": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { provider?: string; id?: string };
				if (!body.provider || !body.id) throw new Error("缺少 provider / id");
				const current = await host.selectModel(body.provider, body.id);
				// 持久化默认渠道/模型，避免下次 GET /api/models 或重启后被旧 default 拉回
				try {
					const { config } = loadOrSeedAgentConfig(host);
					config.defaultProvider = body.provider;
					config.defaultModel = body.id;
					persistAgentConfig(host, config);
				} catch {
					/* 配置文件异常时仍完成会话内切换 */
				}
				host.notify("info", `模型已切换：${current.name}`);
				sendJson(res, 200, { current });
				return true;
			}
			case "POST /api/models/thinking": {
				const body = JSON.parse(await readBody(req)) as { level?: string };
				if (!body.level) throw new Error("缺少 level");
				sendJson(res, 200, { current: host.setThinkingLevel(body.level) });
				return true;
			}

			// ---- API 连接 ----
			case "GET /api/auth": {
				sendJson(res, 200, { providers: host.authProviders() });
				return true;
			}
			case "POST /api/auth": {
				const body = JSON.parse(await readBody(req)) as { provider?: string; key?: string };
				if (!body.provider || !body.key) throw new Error("缺少 provider / key");
				host.setAuthKey(body.provider, body.key.trim());
				host.refreshModels();
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "DELETE /api/auth": {
				const provider = query.get("provider");
				if (!provider) throw new Error("缺少 provider");
				host.removeAuth(provider);
				host.refreshModels();
				sendJson(res, 200, { ok: true });
				return true;
			}
			// ---- 配置仓库 drawdream-profiles/ + 当前启用 drawdream.agent.json ----
			case "GET /api/agent-profiles": {
				loadOrSeedAgentConfig(host); // 触发迁移
				sendJson(res, 200, { profiles: listProfiles(host.cwd) });
				return true;
			}
			case "GET /api/agent-profiles/one": {
				const id = (query.get("id") ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const rec = loadProfile(host.cwd, id);
				if (!rec) throw new Error(`配置不存在：${id}`);
				sendJson(res, 200, {
					id: rec.id,
					name: rec.name,
					updatedAt: rec.updatedAt,
					config: rec.config,
					text: `${JSON.stringify(rec.config, null, "\t")}\n`,
				});
				return true;
			}
			/** 生成器：只写入仓库，不启用 */
			case "POST /api/agent-profiles": {
				const body = JSON.parse(await readBody(req)) as {
					id?: string;
					name?: string;
					config?: unknown;
					text?: string;
				};
				let parsed: unknown = body.config;
				if (typeof body.text === "string") {
					try {
						parsed = JSON.parse(body.text);
					} catch (e) {
						throw new Error(`JSON 无法解析：${e instanceof Error ? e.message : String(e)}`);
					}
				}
				if (!parsed) throw new Error("缺少 config 或 text");
				const config = normalizeAgentConfig(parsed);
				materializeEnvKeysInConfig(config);
				const idRaw = (body.id ?? body.name ?? Object.keys(config.providers)[0] ?? "").trim();
				if (!idRaw) throw new Error("请填写配置名");
				const name = (body.name ?? idRaw).trim();
				// 生成器只写入仓库，不启用；同名则覆盖仓库副本
				const rec = saveProfile(host.cwd, idRaw, name, config);
				host.notify("info", `配置「${rec.name}」已存入仓库（未启用）`);
				sendJson(res, 200, { ok: true, profile: { id: rec.id, name: rec.name, updatedAt: rec.updatedAt }, profiles: listProfiles(host.cwd) });
				return true;
			}
			/** 修改仓库中的配置（不自动启用，除非已是启用中的那份） */
			case "PUT /api/agent-profiles": {
				const body = JSON.parse(await readBody(req)) as {
					id?: string;
					name?: string;
					config?: unknown;
					text?: string;
				};
				const id = (body.id ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const prev = loadProfile(host.cwd, id);
				if (!prev) throw new Error(`配置不存在：${id}`);
				let parsed: unknown = body.config ?? prev.config;
				if (typeof body.text === "string") {
					try {
						parsed = JSON.parse(body.text);
					} catch (e) {
						throw new Error(`JSON 无法解析：${e instanceof Error ? e.message : String(e)}`);
					}
				}
				const config = normalizeAgentConfig(parsed);
				materializeEnvKeysInConfig(config);
				const name = (body.name ?? prev.name).trim();
				const rec = saveProfile(host.cwd, id, name, config);
				// 若正在启用这份，同步到 runtime 并重绑当前模型（contextWindow 等）
				const active = listProfiles(host.cwd).find((p) => p.active);
				if (active?.id === id) {
					persistAgentConfig(host, config);
					await rebindCurrentModel(host);
				}
				host.notify("info", `配置「${rec.name}」已更新`);
				sendJson(res, 200, {
					ok: true,
					profile: { id: rec.id, name: rec.name, updatedAt: rec.updatedAt },
					profiles: listProfiles(host.cwd),
					current: host.listModels().current,
				});
				return true;
			}
			case "POST /api/agent-profiles/enable":
			case "POST /api/agent-profiles/refresh": {
				// enable：启用仓库配置；refresh：已启用时从仓库/磁盘重读并重传到 models.json（不必先关再开）
				const isRefresh = ctx.route === "POST /api/agent-profiles/refresh";
				const body = JSON.parse(await readBody(req)) as { id?: string };
				const id = (body.id ?? "").trim();
				if (!id) throw new Error("缺少 id");
				if (isRefresh) {
					const active = listProfiles(host.cwd).find((p) => p.active);
					if (active?.id !== id) {
						throw new Error("只能刷新「启用中」的配置；其它配置请先点启用");
					}
				}
				const config = enableProfile(host.cwd, host.agentDir(), id);
				host.refreshModels();
				// 切换到配置里的默认模型
				if (config.defaultProvider && config.defaultModel) {
					try {
						await host.selectModel(config.defaultProvider, config.defaultModel);
					} catch {
						/* 模型可能暂不可用 */
					}
				}
				// 模型条目 thinkingLevel > defaultThinkingLevel → 会话当前生效
				await rebindCurrentModel(host, config);
				// enable 已写盘并 refresh：记 mtime，避免下一次 GET /api/models 再全量 sync
				markAgentConfigSynced(host.cwd);
				host.notify("info", isRefresh ? `已刷新配置「${id}」并重传到运行时` : `已启用配置「${id}」`);
				sendJson(res, 200, {
					ok: true,
					refreshed: isRefresh,
					config,
					profiles: listProfiles(host.cwd),
					current: host.listModels().current,
				});
				return true;
			}
			case "DELETE /api/agent-profiles": {
				const id = (query.get("id") ?? "").trim();
				if (!id) throw new Error("缺少 id");
				deleteProfile(host.cwd, id);
				host.notify("info", `已删除配置「${id}」`);
				sendJson(res, 200, { ok: true, profiles: listProfiles(host.cwd) });
				return true;
			}

			// ---- 当前启用的 Agent 配置（drawdream.agent.json）----
			case "GET /api/agent-config": {
				const { path, exists, config, seeded } = loadOrSeedAgentConfig(host);
				await rebindCurrentModel(host);
				if (seeded) host.notify("info", "已将当前使用中的渠道收编进 DrawDream Agent 配置");
				sendJson(res, 200, {
					path,
					exists: exists || seeded,
					config,
					text: `${JSON.stringify(config, null, "\t")}\n`,
					seeded,
					profiles: listProfiles(host.cwd),
				});
				return true;
			}
			case "PUT /api/agent-config": {
				const body = JSON.parse(await readBody(req)) as { text?: string; config?: unknown };
				let parsed: unknown;
				if (typeof body.text === "string") {
					try {
						parsed = JSON.parse(body.text);
					} catch (e) {
						throw new Error(`JSON 无法解析：${e instanceof Error ? e.message : String(e)}`);
					}
				} else if (body.config !== undefined) {
					parsed = body.config;
				} else {
					throw new Error("缺少 text 或 config");
				}
				const config = persistAgentConfig(host, normalizeAgentConfig(parsed));
				await rebindCurrentModel(host);
				host.notify("info", "当前 Agent 配置已保存");
				sendJson(res, 200, {
					ok: true,
					path: loadAgentConfig(host.cwd).path,
					config,
					text: `${JSON.stringify(config, null, "\t")}\n`,
					current: host.listModels().current,
				});
				return true;
			}
			// 兼容旧路径：转发到 agent-config
			case "GET /api/models-json": {
				const { path, exists, config, seeded } = loadOrSeedAgentConfig(host);
				sendJson(res, 200, {
					path,
					exists: exists || seeded,
					content: config,
					text: `${JSON.stringify(config, null, "\t")}\n`,
				});
				return true;
			}
			case "PUT /api/models-json": {
				const body = JSON.parse(await readBody(req)) as { text?: string; content?: unknown };
				const parsed =
					typeof body.text === "string"
						? JSON.parse(body.text)
						: body.content !== undefined
							? body.content
							: null;
				if (!parsed) throw new Error("缺少 text 或 content");
				const config = persistAgentConfig(host, normalizeAgentConfig(parsed));
				sendJson(res, 200, {
					ok: true,
					path: loadAgentConfig(host.cwd).path,
					text: `${JSON.stringify(config, null, "\t")}\n`,
				});
				return true;
			}
			case "POST /api/channels": {
				const body = JSON.parse(await readBody(req)) as {
					name?: string;
					baseUrl?: string;
					api?: string;
					apiKey?: string;
					models?: unknown;
					provider?: Record<string, unknown>;
					setDefault?: boolean;
				};
				const name = (body.name ?? "").trim();
				const rawBaseUrl = (body.baseUrl ?? (body.provider?.baseUrl as string | undefined) ?? "").toString().trim();
				const api = (body.api ?? (body.provider?.api as string | undefined) ?? "").toString().trim();
				if (!name || !rawBaseUrl || !api) throw new Error("渠道名、Base URL、API 类型均必填（模型清单可后补）");
				if (!/^[\w.-]+$/.test(name)) throw new Error("渠道名只允许字母数字与 . - _");
				// 按协议归一 baseUrl（OpenAI 剥资源后缀；Google 补 /v1beta 等）
				const baseUrl = normalizeBaseUrlForApi(rawBaseUrl, api);
				const { config } = loadOrSeedAgentConfig(host);
				if (config.providers[name]) throw new Error(`渠道已存在：${name}`);
				const models = normalizeModels(body.models ?? body.provider?.models ?? []);
				const fromProvider = body.provider && typeof body.provider === "object" ? { ...body.provider } : {};
				delete fromProvider.name;
				const entry: AgentProvider = {
					...fromProvider,
					baseUrl,
					api,
					apiKey: (body.apiKey ?? (fromProvider.apiKey as string | undefined) ?? "").toString().trim() || "placeholder",
					models,
				};
				config.providers[name] = entry;
				if (body.setDefault || !config.defaultProvider) {
					config.defaultProvider = name;
					if (models[0]) config.defaultModel = models[0].id;
				}
				persistAgentConfig(host, config);
				// 新建渠道后立即把会话从 unknown 占位模型绑到默认模型，避免「No API key for the selected model」
				await rebindCurrentModel(host, config);
				host.notify("info", `渠道「${name}」已保存（${models.length} 个模型）`);
				sendJson(res, 200, {
					ok: true,
					channel: publicProvider(name, entry),
					config,
					current: host.listModels().current,
				});
				return true;
			}
			case "GET /api/channels": {
				const { path, config, seeded } = loadOrSeedAgentConfig(host);
				if (seeded) host.notify("info", "已将当前使用中的渠道收编进 DrawDream Agent 配置");
				sendJson(res, 200, {
					path,
					configPath: path,
					channels: Object.entries(config.providers).map(([name, p]) => publicProvider(name, p)),
					defaultProvider: config.defaultProvider ?? null,
					defaultModel: config.defaultModel ?? null,
				});
				return true;
			}
			case "PUT /api/channels": {
				const body = JSON.parse(await readBody(req)) as {
					name?: string;
					baseUrl?: string;
					api?: string;
					apiKey?: string;
					models?: unknown;
					mergeModels?: boolean;
					patch?: Record<string, unknown>;
					setDefault?: boolean;
					modelId?: string;
				};
				const name = (body.name ?? "").trim();
				const { config } = loadOrSeedAgentConfig(host);
				const ch = config.providers[name];
				if (!ch) throw new Error(`渠道不存在：${name}`);
				if (body.patch && typeof body.patch === "object") {
					for (const [k, v] of Object.entries(body.patch)) {
						if (k === "name") continue;
						if (v === null) delete ch[k];
						else ch[k] = v;
					}
				}
				if (typeof body.api === "string" && body.api.trim()) ch.api = body.api.trim();
				if (typeof body.baseUrl === "string" && body.baseUrl.trim()) {
					const apiForNorm = (typeof ch.api === "string" && ch.api) || "openai-completions";
					ch.baseUrl = normalizeBaseUrlForApi(body.baseUrl, apiForNorm);
				}
				if (typeof body.apiKey === "string" && body.apiKey.trim()) ch.apiKey = body.apiKey.trim();
				if (body.models !== undefined) {
					const incoming = normalizeModels(body.models);
					ch.models = body.mergeModels ? mergeModelsById(normalizeModels(ch.models), incoming) : incoming;
				}
				config.providers[name] = ch;
				const bodyModelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
				if (body.setDefault) {
					config.defaultProvider = name;
					const list = normalizeModels(ch.models);
					const mid =
						(bodyModelId && list.some((m) => m.id === bodyModelId) ? bodyModelId : undefined) ||
						list[0]?.id;
					if (mid) config.defaultModel = mid;
				}
				persistAgentConfig(host, config);
				// 保存 Key / 改默认后始终重绑（含从 unknown 占位切到真实模型）
				await rebindCurrentModel(host, config);
				sendJson(res, 200, { ok: true, channel: publicProvider(name, ch), config, current: host.listModels().current });
				return true;
			}
			case "DELETE /api/channels": {
				const name = (query.get("name") ?? "").trim();
				if (!name) throw new Error("缺少 name");
				const { config } = loadOrSeedAgentConfig(host);
				if (!config.providers[name]) throw new Error(`渠道不存在：${name}`);
				const wasDefault = config.defaultProvider === name;
				delete config.providers[name];
				// 清理运行时 auth，避免「删了渠道但 registry 仍挂着」
				try {
					host.removeAuth(name);
				} catch {
					/* ignore */
				}
				if (wasDefault || !config.defaultProvider || !config.providers[config.defaultProvider]) {
					const first = Object.keys(config.providers)[0];
					config.defaultProvider = first;
					config.defaultModel = first ? normalizeModels(config.providers[first].models)[0]?.id : undefined;
				}
				persistAgentConfig(host, config);
				// 切到剩余渠道的默认模型；全空时仅刷新
				if (config.defaultProvider && config.defaultModel) {
					try {
						await host.selectModel(config.defaultProvider, config.defaultModel);
					} catch {
						/* 模型可能暂不可用 */
					}
				} else {
					host.refreshModels();
				}
				host.notify("info", `渠道「${name}」已删除`);
				sendJson(res, 200, {
					ok: true,
					channels: Object.entries(config.providers).map(([n, p]) => publicProvider(n, p)),
					defaultProvider: config.defaultProvider ?? null,
					defaultModel: config.defaultModel ?? null,
					current: host.listModels().current,
				});
				return true;
			}
			case "POST /api/channels/test": {
				const body = JSON.parse(await readBody(req)) as {
					name?: string;
					baseUrl?: string;
					apiKey?: string;
					api?: string;
				};
				let baseUrl = (body.baseUrl ?? "").trim();
				let apiKey = (body.apiKey ?? "").trim() || undefined;
				let api = (body.api ?? "").trim();
				const name = (body.name ?? "").trim();
				if (name) {
					const ch = loadOrSeedAgentConfig(host).config.providers[name];
					if (!ch?.baseUrl) throw new Error(`渠道不存在或缺 Base URL：${name}`);
					baseUrl = String(ch.baseUrl);
					if (!api && typeof ch.api === "string") api = ch.api;
					if (!apiKey) {
						const k = typeof ch.apiKey === "string" ? ch.apiKey : "";
						if (k && k !== "placeholder") apiKey = k; // $ENV 由 probe 解析
					}
				}
				if (!baseUrl) throw new Error("缺少 name 或 baseUrl");
				const result = await probeModelsEndpoint(baseUrl, apiKey, api || undefined);
				sendJson(res, 200, {
					ok: result.ok,
					status: result.status,
					detail: result.detail,
					latencyMs: result.latencyMs,
					modelCount: result.ids.length,
				});
				return true;
			}
			case "POST /api/channels/fetch-models": {
				const body = JSON.parse(await readBody(req)) as {
					name?: string;
					baseUrl?: string;
					apiKey?: string;
					api?: string;
					apply?: boolean;
				};
				let baseUrl = (body.baseUrl ?? "").trim();
				let apiKey = (body.apiKey ?? "").trim() || undefined;
				let api = (body.api ?? "").trim();
				const name = (body.name ?? "").trim();
				const loaded = name ? loadOrSeedAgentConfig(host) : null;
				const ch = name && loaded ? loaded.config.providers[name] : undefined;
				if (name) {
					if (!ch?.baseUrl) throw new Error(`渠道不存在或缺 Base URL：${name}`);
					baseUrl = String(ch.baseUrl);
					if (!api && typeof ch.api === "string") api = ch.api;
					if (!apiKey) {
						const k = typeof ch.apiKey === "string" ? ch.apiKey : "";
						if (k && k !== "placeholder") apiKey = k;
					}
				}
				if (!baseUrl) throw new Error("缺少 name 或 baseUrl");
				const result = await probeModelsEndpoint(baseUrl, apiKey, api || undefined);
				if (!result.ok) throw new Error(`拉取失败：${result.detail}`);
				if (result.ids.length === 0) throw new Error("渠道返回了空模型清单");
				const models = result.ids.map((id) => ({ id })) as AgentModelEntry[];
				if (body.apply && name && loaded && ch) {
					ch.models = mergeModelsById(normalizeModels(ch.models), models);
					// 无默认模型时用清单第一项
					if (!loaded.config.defaultModel && models[0]) {
						loaded.config.defaultProvider = name;
						loaded.config.defaultModel = models[0].id;
					}
					loaded.config.providers[name] = ch;
					persistAgentConfig(host, loaded.config);
					await rebindCurrentModel(host, loaded.config);
					host.notify("info", `「${name}」已合并 ${result.ids.length} 个模型`);
					sendJson(res, 200, {
						ok: true,
						models: result.ids,
						channel: publicProvider(name, ch),
						current: host.listModels().current,
					});
					return true;
				}
				sendJson(res, 200, { ok: true, models: result.ids });
				return true;
			}

			// ---- 配置（用户角色 / 设置） ----
			case "GET /api/config": {
				sendJson(res, 200, { config: loadConfig(host.cwd) });
				return true;
			}
			case "PUT /api/config": {
				if (refuseWhileStreaming()) return true;
				const patch = JSON.parse(await readBody(req)) as Record<string, unknown>;
				const next = applyConfigPatch(loadConfig(host.cwd), patch);
				writeJsonWithBackup(configPath(host.cwd), next);
				await host.softRefreshConfig();
				sendJson(res, 200, { config: next });
				return true;
			}

			// ---- 角色卡 ----
			default:
				return false;
	}
}
