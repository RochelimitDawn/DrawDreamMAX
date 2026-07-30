/**
 * 技能库 路由。
 */

import {
	existsSync,
	readFileSync,
	unlinkSync,
} from "node:fs";
import {
	join,
} from "node:path";
import {
	listSkills,
	saveSkill,
} from "../../../src/skills.ts";
import {
	readBody,
	sendJson,
} from "../http.ts";
import type { RouteCtx } from "./context.ts";

export async function handleSkillsRoutes(ctx: RouteCtx): Promise<boolean> {
	const { req, res, host, query } = ctx;
	const refuseWhileStreaming = ctx.refuseWhileStreaming;

	switch (ctx.route) {
			case "GET /api/skills": {
				sendJson(res, 200, {
					skills: listSkills(host.cwd).map((s) => ({
						name: s.name,
						description: s.description,
						file: s.file,
						disableModelInvocation: s.disableModelInvocation === true,
					})),
				});
				return true;
			}
			case "GET /api/skills/content": {
				const file = query.get("file") ?? "";
				const base = file.startsWith(".drawdream-skills/") ? file.slice(".drawdream-skills/".length) : "";
				if (!base || base.includes("/") || base.includes("\\") || base.includes("..") || !base.endsWith(".md")) {
					throw new Error("非法路径");
				}
				const abs = join(host.cwd, ".drawdream-skills", base);
				if (!existsSync(abs)) throw new Error("技能文件不存在");
				sendJson(res, 200, { content: readFileSync(abs, "utf8") });
				return true;
			}
			// 技能写入/更新（PLAN-PANELS §2.6）：同名覆盖=更新，frontmatter 由 saveSkill 统一生成
			case "POST /api/skills": {
				const body = JSON.parse(await readBody(req)) as {
					name?: string;
					description?: string;
					content?: string;
					disableModelInvocation?: boolean;
				};
				const name = (body.name ?? "").trim();
				const content = (body.content ?? "").trim();
				if (!name) throw new Error("缺少技能名");
				if (!content) throw new Error("技能内容为空");
				const r = saveSkill(host.cwd, {
					name,
					description: (body.description ?? "").trim(),
					content,
					disableModelInvocation: body.disableModelInvocation === true,
				});
				sendJson(res, 200, { ok: true, ...r, note: "system prompt 里的技能索引在下次会话重载时更新" });
				return true;
			}
			case "DELETE /api/skills": {
				const file = query.get("file") ?? "";
				const base = file.startsWith(".drawdream-skills/") ? file.slice(".drawdream-skills/".length) : "";
				if (!base || base.includes("/") || base.includes("\\") || base.includes("..") || !base.endsWith(".md")) {
					throw new Error("非法路径");
				}
				const abs = join(host.cwd, ".drawdream-skills", base);
				if (!existsSync(abs)) throw new Error("技能文件不存在");
				unlinkSync(abs);
				sendJson(res, 200, { ok: true });
				return true;
			}

			// ---- MCP 外设：多源发现 + 本对话开关 + 项目手写 + 探测 ----
			default:
				return false;
	}
}
