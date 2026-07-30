/**
 * Forge 用 OpenAI 兼容 chat/completions，密钥来自 workspace 的 drawdream.agent.json。
 */

import { loadAgentConfig, resolveEnvApiKey, type AgentProvider } from "../agent-config.ts";

export interface ForgeLlmTarget {
	provider: string;
	model: string;
	baseUrl: string;
	apiKey: string;
	headers: Record<string, string>;
}

export function resolveForgeLlm(
	cwd: string,
	opts?: { model?: string; provider?: string },
): ForgeLlmTarget {
	const { exists, config } = loadAgentConfig(cwd);
	if (!exists) throw new Error("未找到 drawdream.agent.json，请先在设置中配置模型渠道");
	const providerName =
		(typeof opts?.provider === "string" && opts.provider.trim()) ||
		(typeof config.defaultProvider === "string" && config.defaultProvider) ||
		Object.keys(config.providers)[0];
	if (!providerName) throw new Error("未配置任何模型渠道");
	const p: AgentProvider | undefined = config.providers[providerName];
	if (!p) throw new Error(`渠道不存在：${providerName}`);
	const baseUrl = (typeof p.baseUrl === "string" ? p.baseUrl : "").replace(/\/+$/, "");
	if (!baseUrl) throw new Error(`渠道 ${providerName} 缺少 baseUrl`);
	const rawKey = typeof p.apiKey === "string" ? p.apiKey : "";
	const apiKey = resolveEnvApiKey(rawKey);
	if (!apiKey) throw new Error(`渠道 ${providerName} 未配置有效 apiKey（勿使用 placeholder）`);
	const model =
		(typeof opts?.model === "string" && opts.model.trim()) ||
		(typeof config.defaultModel === "string" && config.defaultModel) ||
		p.models?.[0]?.id ||
		"";
	if (!model) throw new Error(`渠道 ${providerName} 未指定模型`);
	const headers: Record<string, string> =
		p.headers && typeof p.headers === "object" && !Array.isArray(p.headers)
			? { ...(p.headers as Record<string, string>) }
			: {};
	return { provider: providerName, model, baseUrl, apiKey, headers };
}

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export async function forgeChat(
	target: ForgeLlmTarget,
	messages: ChatMessage[],
	opts: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {},
): Promise<string> {
	const url = `${target.baseUrl}/chat/completions`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
	try {
		const res = await fetch(url, {
			method: "POST",
			signal: controller.signal,
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${target.apiKey}`,
				...target.headers,
			},
			body: JSON.stringify({
				model: target.model,
				messages,
				temperature: opts.temperature ?? 0.3,
				max_tokens: opts.maxTokens ?? 4096,
			}),
		});
		const text = await res.text();
		let data: unknown;
		try {
			data = JSON.parse(text);
		} catch {
			throw new Error(`LLM 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
		}
		if (!res.ok) {
			const err =
				(data as { error?: { message?: string } })?.error?.message ||
				(data as { error?: string })?.error ||
				text.slice(0, 200);
			throw new Error(`LLM 请求失败（HTTP ${res.status}）：${err}`);
		}
		const content = (data as { choices?: { message?: { content?: string } }[] })?.choices?.[0]
			?.message?.content;
		if (typeof content !== "string" || !content.trim()) {
			throw new Error("LLM 返回空内容");
		}
		return content;
	} finally {
		clearTimeout(timer);
	}
}

/** 从模型输出中抠 JSON 对象/数组 */
export function extractJsonBlock(text: string): unknown {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
	const candidate = fenced ? fenced[1].trim() : text.trim();
	try {
		return JSON.parse(candidate);
	} catch {
		/* fall through */
	}
	const objStart = candidate.indexOf("{");
	const arrStart = candidate.indexOf("[");
	let start = -1;
	if (objStart >= 0 && (arrStart < 0 || objStart < arrStart)) start = objStart;
	else if (arrStart >= 0) start = arrStart;
	if (start < 0) throw new Error("无法从模型输出解析 JSON");
	const open = candidate[start];
	const close = open === "{" ? "}" : "]";
	const end = candidate.lastIndexOf(close);
	if (end <= start) throw new Error("JSON 括号不完整");
	return JSON.parse(candidate.slice(start, end + 1));
}
