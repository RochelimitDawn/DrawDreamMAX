/**
 * 命令/TTS/世界线/上传/面板/状态/导入 路由。
 */

import { execFile } from "node:child_process";
import {
	existsSync,
	lstatSync,
	readdirSync,
	statSync,
	unlinkSync,
} from "node:fs";
import { join } from "node:path";
import {
	RP_COMMANDS,
} from "../../../src/commands.ts";
import {
	formatBytes,
	listMedia,
	listUploads,
	saveUpload,
} from "../../../src/uploads.ts";
import {
	MAX_UPLOAD,
	readBody,
	readBodyRaw,
	sendJson,
} from "../http.ts";
import type { WorldlineView } from "../../../src/worldline.ts";
import type { RouteCtx } from "./context.ts";

export async function handleMiscRoutes(ctx: RouteCtx): Promise<boolean> {
	const { req, res, host, query } = ctx;
	const refuseWhileStreaming = ctx.refuseWhileStreaming;

	if (await handleEnvironmentRoute(ctx)) return true;

	switch (ctx.route) {
			case "GET /api/commands": {
				sendJson(res, 200, { commands: RP_COMMANDS });
				return true;
			}
			// ---- 命令桥（脚本化 / 自动化入口） ----
			case "POST /api/command": {
				const body = JSON.parse(await readBody(req)) as { text?: string };
				const text = (body.text ?? "").trim();
				const m = /^\/(\w+)(?:\s|$)/.exec(text);
				if (!m || !RP_COMMANDS.some((c) => c.name === m[1])) {
					throw new Error(`不是可用命令：${text.slice(0, 40)}（可用：${RP_COMMANDS.map((c) => `/${c.name}`).join(" ")}）`);
				}
				const queued = host.queueCommand(text);
				sendJson(res, 200, { ok: true, queued, note: queued ? "生成中：已排队到本轮结束执行" : "已提交执行" });
				return true;
			}

			// ---- 文生音（气泡配音 / 脚本） ----
			case "POST /api/tts": {
				const body = JSON.parse(await readBody(req)) as { text?: string; caption?: string };
				const text = (body.text ?? "").trim();
				if (!text) throw new Error("缺少 text");
				const r = await host.ttsSpeak(text, body.caption?.trim() || undefined);
				sendJson(res, 200, { ok: true, ...r });
				return true;
			}

			// ---- 世界线（存档时间线） ----
			case "GET /api/worldline": {
				sendJson(res, 200, host.worldlineView() satisfies WorldlineView);
				return true;
			}
			case "POST /api/worldline/delete-save": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { saveId?: string };
				const saveId = (body.saveId ?? "").trim();
				if (!saveId) throw new Error("缺少 saveId");
				host.deleteWorldlineSave(saveId);
				sendJson(res, 200, { ok: true, view: host.worldlineView() });
				return true;
			}
			case "POST /api/worldline/rename": {
				const body = JSON.parse(await readBody(req)) as { worldlineId?: string; name?: string };
				const worldlineId = (body.worldlineId ?? "").trim();
				const name = (body.name ?? "").trim();
				if (!worldlineId || !name) throw new Error("需要 worldlineId 与 name");
				host.renameWorldline(worldlineId, name);
				sendJson(res, 200, { ok: true, view: host.worldlineView() });
				return true;
			}

			// ---- 上传区（附件随消息模型）：原始字节直传，文件名走 query（免 multipart 解析依赖）。
			// 不触碰会话：流式中也允许（agent 下一轮注入的【上传文件】速览自然可见）
			case "POST /api/upload": {
				const rawName = (query.get("name") ?? "").trim();
				if (!rawName) throw new Error("缺少 name（URL 编码的原始文件名）");
				const data = await readBodyRaw(req, MAX_UPLOAD);
				if (data.length === 0) throw new Error("文件内容为空");
				const saved = saveUpload(host.cwd, rawName, data);
				sendJson(res, 200, { ok: true, file: saved.file, bytes: saved.bytes, size: formatBytes(saved.bytes) });
				return true;
			}
			case "GET /api/uploads": {
				const map = (u: { file: string; name: string; bytes: number; mtimeMs: number }) => ({
					file: u.file,
					name: u.name,
					size: formatBytes(u.bytes),
					mtimeMs: u.mtimeMs,
				});
				sendJson(res, 200, {
					/** 我的上传：.drawdream-uploads/ */
					uploads: listUploads(host.cwd).map(map),
					/** 本地图片：.drawdream-media/（AI show_image 等） */
					media: listMedia(host.cwd).map(map),
				});
				return true;
			}
			case "DELETE /api/uploads": {
				const file = query.get("file") ?? "";
				// 只许删 .drawdream-uploads/ 或 .drawdream-media/ 顶层文件
				let base = "";
				let dir = "";
				if (file.startsWith(".drawdream-uploads/")) {
					base = file.slice(".drawdream-uploads/".length);
					dir = ".drawdream-uploads";
				} else if (file.startsWith(".drawdream-media/")) {
					base = file.slice(".drawdream-media/".length);
					dir = ".drawdream-media";
				}
				if (!dir || !base || base.includes("/") || base.includes("\\") || base.includes("..")) {
					throw new Error("非法路径");
				}
				const abs = join(host.cwd, dir, base);
				if (!existsSync(abs)) throw new Error("文件不存在");
				unlinkSync(abs);
				sendJson(res, 200, { ok: true });
				return true;
			}

			// ---- 知识库：面板只读展示 + 挂载状态；建库/挂载/写入经由对话（agent 是入口） ----
			case "POST /api/panels/import": {
				const body = JSON.parse(await readBody(req)) as {
					format?: unknown;
					panels?: unknown;
					name?: unknown;
					kind?: unknown;
					content?: unknown;
				};
				// 宽进：标准 {format:"drawdream-panels",panels:[…]}，也容单面板裸对象 {name,kind,content}
				const list = Array.isArray(body.panels)
					? (body.panels as Array<{ name?: unknown; kind?: unknown; content?: unknown }>)
					: typeof body.name === "string" && typeof body.content === "string"
						? [body]
						: null;
				if (!list || list.length === 0) {
					throw new Error('格式不对：需要 drawdream-panels JSON（{"format":"drawdream-panels","version":1,"panels":[{"name","kind","content"}]}）');
				}
				const result = host.importPanels(list);
				if (result.imported > 0) {
					host.notify("info", `已导入 ${result.imported} 个面板${result.errors.length ? `（${result.errors.length} 个失败）` : ""}`);
				}
				sendJson(res, result.imported > 0 ? 200 : 400, { ok: result.imported > 0, ...result });
				return true;
			}
			// 用户从面板坞删除：同 agent panel_close（归档，出活跃列表；fs.watch + panelsync）
			case "DELETE /api/panels": {
				const name = (query.get("name") ?? "").trim();
				if (!name) throw new Error("缺少 name");
				host.closePanel(name);
				host.notify("info", `已删除面板「${name}」`);
				sendJson(res, 200, { ok: true, name });
				return true;
			}

			// ---- 会话管理（PLAN-PANELS §2.1）：重命名/删除/导出/全文搜索 ----
			case "PUT /api/state": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { patch?: Record<string, unknown> };
				if (!body.patch || typeof body.patch !== "object") throw new Error("缺少 patch");
				const r = host.applyStatePatch(body.patch);
				sendJson(res, 200, r);
				return true;
			}

			// ---- 用户角色 persona（PLAN-PANELS-V2 §2.5）：多身份清单/创建/选择/编辑/删除/按卡锁定 ----
			case "POST /api/import": {
				if (refuseWhileStreaming()) return true;
				const body = JSON.parse(await readBody(req)) as { content?: string; tag?: string };
				if (!body.content?.trim()) throw new Error("聊天记录内容为空");
				const result = await host.importStChat(body.content, (body.tag ?? "").trim() || undefined);
				sendJson(res, 200, { ok: true, ...result });
				return true;
			}

			// ---- Novel Forge（小说 → 卡/书）----
			default:
				return false;
	}
}

// ---------- 环境信息（设置 → 环境分页） ----------

/** 递归统计目录字节数（软链跳过，避免循环） */
function dirBytes(dir: string): number {
	if (!existsSync(dir)) return 0;
	let total = 0;
	const stack = [dir];
	while (stack.length) {
		const cur = stack.pop()!;
		let entries: string[] = [];
		try {
			entries = readdirSync(cur);
		} catch {
			continue;
		}
		for (const name of entries) {
			const p = join(cur, name);
			let st;
			try {
				st = lstatSync(p);
			} catch {
				continue;
			}
			if (st.isDirectory()) stack.push(p);
			else if (st.isFile()) total += st.size;
		}
	}
	return total;
}

/** 探测某个命令是否可用并取版本（短超时，失败即不可用） */
function probeCommand(cmd: string): Promise<{ ok: boolean; version?: string }> {
	return new Promise((resolve) => {
		execFile(cmd, ["--version"], { timeout: 3000 }, (err, stdout) => {
			if (err) {
				resolve({ ok: false });
				return;
			}
			resolve({ ok: true, version: String(stdout ?? "").trim().split("\n")[0] || undefined });
		});
	});
}

export async function handleEnvironmentRoute(ctx: RouteCtx): Promise<boolean> {
	const { res, host, url } = ctx;
	if (ctx.route !== "GET /api/environment") return false;
	const port = Number(process.env.PORT || "7620");

	// 运行时
	const runtimeName = (process.versions as { bun?: string }).bun ? "bun" : "node";
	const runtime = {
		name: runtimeName,
		version: runtimeName === "bun" ? (process.versions as { bun?: string }).bun : process.versions.node,
		pid: process.pid,
		platform: process.platform,
		arch: process.arch,
		uptimeMs: Math.round(process.uptime() * 1000),
	};

	// 目录与磁盘
	const cwd = host.cwd;
	const agentDir = host.agentDir();
	const dataDirs: Record<string, number> = {};
	for (const [key, rel] of [
		["palace", "palace"],
		["summaries", "summaries"],
		["state", "state"],
		["lore", "assets/lore"],
		["cards", "assets/cards"],
	] as const) {
		dataDirs[key] = dirBytes(join(cwd, rel));
	}
	const disk = {
		workspace: dirBytes(cwd),
		...dataDirs,
	};

	// 工具链探测：node 即当前运行时（agent 就跑在其上，恒可用）；
	// 其余工具走 PATH 探测（Android 沙箱未安装 termux 扩展时显示缺失，提示到环境安装）
	const [bun, ffmpeg, python] = await Promise.all([
		probeCommand("bun"),
		probeCommand("ffmpeg"),
		probeCommand("python3"),
	]);
	const toolchain = {
		node: { ok: true, version: process.version },
		bun,
		ffmpeg,
		python,
	};

	sendJson(res, 200, {
		runtime,
		service: { port, cwd, agentDir, streaming: host.isStreaming() },
		disk,
		toolchain,
		_echo: url,
	});
	return true;
}
