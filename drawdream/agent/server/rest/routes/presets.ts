/**
 * 预设 路由。
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import {
	join,
} from "node:path";
import {
	convertStPreset,
	isStPresetJson,
	normalizeRpPreset,
	summarizeConvertReport,
	type RpPreset,
} from "../../../src/preset.ts";
import {
	fetchRemoteJsonObject,
} from "../../../src/remote-json.ts";
import {
	readBody,
	resolvePath,
	sendJson,
} from "../http.ts";
import {
	clearPresetOverride,
	configPath,
	listPresetFiles,
	loadConfig,
	loadDiskPreset,
	loadEffectivePreset,
	mergePresetPatches,
	PRESETS_DIR,
	presetOverridePath,
	presetSlug,
	validatePresetPath,
	writeJsonWithBackup,
} from "../config.ts";
import type { RouteCtx } from "./context.ts";

export async function handlePresetsRoutes(ctx: RouteCtx): Promise<boolean> {
	const { req, res, host, query } = ctx;
	const refuseWhileStreaming = ctx.refuseWhileStreaming;

	switch (ctx.route) {
			case "GET /api/presets": {
				const config = loadConfig(host.cwd);
				sendJson(res, 200, { active: config.preset ?? null, presets: listPresetFiles(host.cwd) });
				return true;
			}
			case "POST /api/presets/select": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { file?: string | null };
				const config = loadConfig(host.cwd) as unknown as Record<string, unknown>;
				// 切换预设：丢弃未保存草稿
				clearPresetOverride(host.cwd);
				if (body.file === null || body.file === "") {
					delete config.preset; // 不用预设
				} else {
					const file = validatePresetPath(body.file ?? "");
					if (!existsSync(resolvePath(host.cwd, file))) throw new Error("预设文件不存在");
					config.preset = file;
				}
				writeJsonWithBackup(configPath(host.cwd), config);
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "POST /api/presets/saveas": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { name?: string };
				const name = (body.name ?? "").trim();
				if (!name) throw new Error("缺少预设名");
				const config = loadConfig(host.cwd);
				// 另存：取当前生效内容（含未保存草稿）
				const current: RpPreset = loadEffectivePreset(host.cwd).preset
					?? (config.preset
						? normalizeRpPreset(JSON.parse(readFileSync(resolvePath(host.cwd, config.preset), "utf8")))
						: { name, samplers: {}, blocks: [] });
				const file = `${PRESETS_DIR}/${presetSlug(name)}.json`;
				const abs = resolvePath(host.cwd, file);
				if (existsSync(abs)) throw new Error(`同名预设文件已存在：${file}`);
				mkdirSync(join(host.cwd, PRESETS_DIR), { recursive: true });
				clearPresetOverride(host.cwd);
				writeJsonWithBackup(abs, { ...current, name });
				writeJsonWithBackup(configPath(host.cwd), { ...loadConfig(host.cwd), preset: file });
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true, file });
				return true;
			}
			case "POST /api/presets/rename": {
				const body = JSON.parse(await readBody(req)) as { file?: string; name?: string };
				const file = validatePresetPath(body.file ?? "");
				const name = (body.name ?? "").trim();
				if (!name) throw new Error("缺少新名字");
				const abs = resolvePath(host.cwd, file);
				const preset = normalizeRpPreset(JSON.parse(readFileSync(abs, "utf8")));
				writeJsonWithBackup(abs, { ...preset, name });
				sendJson(res, 200, { ok: true });
				return true;
			}
			case "DELETE /api/presets": {
				if (refuseWhileStreaming()) return true;
				const file = validatePresetPath(query.get("file") ?? "");
				const abs = resolvePath(host.cwd, file);
				if (!existsSync(abs)) throw new Error("预设文件不存在");
				unlinkSync(abs);
				const config = loadConfig(host.cwd) as unknown as Record<string, unknown>;
				if (config.preset === file) {
					clearPresetOverride(host.cwd);
					delete config.preset;
					writeJsonWithBackup(configPath(host.cwd), config);
					await host.softRefreshConfig();
				}
				sendJson(res, 200, { ok: true });
				return true;
			}
			/**
			 * 从 URL 拉取预设 JSON（服务端代抓，规避浏览器 CORS）。
			 * body: { url }
			 * 支持 GitHub/GitLab blob → raw 规范化；内网地址拒绝。
			 */
			case "POST /api/presets/fetch-url": {
				const body = JSON.parse(await readBody(req)) as { url?: string };
				const url = (body.url ?? "").trim();
				if (!url) throw new Error("缺少 url");
				const fetched = await fetchRemoteJsonObject(url);
				sendJson(res, 200, {
					ok: true,
					json: fetched.json,
					finalUrl: fetched.finalUrl,
					suggestedName: fetched.suggestedName,
					bytes: fetched.bytes,
					isSt: isStPresetJson(fetched.json),
				});
				return true;
			}
			/**
			 * 预览转换：不落盘。ST 预设 → 分诊报告 + 块摘要；DrawDream 预设 → 规范化预览。
			 * body: { name?, json }
			 */
			case "POST /api/presets/preview": {
				const body = JSON.parse(await readBody(req)) as { name?: string; json?: Record<string, unknown> };
				if (!body.json || typeof body.json !== "object") throw new Error("缺少预设 JSON");
				const name = (body.name ?? "").trim() || "imported-preset";
				const isSt = isStPresetJson(body.json);
				if (isSt) {
					const { preset, report } = convertStPreset(body.json, name);
					sendJson(res, 200, {
						ok: true,
						converted: true,
						name: preset.name,
						samplers: preset.samplers,
						summary: summarizeConvertReport(report, preset),
						report,
						blocks: preset.blocks.map((b) => ({
							id: b.id,
							name: b.name,
							channel: b.channel,
							role: b.role,
							enabled: b.enabled,
							chars: b.content.length,
							depth: b.depth,
						})),
					});
				} else {
					const preset = { ...normalizeRpPreset(body.json), name };
					sendJson(res, 200, {
						ok: true,
						converted: false,
						name: preset.name,
						samplers: preset.samplers,
						summary: {
							system: preset.blocks.filter((b) => b.channel === "system").length,
							postHistory: preset.blocks.filter((b) => b.channel === "postHistory").length,
							marker: 0,
							disabled: preset.blocks.filter((b) => !b.enabled).length,
							missing: 0,
							blockCount: preset.blocks.length,
							samplerKeys: Object.keys(preset.samplers),
						},
						report: [],
						blocks: preset.blocks.map((b) => ({
							id: b.id,
							name: b.name,
							channel: b.channel,
							role: b.role,
							enabled: b.enabled,
							chars: b.content.length,
							depth: b.depth,
						})),
					});
				}
				return true;
			}
			// 导入：ST 预设自动转换 / DrawDream 预设直接收档；存入 assets/presets/ 并切换启用
			// body: { name?, json, activate?: boolean }  activate 默认 true
			case "POST /api/presets/import": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as {
					name?: string;
					json?: Record<string, unknown>;
					activate?: boolean;
				};
				if (!body.json || typeof body.json !== "object") throw new Error("缺少预设 JSON");
				const name = (body.name ?? "").trim() || "imported-preset";
				const isSt = isStPresetJson(body.json);
				const { preset, report } = isSt
					? convertStPreset(body.json, name)
					: { preset: { ...normalizeRpPreset(body.json), name }, report: [] as ReturnType<typeof convertStPreset>["report"] };
				const file = `${PRESETS_DIR}/${presetSlug(name)}.json`;
				const abs = resolvePath(host.cwd, file);
				mkdirSync(join(host.cwd, PRESETS_DIR), { recursive: true });
				clearPresetOverride(host.cwd);
				writeJsonWithBackup(abs, preset);
				const activate = body.activate !== false;
				if (activate) {
					writeJsonWithBackup(configPath(host.cwd), { ...loadConfig(host.cwd), preset: file });
					await host.softRefreshConfig();
				}
				const summary = isSt
					? summarizeConvertReport(report, preset)
					: {
							system: preset.blocks.filter((b) => b.channel === "system").length,
							postHistory: preset.blocks.filter((b) => b.channel === "postHistory").length,
							marker: 0,
							disabled: preset.blocks.filter((b) => !b.enabled).length,
							missing: 0,
							blockCount: preset.blocks.length,
							samplerKeys: Object.keys(preset.samplers),
						};
				sendJson(res, 200, {
					ok: true,
					file,
					report,
					summary,
					blockCount: preset.blocks.length,
					converted: isSt,
					activated: activate,
				});
				return true;
			}
			case "GET /api/presets/export": {
				const file = validatePresetPath(query.get("file") ?? "");
				const abs = resolvePath(host.cwd, file);
				const preset = normalizeRpPreset(JSON.parse(readFileSync(abs, "utf8")));
				sendJson(res, 200, { name: preset.name, json: preset });
				return true;
			}

			// ---- 世界书文件管理（PLAN-PANELS-V2 §2.3：选书/导入/删除） ----
			case "GET /api/preset": {
				const config = loadConfig(host.cwd);
				if (!config.preset) {
					sendJson(res, 200, { preset: null, dirty: false });
					return true;
				}
				const wantWorking = query.get("working") === "1";
				const full = query.get("full") === "1";
				const loaded = wantWorking ? loadEffectivePreset(host.cwd) : (() => {
					const d = loadDiskPreset(host.cwd);
					return d
						? { path: d.path, preset: d.preset, fromOverride: false }
						: { path: config.preset, preset: null, fromOverride: false };
				})();
				if (!loaded.preset) {
					sendJson(res, 200, { preset: null, missing: config.preset, dirty: existsSync(presetOverridePath(host.cwd)) });
					return true;
				}
				const preset = loaded.preset;
				sendJson(res, 200, {
					path: loaded.path,
					dirty: existsSync(presetOverridePath(host.cwd)),
					preset: {
						name: preset.name,
						samplers: preset.samplers,
						blocks: preset.blocks.map((b) => ({
							id: b.id,
							name: b.name,
							channel: b.channel,
							role: b.role,
							enabled: b.enabled,
							chars: b.content.length,
							...(full ? { content: b.content } : {}),
						})),
					},
				});
				return true;
			}
			/** 单块全文：优先草稿，否则磁盘 */
			case "GET /api/preset/block": {
				const id = (query.get("id") ?? "").trim();
				if (!id) throw new Error("缺少 id");
				const { preset, path } = loadEffectivePreset(host.cwd);
				if (!preset) throw new Error(path ? `预设文件不存在：${path}` : "当前未配置预设文件");
				const block = preset.blocks.find((b) => b.id === id);
				if (!block) throw new Error(`找不到提示词块：${id}`);
				sendJson(res, 200, {
					id: block.id,
					name: block.name,
					channel: block.channel,
					role: block.role,
					enabled: block.enabled,
					content: block.content,
					chars: block.content.length,
				});
				return true;
			}
			/**
			 * PUT：只写入运行时草稿并热更新（**不落盘**）。
			 * 开关/改字立刻影响下一轮生成；点「保存」才写预设文件。
			 */
			case "PUT /api/preset": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as {
					samplers?: Record<string, number>;
					blocks?: Array<{
						id: string;
						enabled?: boolean;
						name?: string;
						content?: string;
						channel?: "system" | "postHistory";
					}>;
					/** 完整替换草稿（前端持有全文时用） */
					preset?: unknown;
				};
				const config = loadConfig(host.cwd);
				if (!config.preset) throw new Error("当前未配置预设文件");
				let next: RpPreset;
				if (body.preset !== undefined) {
					next = normalizeRpPreset(body.preset);
				} else {
					const base = loadEffectivePreset(host.cwd).preset ?? loadDiskPreset(host.cwd)?.preset;
					if (!base) throw new Error(`预设文件不存在：${config.preset}`);
					next = mergePresetPatches(base, body);
				}
				const ovr = presetOverridePath(host.cwd);
				mkdirSync(join(host.cwd, ".drawdream"), { recursive: true });
				writeFileSync(ovr, `${JSON.stringify(next, null, "\t")}\n`, "utf8");
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true, dirty: true, saved: false });
				return true;
			}
			/** 把当前草稿（或请求体）写入磁盘预设文件，并清除草稿标记 */
			case "POST /api/preset/save": {
				if (refuseWhileStreaming()) return true;
				const rawBody = await readBody(req).catch(() => "");
				const body = JSON.parse(rawBody.trim() || "{}") as {
					preset?: unknown;
					samplers?: Record<string, number>;
					blocks?: Array<{
						id: string;
						enabled?: boolean;
						name?: string;
						content?: string;
						channel?: "system" | "postHistory";
					}>;
				};
				const config = loadConfig(host.cwd);
				if (!config.preset) throw new Error("当前未配置预设文件");
				const filePath = resolvePath(host.cwd, config.preset);
				let next: RpPreset;
				if (body.preset !== undefined) {
					next = normalizeRpPreset(body.preset);
				} else if (body.blocks || body.samplers) {
					const base = loadEffectivePreset(host.cwd).preset ?? loadDiskPreset(host.cwd)?.preset;
					if (!base) throw new Error(`预设文件不存在：${config.preset}`);
					next = mergePresetPatches(base, body);
				} else {
					const eff = loadEffectivePreset(host.cwd).preset;
					if (!eff) throw new Error(`预设文件不存在：${config.preset}`);
					next = eff;
				}
				writeJsonWithBackup(filePath, next);
				clearPresetOverride(host.cwd);
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true, dirty: false, saved: true, path: config.preset });
				return true;
			}
			/** 丢弃未保存草稿，从磁盘重载 */
			case "POST /api/preset/revert": {
				if (refuseWhileStreaming()) return true;
				clearPresetOverride(host.cwd);
				await host.softRefreshConfig();
				sendJson(res, 200, { ok: true, dirty: false });
				return true;
			}
			case "POST /api/preset/convert": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { name?: string; json?: Record<string, unknown> };
				if (!body.json || typeof body.json !== "object") throw new Error("缺少 ST 预设 JSON");
				const { preset, report } = convertStPreset(body.json, (body.name ?? "").trim() || "imported-preset");
				const outPath = join(host.cwd, "drawdream-preset.json");
				writeJsonWithBackup(outPath, preset);
				const config = loadConfig(host.cwd);
				if (config.preset !== "drawdream-preset.json") {
					writeJsonWithBackup(configPath(host.cwd), { ...config, preset: "drawdream-preset.json" });
				}
				await host.softRefreshConfig();
				sendJson(res, 200, { report, blockCount: preset.blocks.length, samplers: preset.samplers });
				return true;
			}

			// ---- 导入 ST 聊天记录 ----
			default:
				return false;
	}
}
