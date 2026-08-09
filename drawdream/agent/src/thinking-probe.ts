/**
 * 思考档位主动探测（借鉴 frakio-work capability-probe）：
 * 对当前渠道的真实模型端点发送最小 chat 请求，逐个尝试不同 reasoning effort，
 * 按 HTTP 响应分类该档位是否被接受，从而得到「真实可用思考档位」。
 *
 * 与内置目录（thinkingLevelMap 静态数据）的区别：对自定义 / 中转渠道，
 * 内置数据可能为空或不准，主动探测能得到端点真实接受的能力。
 */

export const PROBE_LEVELS = ["off", "low", "medium", "high"] as const;
export type ProbeLevel = (typeof PROBE_LEVELS)[number];

export type ThinkingProbeResult = {
  accepted: string[];
  /** level → 端点接受时实际发送的 effort 值；不接受 → null */
  map: Record<string, string | null>;
  reason: "probe" | "fallback";
  error?: string;
  latencyMs: number;
};

const clean = (v: unknown): string => String(v ?? "").trim();

function classifyStatus(res: Response): "accepted" | "unsupported" | "auth_failed" | "busy" | "unknown" {
  if (res.ok) return "accepted";
  if (res.status === 401 || res.status === 403) return "auth_failed";
  if (res.status === 429 || res.status >= 500) return "busy";
  if (res.status === 400 || res.status === 422 || res.status === 404) return "unsupported";
  return "unknown";
}

/** 按 api 格式把 level 映射为请求体片段 */
function reasoningBody(api: string, level: ProbeLevel): Record<string, unknown> {
  const mapped = level === "off" ? "none" : level;
  switch (api) {
    case "openrouter":
      return { reasoning: { effort: mapped } };
    case "anthropic-messages":
    case "anthropic":
      return level === "off"
        ? { thinking: { type: "disabled" } }
        : { thinking: { type: "enabled", budget_tokens: 1024 } };
    case "deepseek":
      return level === "off"
        ? { extra_body: { thinking: { type: "disabled" } } }
        : { extra_body: { thinking: { type: "enabled" } }, reasoning_effort: mapped };
    case "qwen":
      return { enable_thinking: level !== "off" };
    case "zai":
      return { thinking: { type: level === "off" ? "disabled" : "enabled" } };
    case "google-generative-ai":
      return level === "off" ? {} : { thinkingConfig: { thinkingBudget: 1024 } };
    case "openai-completions":
    case "openai-responses":
    case "azure-openai-responses":
    default:
      return level === "off" ? {} : { reasoning_effort: mapped };
  }
}

function endpointFor(baseUrl: string, api: string): string {
  const root = baseUrl.replace(/\/+$/, "");
  if (api === "anthropic-messages" || api === "anthropic") return `${root}/v1/messages`;
  if (api === "openrouter") return `${root}/chat/completions`;
  if (api === "google-generative-ai") return `${root}/v1beta/models/{model}:generateContent`;
  return `${root}/chat/completions`;
}

export interface ProbeTarget {
  baseUrl: string;
  api: string;
  apiKey: string;
  modelId: string;
}

/**
 * 主动探测模型支持的思考档位。
 * levels：要探测的档位（默认标准四档；若已知模型 map 可传入其键）。
 */
export async function probeThinkingLevels(
  target: ProbeTarget,
  levels: readonly string[] = PROBE_LEVELS,
  timeoutMs = 90_000,
): Promise<ThinkingProbeResult> {
  const startedAt = Date.now();
  const map: Record<string, string | null> = {};
  const accepted: string[] = [];

  for (const level of levels as readonly ProbeLevel[]) {
    if (Date.now() - startedAt >= timeoutMs) break;
    try {
      const body: Record<string, unknown> = {
        model: target.modelId,
        messages: [{ role: "user", content: "Reply OK." }],
        max_tokens: 8,
        ...reasoningBody(target.api, level),
      };
      let url = endpointFor(target.baseUrl, target.api);
      if (url.includes("{model}")) url = url.replace("{model}", encodeURIComponent(target.modelId));

      const attempt = async (): Promise<"accepted" | "unsupported" | "auth_failed" | "busy" | "unknown"> => {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${target.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });
        return classifyStatus(res);
      };

      // 429/5xx 属临时繁忙，重试一次避免把可用档位误判为不支持
      let status = await attempt();
      if (status === "busy") {
        status = await attempt();
      }
      if (status === "accepted") {
        map[level] = level === "off" ? "none" : level;
        accepted.push(level);
      } else if (status === "auth_failed") {
        return {
          accepted: [],
          map: {},
          reason: "fallback",
          error: `鉴权失败（401/403）`,
          latencyMs: Date.now() - startedAt,
        };
      } else {
        map[level] = null;
      }
    } catch (e) {
      map[level] = null;
    }
  }

  return {
    accepted,
    map,
    reason: "probe",
    latencyMs: Date.now() - startedAt,
  };
}

/** 探测失败时的兜底：内置目录知道档位就用内置，否则给标准档位 */
export function fallbackThinkingLevels(model?: {
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
}): string[] {
  if (!model?.reasoning) return ["off"];
  if (model.thinkingLevelMap && Object.keys(model.thinkingLevelMap).length) {
    return Object.entries(model.thinkingLevelMap)
      .filter(([, v]) => v !== null)
      .map(([k]) => k);
  }
  return [...PROBE_LEVELS];
}
