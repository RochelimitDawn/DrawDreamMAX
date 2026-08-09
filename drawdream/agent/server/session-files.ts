/**
 * 会话文件纯工具：预览/卡绑定/路径比较（user-host 与 REST 会话管理共用逻辑）。
 * 无 pi 依赖；缓存由调用方持有或使用本模块默认缓存。
 */

import { closeSync, openSync, readSync, statSync } from "node:fs";
import { normalize } from "node:path";

import { parseCardFromSessionHead } from "./wire.ts";

/** 读文件尾部若干字节（末条消息预览用；大会话不整读） */
export function readFileTail(path: string, bytes = 65536): string {
	const fd = openSync(path, "r");
	try {
		const size = statSync(path).size;
		const start = Math.max(0, size - bytes);
		const buf = Buffer.alloc(size - start);
		const n = readSync(fd, buf, 0, buf.length, start);
		return buf.toString("utf8", 0, n);
	} finally {
		closeSync(fd);
	}
}

/** 从会话条目提取正文文本（user/assistant 消息；其余条目返回 null） */
export function entryMsgText(entry: unknown): string | null {
	const e = entry as { message?: unknown; role?: unknown; content?: unknown } | null;
	const m = (e?.message ?? e) as { role?: unknown; content?: unknown } | null;
	if (!m || (m.role !== "assistant" && m.role !== "user")) return null;
	if (typeof m.content === "string") return m.content;
	if (Array.isArray(m.content)) {
		const t = m.content
			.map((p) => (p && typeof p === "object" && (p as { type?: unknown }).type === "text" ? String((p as { text?: unknown }).text ?? "") : ""))
			.filter(Boolean)
			.join(" ");
		return t || null;
	}
	return null;
}

/** 会话路径是否为同一文件（Windows 路径大小写/斜杠差异时 path=== 会失败） */
export function isSameSessionPath(a: string | undefined, b: string | undefined): boolean {
	if (!a || !b) return false;
	const n = (p: string) => normalize(p).replace(/\\/g, "/").toLowerCase();
	return n(a) === n(b);
}

export type SessionCardInfo = { card: string; name: string };

/** 会话-卡绑定缓存 */
export type CardCache = Map<string, { mtimeMs: number; info: SessionCardInfo | null }>;

/** 读文件头/尾解析 rp-card（mtime 缓存） */
export function readSessionCard(path: string, mtimeMs: number, cache: CardCache): SessionCardInfo | null {
	const cached = cache.get(path);
	if (cached && cached.mtimeMs === mtimeMs) return cached.info;
	let info: SessionCardInfo | null = null;
	try {
		const size = statSync(path).size;
		const fd = openSync(path, "r");
		try {
			const headLen = Math.min(size, 65536);
			const headBuf = Buffer.alloc(headLen);
			readSync(fd, headBuf, 0, headLen, 0);
			let text = headBuf.toString("utf8");
			if (size > 65536) {
				const tailLen = Math.min(size - headLen, 65536);
				const tailBuf = Buffer.alloc(tailLen);
				readSync(fd, tailBuf, 0, tailLen, size - tailLen);
				text += "\n" + tailBuf.toString("utf8");
			}
			info = parseCardFromSessionHead(text);
		} finally {
			closeSync(fd);
		}
	} catch {
		info = null;
	}
	cache.set(path, { mtimeMs, info });
	return info;
}

/** 预览缓存 */
export type PreviewCache = Map<string, { mtimeMs: number; text: string }>;

/** 末条消息预览：尾部扫描最后一条 user/assistant 正文 */
export function readSessionPreview(path: string, mtimeMs: number, cache: PreviewCache): string {
	const cached = cache.get(path);
	if (cached && cached.mtimeMs === mtimeMs) return cached.text;
	let text = "";
	try {
		const lines = readFileTail(path).split(/\r?\n/);
		for (let i = lines.length - 1; i >= 0; i--) {
			const line = lines[i].trim();
			if (!line) continue;
			try {
				const t = entryMsgText(JSON.parse(line));
				if (t?.trim()) {
					text = t.replace(/\s+/g, " ").trim().slice(0, 80);
					break;
				}
			} catch {
				// 尾部截断的半行：跳过
			}
		}
	} catch {
		// 文件读取失败：无预览
	}
	cache.set(path, { mtimeMs, text });
	return text;
}
