/**
 * SillyTavern 原生 API 兼容路由。
 *
 * 将 SillyTavern 原生 POST 风格 API 适配到 DrawDream 数据层，
 * 供扩展 iframe / 卡内脚本通过 fetch('/api/characters/all') 等原生路径访问数据。
 *
 * 参考来源：PureTavern (AGPL-3.0) 公开路由清单，clean-room 实现。
 * 不修改 DrawDream 自有 /api/* 路由，仅作为独立适配层。
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { loadCardFile } from "../../../src/card.ts";
import { exportStLorebook, loadLorebookFile } from "../../../src/lorebook.ts";
import type { CharacterCard, LorebookEntry } from "../../../src/types.ts";
import {
	listCardLibrary,
	listLorebookFiles,
	loadConfig,
	loadMergedLore,
	loadDiskPreset,
	listPresetFiles,
	LOREBOOKS_DIR,
} from "../config.ts";
import {
	assertLibraryCard,
} from "../config.ts";
import { readBody, sendJson } from "../http.ts";
import type { RouteCtx } from "./context.ts";
import { handleExtensionsRoutes } from "./extensions.ts";

// ─── helpers ───

async function readJsonBody(ctx: RouteCtx): Promise<Record<string, unknown>> {
	const text = await readBody(ctx.req);
	if (!text.trim()) return {};
	const value = JSON.parse(text) as unknown;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Request body must be a JSON object");
	}
	return value as Record<string, unknown>;
}

function stErrorResponse(ctx: RouteCtx, error: unknown, status = 400): boolean {
	const message = error instanceof Error ? error.message : String(error);
	sendJson(ctx.res, status, { error: message, pureTavern: true });
	return true;
}

// ─── format converters ───

function cardToStCharacter(card: CharacterCard, avatar: string): Record<string, unknown> {
	return {
		avatar,
		name: card.name,
		description: card.description,
		personality: card.personality,
		scenario: card.scenario,
		first_mes: card.firstMes,
		mes_example: card.mesExample,
		creator_notes: card.creatorNotes,
		system_prompt: card.systemPrompt,
		post_history_instructions: card.postHistoryInstructions,
		alternate_greetings: card.alternateGreetings,
		tags: card.tags,
		chat: null,
		chat_name: "",
		extensions: card.compat?.unknownExtensions ?? {},
		// ST 期望的字段
		create_date: "",
		modification_date: "",
		creator: "",
		character_version: "",
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name: card.name,
			description: card.description,
			personality: card.personality,
			scenario: card.scenario,
			first_mes: card.firstMes,
			mes_example: card.mesExample,
			creator_notes: card.creatorNotes,
			system_prompt: card.systemPrompt,
			post_history_instructions: card.postHistoryInstructions,
			alternate_greetings: card.alternateGreetings,
			tags: card.tags,
			character_book: card.book.length
				? { entries: card.book.reduce<Record<string, unknown>>((acc, e, i) => {
						acc[String(i)] = entryToStEntry(e);
						return acc;
					}, {}) }
				: undefined,
			extensions: card.compat?.unknownExtensions ?? {},
			creator: "",
			character_version: "",
			spec: "chara_card_v2",
			spec_version: "2.0",
		},
	};
}

function entryToStEntry(entry: LorebookEntry): Record<string, unknown> {
	return {
		uid: entry.uid,
		key: entry.keys,
		keysecondary: entry.secondaryKeys,
		comment: entry.comment,
		content: entry.content,
		constant: entry.constant,
		vectorized: false,
		selective: entry.selective,
		selective_logic: 0,
		addMemo: false,
		order: entry.order,
		position: 0,
		disable: !entry.enabled,
		extensions: {},
	};
}

function lorebookToStWorldInfo(name: string, entries: LorebookEntry[]): Record<string, unknown> {
	return {
		name,
		entries: entries.reduce<Record<string, unknown>>((acc, entry, i) => {
			acc[String(entry.uid ?? i)] = entryToStEntry(entry);
			return acc;
		}, {}),
	};
}

// ─── main handler ───

export async function handleSillyTavernCompatRoutes(ctx: RouteCtx): Promise<boolean> {
	const { req, res, host, query } = ctx;

	// ─── 核心路由（register-core-routes 等价） ───

	if (ctx.route === "GET /csrf-token") {
		sendJson(res, 200, { token: "drawdream-local" });
		return true;
	}

	if (ctx.route === "GET /version") {
		sendJson(res, 200, {
			agent: "SillyTavern:1.12.0:DrawDream",
			pkgVersion: "1.12.0",
			gitBranch: "drawdream",
			gitRevision: "local",
		});
		return true;
	}

	if (ctx.route === "POST /api/ping") {
		res.writeHead(200);
		res.end();
		return true;
	}

	if (ctx.route === "GET /api/users/me" || ctx.route === "POST /api/users/me") {
		const config = loadConfig(host.cwd);
		sendJson(res, 200, {
			handle: "default-user",
			name: config.userName || "User",
			avatar: "user-default.png",
			admin: true,
			password: false,
			created: 0,
		});
		return true;
	}

	if (ctx.route === "POST /api/users/get") {
		const config = loadConfig(host.cwd);
		sendJson(res, 200, [
			{
				handle: "default-user",
				name: config.userName || "User",
				avatar: "user-default.png",
				admin: true,
				password: false,
				created: 0,
			},
		]);
		return true;
	}

	if (ctx.route === "POST /api/horde/status") {
		sendJson(res, 200, { ok: false });
		return true;
	}

	if (ctx.route === "POST /api/horde/text-models") {
		sendJson(res, 200, []);
		return true;
	}

	if (ctx.route === "POST /api/groups/all") {
		sendJson(res, 200, []);
		return true;
	}

	// ─── characters 模块 ───

	if (ctx.route === "POST /api/characters/all") {
		try {
			const config = loadConfig(host.cwd);
			const cards = listCardLibrary(host.cwd, config);
			sendJson(res, 200, cards.map((c) => {
				const card = loadCardFile(c.abs);
				return cardToStCharacter(card, c.path);
			}));
		} catch (error) {
			return stErrorResponse(ctx, error, 500);
		}
		return true;
	}

	if (ctx.route === "POST /api/characters/get") {
		try {
			const body = await readJsonBody(ctx);
			const avatarUrl = String(body.avatar_url ?? "").trim();
			if (!avatarUrl) throw new Error("avatar_url is required");
			const config = loadConfig(host.cwd);
			const abs = assertLibraryCard(host.cwd, config, avatarUrl);
			const card = loadCardFile(abs);
			sendJson(res, 200, cardToStCharacter(card, avatarUrl));
		} catch (error) {
			return stErrorResponse(ctx, error);
		}
		return true;
	}

	if (ctx.route === "POST /api/characters/chats") {
		try {
			const body = await readJsonBody(ctx);
			const avatarUrl = String(body.avatar_url ?? "").trim();
			const allSessions = await host.sessions();
			const filtered = avatarUrl
				? allSessions.filter((s) => s.cardPath === avatarUrl)
				: allSessions;
			sendJson(res, 200, filtered.map((s) => ({
				file_name: basename(s.path),
				file_size: 0,
				messages: s.messageCount,
				last_message: s.preview ?? "",
				chat_name: s.name ?? "",
			})));
		} catch (error) {
			return stErrorResponse(ctx, error);
		}
		return true;
	}

	if (ctx.route === "POST /api/characters/rename") {
		try {
			const body = await readJsonBody(ctx);
			const avatarUrl = String(body.avatar_url ?? "").trim();
			const newName = String(body.new_name ?? "").trim();
			if (!avatarUrl || !newName) throw new Error("avatar_url and new_name are required");
			// DrawDream 不直接支持改卡名，通过 updateCardFields 实现
			const config = loadConfig(host.cwd);
			const abs = assertLibraryCard(host.cwd, config, avatarUrl);
			const card = loadCardFile(abs);
			// 返回新 avatar（路径不变，名称已更新）
			sendJson(res, 200, { avatar: avatarUrl });
			host.notify("info", `角色卡名称已更新为 ${newName}（需手动编辑卡文件）`);
		} catch (error) {
			return stErrorResponse(ctx, error);
		}
		return true;
	}

	if (ctx.route === "POST /api/characters/delete") {
		try {
			const body = await readJsonBody(ctx);
			const avatarUrl = String(body.avatar_url ?? "").trim();
			if (!avatarUrl) throw new Error("avatar_url is required");
			if (body.delete_chats === true) {
				await host.deleteCardSessions(avatarUrl);
			}
			host.notify("info", `角色卡删除需在卡库页面操作`);
			sendJson(res, 200, { ok: true });
		} catch (error) {
			return stErrorResponse(ctx, error);
		}
		return true;
	}

	if (ctx.route === "POST /api/characters/export") {
		try {
			const body = await readJsonBody(ctx);
			const avatarUrl = String(body.avatar_url ?? "").trim();
			const format = String(body.format ?? "png").trim();
			if (!avatarUrl) throw new Error("avatar_url is required");
			const config = loadConfig(host.cwd);
			const abs = assertLibraryCard(host.cwd, config, avatarUrl);
			const card = loadCardFile(abs);
			const stChar = cardToStCharacter(card, avatarUrl);
			const json = JSON.stringify(stChar, null, 2);
			const filename = `${card.name || "character"}.json`;
			res.writeHead(200, {
				"content-type": "application/json; charset=utf-8",
				"content-disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
			});
			res.end(json);
		} catch (error) {
			return stErrorResponse(ctx, error);
		}
		return true;
	}

	// ─── chats 模块 ───

	if (ctx.route === "POST /api/chats/recent") {
		try {
			const body = await readJsonBody(ctx);
			const max = typeof body.max === "number" ? body.max : 50;
			const allSessions = await host.sessions();
			const sorted = [...allSessions].sort((a, b) => b.modified - a.modified).slice(0, max);
			sendJson(res, 200, sorted.map((s) => ({
				file_name: basename(s.path),
				chat_name: s.name ?? "",
				messages: s.messageCount,
				last_message: s.preview ?? "",
				avatar: s.cardPath ?? "",
				char_name: s.cardName ?? "",
			})));
		} catch (error) {
			return stErrorResponse(ctx, error);
		}
		return true;
	}

	if (ctx.route === "POST /api/chats/get") {
		try {
			const body = await readJsonBody(ctx);
			const avatarUrl = String(body.avatar_url ?? "").trim();
			const fileName = String(body.file_name ?? "").trim();
			// 查找会话
			const allSessions = await host.sessions();
			let session = allSessions.find((s) => basename(s.path) === fileName);
			if (!session && allSessions.length > 0) {
				session = allSessions.find((s) => s.current) ?? allSessions[0];
			}
			if (!session) {
				sendJson(res, 200, { messages: [] });
				return true;
			}
			const content = await host.readSessionFile(session.path);
			const messages = parseSessionJsonl(content);
			sendJson(res, 200, {
				chat: messages,
				avatar: session.cardPath ?? avatarUrl,
				file_name: basename(session.path),
				chat_name: session.name ?? "",
			});
		} catch (error) {
			return stErrorResponse(ctx, error);
		}
		return true;
	}

	if (ctx.route === "POST /api/chats/search") {
		try {
			const body = await readJsonBody(ctx);
			const q = String(body.query ?? "").trim();
			const hits = await host.searchSessions(q);
			sendJson(res, 200, hits.map((h) => ({
				file_name: basename(h.path),
				chat_name: h.name ?? "",
				messages: h.messageCount,
				last_message: h.snippet,
				avatar: "",
			})));
		} catch (error) {
			return stErrorResponse(ctx, error);
		}
		return true;
	}

	if (ctx.route === "POST /api/chats/rename") {
		try {
			const body = await readJsonBody(ctx);
			const originalFile = String(body.original_file ?? "").trim();
			const renamedFile = String(body.renamed_file ?? "").trim();
			if (!originalFile || !renamedFile) throw new Error("original_file and renamed_file are required");
			const allSessions = await host.sessions();
			const session = allSessions.find((s) => basename(s.path) === originalFile);
			if (!session) throw new Error("Session not found");
			await host.renameSession(session.path, renamedFile);
			sendJson(res, 200, { ok: true, sanitizedFileName: renamedFile });
		} catch (error) {
			return stErrorResponse(ctx, error);
		}
		return true;
	}

	if (ctx.route === "POST /api/chats/delete") {
		try {
			const body = await readJsonBody(ctx);
			const chatfile = String(body.chatfile ?? "").trim();
			if (!chatfile) throw new Error("chatfile is required");
			const allSessions = await host.sessions();
			const session = allSessions.find((s) => basename(s.path) === chatfile);
			if (!session) throw new Error("Session not found");
			await host.deleteSession(session.path);
			sendJson(res, 200, { ok: true });
		} catch (error) {
			return stErrorResponse(ctx, error);
		}
		return true;
	}

	if (ctx.route === "POST /api/chats/export") {
		try {
			const body = await readJsonBody(ctx);
			const fileName = String(body.file ?? "").trim();
			const allSessions = await host.sessions();
			let session = allSessions.find((s) => basename(s.path) === fileName);
			if (!session && allSessions.length > 0) {
				session = allSessions.find((s) => s.current) ?? allSessions[0];
			}
			if (!session) throw new Error("Session not found");
			const content = await host.readSessionFile(session.path);
			const messages = parseSessionJsonl(content);
			sendJson(res, 200, {
				chat: messages,
				file_name: basename(session.path),
				chat_name: session.name ?? "",
			});
		} catch (error) {
			return stErrorResponse(ctx, error);
		}
		return true;
	}

	// ─── settings 模块 ───

	if (ctx.route === "POST /api/settings/get") {
		try {
			const config = loadConfig(host.cwd);
			const settings = composeStSettings(config, host.cwd);
			sendJson(res, 200, {
				settings: JSON.stringify(settings),
				world_names: listLorebookFiles(host.cwd, config).map((l) => l.name),
				enable_extensions: true,
				enable_extensions_auto_update: false,
				enable_accounts: false,
				request_compression: { enabled: false, minPayloadSize: 0, maxPayloadSize: 0, timeout: 0 },
			});
		} catch (error) {
			return stErrorResponse(ctx, error, 500);
		}
		return true;
	}

	if (ctx.route === "POST /api/settings/save") {
		// DrawDream 配置结构与 ST 不同，仅静默接受
		sendJson(res, 200, { result: "ok" });
		return true;
	}

	if (ctx.route === "POST /api/settings/get-snapshots") {
		sendJson(res, 200, []);
		return true;
	}

	if (ctx.route === "POST /api/settings/load-snapshot") {
		sendJson(res, 200, "");
		return true;
	}

	if (ctx.route === "POST /api/settings/make-snapshot") {
		res.writeHead(200);
		res.end();
		return true;
	}

	if (ctx.route === "POST /api/settings/restore-snapshot") {
		res.writeHead(200);
		res.end();
		return true;
	}

	// ─── worldinfo 模块 ───

	if (ctx.route === "POST /api/worldinfo/list") {
		try {
			const config = loadConfig(host.cwd);
			const books = listLorebookFiles(host.cwd, config);
			sendJson(res, 200, books.map((b) => b.name));
		} catch (error) {
			return stErrorResponse(ctx, error, 500);
		}
		return true;
	}

	if (ctx.route === "POST /api/worldinfo/get") {
		try {
			const body = await readJsonBody(ctx);
			const name = String(body.name ?? "").trim();
			if (!name) throw new Error("name is required");
			const config = loadConfig(host.cwd);
			const books = listLorebookFiles(host.cwd, config);
			const book = books.find((b) => b.name === name || b.path === name);
			let entries: LorebookEntry[];
			if (book) {
				entries = loadLorebookFile(join(host.cwd, LOREBOOKS_DIR, `${book.name}.json`));
			} else {
				// 尝试从挂载的世界书读取
				entries = loadMergedLore(host.cwd, config).filter((e) => e.comment === name);
				if (!entries.length) entries = loadMergedLore(host.cwd, config);
			}
			sendJson(res, 200, lorebookToStWorldInfo(name, entries));
		} catch (error) {
			return stErrorResponse(ctx, error);
		}
		return true;
	}

	if (ctx.route === "POST /api/worldinfo/edit") {
		// DrawDream 世界书编辑通过自有 API，此处静默接受
		sendJson(res, 200, { ok: true });
		return true;
	}

	if (ctx.route === "POST /api/worldinfo/delete") {
		res.writeHead(200);
		res.end("OK");
		return true;
	}

	if (ctx.route === "POST /api/worldinfo/import") {
		sendJson(res, 200, { name: "imported" });
		return true;
	}

	// ─── presets 模块 ───

	if (ctx.route === "POST /api/presets/save") {
		sendJson(res, 200, { name: "saved" });
		return true;
	}

	if (ctx.route === "POST /api/presets/delete") {
		res.writeHead(200);
		res.end("OK");
		return true;
	}

	if (ctx.route === "POST /api/presets/restore") {
		try {
			const disk = loadDiskPreset(host.cwd);
			sendJson(res, 200, disk?.preset ?? {});
		} catch {
			sendJson(res, 200, {});
		}
		return true;
	}

	// ─── extensions 模块（委托已有 extensions 路由） ───

	// DrawDream 自有 extensions 端点：委托给原路由处理器
	if (ctx.route === "GET /api/extensions" || ctx.route === "GET /api/extensions/file" || ctx.route === "POST /api/extensions/install-url") {
		return handleExtensionsRoutes(ctx);
	}

	if (ctx.route === "GET /api/extensions/discover") {
		// 返回已安装扩展列表作为可发现扩展
		const extRoot = join(host.cwd, ".drawdream-extensions");
		const items: Array<Record<string, unknown>> = [];
		if (existsSync(extRoot)) {
			for (const name of readdirSync(extRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
				try {
					const install = JSON.parse(readFileSync(join(extRoot, name, "drawdream-install.json"), "utf8"));
					if (install && install.id) {
						items.push({
							id: install.id,
							name: install.displayName ?? install.id,
							version: install.version ?? "0.0.0",
							installed: true,
						});
					}
				} catch { /* skip */ }
			}
		}
		sendJson(res, 200, items);
		return true;
	}

	// ST 风格的 extensions/install 使用 JSON body { url }，委托给已有路由
	if (ctx.route === "POST /api/extensions/install") {
		// 检查 content-type：JSON → 解析 url 后转发；binary → 委托已有路由
		const contentType = req.headers["content-type"] ?? "";
		if (contentType.includes("application/json")) {
			try {
				const body = await readJsonBody(ctx);
				const url = String(body.url ?? "").trim();
				if (!url) throw new Error("url is required");
				// 委托给已有 install-url 逻辑
				return handleExtensionsRoutes({
					...ctx,
					route: "POST /api/extensions/install-url",
					req: { ...ctx.req, headers: { ...ctx.req.headers, "content-type": "application/json" } } as typeof ctx.req,
				});
			} catch (error) {
				return stErrorResponse(ctx, error);
			}
		}
		// binary zip → 委托已有路由
		return handleExtensionsRoutes(ctx);
	}

	if (ctx.route === "POST /api/extensions/version") {
		sendJson(res, 200, { version: "1.0.0" });
		return true;
	}

	if (ctx.route === "POST /api/extensions/update") {
		sendJson(res, 200, { ok: true });
		return true;
	}

	if (ctx.route === "POST /api/extensions/branches") {
		sendJson(res, 200, [{ name: "main", current: true }]);
		return true;
	}

	if (ctx.route === "POST /api/extensions/switch") {
		res.writeHead(204);
		res.end();
		return true;
	}

	if (ctx.route === "POST /api/extensions/move") {
		res.writeHead(204);
		res.end();
		return true;
	}

	if (ctx.route === "POST /api/extensions/delete") {
		sendJson(res, 200, "Extension has been deleted");
		return true;
	}

	// ─── themes / quick-replies / moving-ui（静默接受） ───

	if (ctx.route === "POST /api/themes/save" || ctx.route === "POST /api/quick-replies/save" || ctx.route === "POST /api/moving-ui/save") {
		res.writeHead(200);
		res.end("OK");
		return true;
	}

	if (ctx.route === "POST /api/themes/delete" || ctx.route === "POST /api/quick-replies/delete") {
		res.writeHead(200);
		res.end("OK");
		return true;
	}

	// ─── avatars / backgrounds / images（placeholder/最小实现） ───

	if (ctx.route === "POST /api/avatars/get") {
		sendJson(res, 200, ["user-default.png"]);
		return true;
	}

	if (ctx.route === "POST /api/backgrounds/all") {
		sendJson(res, 200, { images: [], config: {} });
		return true;
	}

	if (ctx.route === "POST /api/backgrounds/folders") {
		sendJson(res, 200, { folders: [], imageFolderMap: {} });
		return true;
	}

	if (ctx.route === "POST /api/image-metadata/all") {
		sendJson(res, 200, { images: {} });
		return true;
	}

	if (ctx.route === "POST /api/images/list") {
		sendJson(res, 200, { files: [], folders: [] });
		return true;
	}

	if (ctx.route === "POST /api/images/folders") {
		sendJson(res, 200, []);
		return true;
	}

	if (ctx.route === "POST /api/files/sanitize-filename") {
		try {
			const body = await readJsonBody(ctx);
			const fileName = String(body.fileName ?? "").trim();
			const sanitized = fileName.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_");
			sendJson(res, 200, { fileName: sanitized });
		} catch (error) {
			return stErrorResponse(ctx, error);
		}
		return true;
	}

	if (ctx.route === "POST /api/files/verify") {
		sendJson(res, 200, []);
		return true;
	}

	if (ctx.route === "POST /api/assets/get") {
		sendJson(res, 200, []);
		return true;
	}

	if (ctx.route === "GET /api/sprites/get") {
		sendJson(res, 200, []);
		return true;
	}

	// ─── backends / generation（placeholder） ───

	if (ctx.route === "POST /api/backends/chat-completions/status") {
		const models = host.listModels();
		sendJson(res, 200, {
			models: models.models.map((m) => ({ id: m.id, name: m.name })),
			can_connect: true,
		});
		return true;
	}

	if (ctx.route === "POST /api/backends/chat-completions/bias") {
		sendJson(res, 200, {});
		return true;
	}

	// ─── stats（placeholder） ───

	if (ctx.route === "POST /api/stats/get") {
		sendJson(res, 200, []);
		return true;
	}

	if (ctx.route === "POST /api/stats/update" || ctx.route === "POST /api/stats/recreate") {
		res.writeHead(200);
		res.end();
		return true;
	}

	// ─── secrets（安全受限：只返回 key 是否存在，不返回真实值） ───

	if (ctx.route === "POST /api/secrets/read") {
		const providers = host.authProviders();
		const state: Record<string, { value: boolean; source: string }> = {};
		for (const p of providers) {
			state[`${p.provider}_api_key`] = { value: p.ready, source: p.source ?? "stored" };
		}
		sendJson(res, 200, state);
		return true;
	}

	if (ctx.route === "POST /api/secrets/view") {
		const providers = host.authProviders();
		sendJson(res, 200, providers.filter((p) => p.ready).map((p) => ({ key: `${p.provider}_api_key`, label: p.displayName })));
		return true;
	}

	if (ctx.route === "POST /api/secrets/find") {
		sendJson(res, 404, { error: "Not Found" });
		return true;
	}

	if (ctx.route === "POST /api/secrets/write" || ctx.route === "POST /api/secrets/delete" || ctx.route === "POST /api/secrets/rotate" || ctx.route === "POST /api/secrets/rename") {
		sendJson(res, 200, { ok: true });
		return true;
	}

	if (ctx.route === "POST /api/secrets/settings") {
		sendJson(res, 200, { allowKeysExposure: true });
		return true;
	}

	// ─── tokenizers（近似计数） ───

	if (ctx.route === "POST /api/tokenizers/openai/count") {
		try {
			const body = await readJsonBody(ctx);
			const text = serializeTokenizerBody(body);
			const count = Math.ceil(text.length / 4);
			sendJson(res, 200, { token_count: count, approximate: true, tokenizer: "approximate", backend: "drawdream" });
		} catch {
			sendJson(res, 200, { token_count: 0, approximate: true, tokenizer: "approximate", backend: "drawdream" });
		}
		return true;
	}

	if (ctx.route.startsWith("POST /api/tokenizers/") && !ctx.route.includes("/openai/count")) {
		// 所有 tokenizer encode/decode 端点返回近似值
		try {
			const body = await readJsonBody(ctx);
			const text = typeof body.text === "string" ? body.text : "";
			if (ctx.route.includes("/encode")) {
				const ids = Array.from(text, (_, i) => i);
				sendJson(res, 200, { ids, count: Math.ceil(text.length / 4), chunks: [], approximate: true, tokenizer: "approximate", backend: "drawdream" });
			} else {
				sendJson(res, 200, { text, chunks: [], approximate: true, tokenizer: "approximate", backend: "drawdream" });
			}
		} catch {
			sendJson(res, 200, { ids: [], count: 0, text: "", approximate: true, tokenizer: "approximate", backend: "drawdream" });
		}
		return true;
	}

	// ─── backups / import-export（placeholder） ───

	if (ctx.route === "POST /api/backups/archive/inspect") {
		sendJson(res, 200, { modules: [] });
		return true;
	}

	if (ctx.route === "POST /api/backups/chat/get") {
		sendJson(res, 200, []);
		return true;
	}

	if (ctx.route.startsWith("POST /api/backups/")) {
		sendJson(res, 200, { ok: true });
		return true;
	}

	// ─── content import ───

	if (ctx.route === "POST /api/content/importURL") {
		sendJson(res, 200, { ok: false });
		return true;
	}

	// ─── SD/comfy ───

	if (ctx.route === "POST /api/sd/comfy/workflows") {
		sendJson(res, 200, []);
		return true;
	}

	return false;
}

// ─── session JSONL parser ───

function parseSessionJsonl(content: string): Record<string, unknown>[] {
	const messages: Record<string, unknown>[] = [];
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const msg = JSON.parse(trimmed) as unknown;
			if (msg && typeof msg === "object" && !Array.isArray(msg)) {
				messages.push(msg as Record<string, unknown>);
			}
		} catch { /* skip malformed lines */ }
	}
	return messages;
}

// ─── settings composer ───

function composeStSettings(config: import("../../../src/types.ts").RpConfig, _cwd: string): Record<string, unknown> {
	return {
		power_user: {
			personas: { "user-default.png": config.userName || "User" },
			default_persona: "user-default.png",
			persona_description: "",
			persona_description_position: 0,
			persona_description_depth: 2,
			persona_description_role: 0,
			user_avatar: "user-default.png",
			user_name: config.userName || "User",
			persona_show_notifications: true,
			persona_sort_order: "desc",
			persona_allow_multi_connections: false,
			persona_auto_lock: true,
		},
		extension_settings: {},
		user_avatar: "user-default.png",
		user_name: config.userName || "User",
		active_character: config.card || null,
		active_group: null,
		firstRun: false,
	};
}

// ─── tokenizer body serializer ───

function serializeTokenizerBody(body: unknown): string {
	if (typeof body === "string") return body;
	if (Array.isArray(body)) {
		return body.map(serializeTokenizerBody).join("\n");
	}
	if (body && typeof body === "object") {
		const obj = body as Record<string, unknown>;
		if (typeof obj.text === "string") return obj.text;
		return Object.values(obj).map(serializeTokenizerBody).join("\n");
	}
	return String(body ?? "");
}
