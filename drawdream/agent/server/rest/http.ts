/**
 * REST HTTP 工具：读 body、写 JSON、路径解析。
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, join } from "node:path";

export const MAX_BODY = 32 * 1024 * 1024; // ST 聊天记录/预设上传上限 32MB
export const MAX_UPLOAD = 64 * 1024 * 1024; // 上传区文件上限 64MB

export function readBodyRaw(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => {
			size += c.length;
			if (size > maxBytes) {
				reject(new Error("请求体过大"));
				req.destroy();
				return;
			}
			chunks.push(c);
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

export function readBody(req: IncomingMessage): Promise<string> {
	return readBodyRaw(req, MAX_BODY).then((b) => b.toString("utf8"));
}

export function sendJson(res: ServerResponse, code: number, obj: unknown): void {
	res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(obj));
}

export const resolvePath = (cwd: string, p: string) => (isAbsolute(p) ? p : join(cwd, p));

