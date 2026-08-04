/**
 * 文本向量化客户端（OpenAI 兼容 /embeddings）。
 * 记忆/世界书双路检索的「向量召回」侧：无可用 embedding 模型时自动降级为纯词法，
 * 不阻断任何功能。向量缓存在进程内 LRU，避免重复请求。
 */

import { loadAgentConfig, type AgentModelEntry } from "./agent-config.ts";

export interface EmbeddingClient {
	readonly provider: string;
	readonly model: string;
	/** 批量向量化；调用方应处理抛错（降级词法） */
	embed(texts: string[]): Promise<number[][]>;
}

/** 进程内 LRU：文本（截断 key）→ 向量 */
const cache = new Map<string, number[]>();
const order: string[] = [];
const MAX_CACHE = 512;
const CACHE_KEY_LEN = 512;

export function cachedEmbedding(text: string): number[] | null {
	return cache.get(text.slice(0, CACHE_KEY_LEN)) ?? null;
}

export function cacheEmbedding(text: string, vec: number[]): void {
	const key = text.slice(0, CACHE_KEY_LEN);
	if (!key || cache.has(key)) return;
	cache.set(key, vec);
	order.push(key);
	if (order.length > MAX_CACHE) {
		const oldest = order.shift();
		if (oldest) cache.delete(oldest);
	}
}

/** 仅当 provider 显式提供 embedding 模型（kind=embedding/embed 或名字含 embed）才返回 */
function pickEmbeddingModel(models: AgentModelEntry[] | undefined): string | null {
	if (!models?.length) return null;
	const kinded = models.find(
		(m) => m.kind === "embedding" || m.kind === "embed" || m.kind === "embeddings",
	);
	if (kinded) return String(kinded.id);
	const named = models.find((m) => /embed/i.test(String(m.id)));
	return named ? String(named.id) : null;
}

/** 从配置渠道表找一个可用 embedding 端点；没有显式 embedding 模型则返回 null（不冒险用 chat 模型） */
export function createEmbeddingClient(cwd: string): EmbeddingClient | null {
	const { config } = loadAgentConfig(cwd);
	const providers = config.providers ?? {};
	for (const [provider, p] of Object.entries(providers)) {
		if (!p || p.api !== "openai-completions") continue;
		const baseUrl = typeof p.baseUrl === "string" ? p.baseUrl.replace(/\/+$/, "") : "";
		if (!baseUrl) continue;
		const key = typeof p.apiKey === "string" ? p.apiKey.trim() : "";
		if (
			!key ||
			key === "placeholder" ||
			key.startsWith("$") ||
			key.startsWith("!") ||
			key.startsWith("env:")
		)
			continue;
		const model = pickEmbeddingModel(p.models);
		if (!model) continue;
		return createClient(provider, baseUrl, model, key);
	}
	return null;
}

function createClient(provider: string, baseUrl: string, model: string, apiKey: string): EmbeddingClient {
	const embedRemote = async (texts: string[]): Promise<number[][]> => {
		const res = await fetch(`${baseUrl}/embeddings`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({ model, input: texts }),
			signal: AbortSignal.timeout(20_000),
		});
		if (!res.ok) throw new Error(`embedding 端点 ${res.status}`);
		const data = (await res.json()) as {
			data?: Array<{ index: number; embedding: number[] }>;
		};
		const out: number[][] = new Array(texts.length);
		for (const item of data.data ?? []) {
			if (item.index != null && Array.isArray(item.embedding) && item.embedding.length) {
				out[item.index] = item.embedding;
			}
		}
		if (out.some((v) => !v)) throw new Error("embedding 返回不完整");
		return out;
	};

	return {
		provider,
		model,
		async embed(texts: string[]) {
			const out: number[][] = new Array(texts.length);
			const miss: string[] = [];
			const missIdx: number[] = [];
			texts.forEach((t, i) => {
				const c = cachedEmbedding(t);
				if (c) out[i] = c;
				else {
					miss.push(t);
					missIdx.push(i);
				}
			});
			if (miss.length) {
				const fresh = await embedRemote(miss);
				fresh.forEach((v, k) => {
					const at = missIdx[k];
					out[at] = v;
					cacheEmbedding(miss[k]!, v);
				});
			}
			return out;
		},
	};
}
