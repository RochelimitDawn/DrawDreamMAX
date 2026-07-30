import anthropic from '@lobehub/icons-static-svg/icons/anthropic.svg?url'
import azure from '@lobehub/icons-static-svg/icons/azure-color.svg?url'
import azureai from '@lobehub/icons-static-svg/icons/azureai-color.svg?url'
import baichuan from '@lobehub/icons-static-svg/icons/baichuan-color.svg?url'
import bedrock from '@lobehub/icons-static-svg/icons/bedrock-color.svg?url'
import claude from '@lobehub/icons-static-svg/icons/claude-color.svg?url'
import cloudflare from '@lobehub/icons-static-svg/icons/cloudflare-color.svg?url'
import cohere from '@lobehub/icons-static-svg/icons/cohere-color.svg?url'
import deepseek from '@lobehub/icons-static-svg/icons/deepseek-color.svg?url'
import doubao from '@lobehub/icons-static-svg/icons/doubao-color.svg?url'
import fireworks from '@lobehub/icons-static-svg/icons/fireworks-color.svg?url'
import gemini from '@lobehub/icons-static-svg/icons/gemini-color.svg?url'
import google from '@lobehub/icons-static-svg/icons/google-color.svg?url'
import grok from '@lobehub/icons-static-svg/icons/grok.svg?url'
import groq from '@lobehub/icons-static-svg/icons/groq.svg?url'
import huggingface from '@lobehub/icons-static-svg/icons/huggingface-color.svg?url'
import hunyuan from '@lobehub/icons-static-svg/icons/hunyuan-color.svg?url'
/** Proma moonshot 官方风彩色标（PNG，兼容浅/深底） */
const kimi = '/brand/kimi.png'
import meta from '@lobehub/icons-static-svg/icons/meta-color.svg?url'
import mistral from '@lobehub/icons-static-svg/icons/mistral-color.svg?url'
import aihubmix from '@lobehub/icons-static-svg/icons/aihubmix-color.svg?url'
import ollama from '@lobehub/icons-static-svg/icons/ollama.svg?url'
/** DrawDream 自有标识，用于中转/自定义渠道 */
const relayChannel = '/brand/logo-mark.svg'
import openai from '@lobehub/icons-static-svg/icons/openai.svg?url'
import openrouter from '@lobehub/icons-static-svg/icons/openrouter-color.svg?url'
import perplexity from '@lobehub/icons-static-svg/icons/perplexity-color.svg?url'
import qwen from '@lobehub/icons-static-svg/icons/qwen-color.svg?url'
import siliconcloud from '@lobehub/icons-static-svg/icons/siliconcloud-color.svg?url'
import together from '@lobehub/icons-static-svg/icons/together-color.svg?url'
import volcengine from '@lobehub/icons-static-svg/icons/volcengine-color.svg?url'
import yi from '@lobehub/icons-static-svg/icons/yi-color.svg?url'
import zhipu from '@lobehub/icons-static-svg/icons/zhipu-color.svg?url'
import './ProviderIcon.css'

/**
 * 模型名优先匹配（中转渠道上模型 id 才是真实品牌）。
 * Grok = xAI 模型；Groq = api.groq.com 推理云。二者字母差一个，必须严格区分。
 */
const MODEL_ICON_MAP: Array<{ test: RegExp; src: string }> = [
  { test: /deepseek/i, src: deepseek },
  { test: /claude|anthropic/i, src: claude },
  { test: /gemini/i, src: gemini },
  // 仅匹配 grok / x-ai 路径，绝不匹配 groq
  { test: /(?:^|[^a-z0-9])grok(?:[^a-z0-9]|$)|grok-|[\/.]x-?ai[\/.]/i, src: grok },
  { test: /\bgpt-?oss\b|\bgpt-?[45]\b|\bo[134]\b|chatgpt|openai/i, src: openai },
  { test: /qwen|通义|dashscope/i, src: qwen },
  { test: /glm|智谱|zhipu|chatglm/i, src: zhipu },
  { test: /kimi|moonshot/i, src: kimi },
  { test: /doubao|seed-|字节/i, src: doubao },
  { test: /minimax|abab/i, src: '/brand/minimax.png' },
  { test: /xiaomi|mimo/i, src: '/brand/xiaomi.png' },
  { test: /mistral|mixtral|codestral|pixtral/i, src: mistral },
  { test: /llama|meta-llama/i, src: meta },
  { test: /\byi-|\b01-ai\b|零一/i, src: yi },
  { test: /hunyuan|tencent/i, src: hunyuan },
  { test: /baichuan/i, src: baichuan },
  { test: /command-?r|cohere/i, src: cohere },
  { test: /perplexity|sonar/i, src: perplexity },
]

/** 渠道名 / baseUrl 匹配（baseUrl 优先在 resolve 中单独处理） */
const PROVIDER_ICON_MAP: Array<{ test: RegExp; src: string }> = [
  { test: /deepseek/i, src: deepseek },
  { test: /openai|chatgpt/i, src: openai },
  { test: /claude|anthropic/i, src: claude },
  { test: /gemini|google/i, src: gemini },
  { test: /qwen|dashscope|aliyun|通义/i, src: qwen },
  { test: /zhipu|智谱/i, src: zhipu },
  // 渠道列表无 modelId 时也要用彩色 Kimi 标，避免 monochrome currentColor 在 <img> 下不可见
  { test: /moonshot|kimi/i, src: kimi },
  { test: /doubao|volc|字节|火山|volcengine|ark-?coding/i, src: doubao },
  { test: /minimax/i, src: '/brand/minimax.png' },
  { test: /xiaomi|mimo/i, src: '/brand/xiaomi.png' },
  { test: /mistral/i, src: mistral },
  // Groq 云：仅 groq 字面与 groq.com（禁止匹配 grok）
  { test: /(?:^|[^a-z0-9])groq(?:[^a-z0-9]|$)|api\.groq\.com/i, src: groq },
  // xAI Grok：渠道名 xai/grok 与 x.ai 域名
  { test: /(?:^|[^a-z0-9])grok(?:[^a-z0-9]|$)|(?:^|[^a-z0-9])xai(?:[^a-z0-9]|$)|(?:^|[^a-z0-9])x-ai(?:[^a-z0-9]|$)|api\.x\.ai|(?:^|\/\/)x\.ai\//i, src: grok },
  { test: /ollama/i, src: ollama },
  { test: /openrouter/i, src: openrouter },
  { test: /silicon/i, src: siliconcloud },
  { test: /together/i, src: together },
  { test: /perplexity/i, src: perplexity },
  { test: /fireworks/i, src: fireworks },
  { test: /hugging|hf\b/i, src: huggingface },
  { test: /azure.?ai|azureai/i, src: azureai },
  { test: /azure/i, src: azure },
  { test: /bedrock|aws/i, src: bedrock },
  { test: /cohere/i, src: cohere },
  { test: /baichuan/i, src: baichuan },
  { test: /hunyuan|tencent/i, src: hunyuan },
  { test: /meta|llama/i, src: meta },
  { test: /cloudflare/i, src: cloudflare },
  { test: /volcengine/i, src: volcengine },
  { test: /google/i, src: google },
  { test: /anthropic/i, src: anthropic },
  { test: /\byi\b|01\.ai/i, src: yi },
  { test: /aihubmix/i, src: aihubmix },
  // 通用中转 / 自建网关
  { test: /newapi|oneapi|one-api|api2d|closeai|fastgpt|青风|qingfeng|celestiai|中转|custom|proxy|relay|gateway|litellm|vllm|lmstudio|localai/i, src: relayChannel },
]

const RELAY_TEST =
  /custom|third[ -]?party|relay|gateway|中转|第三方|自定义|青风|qingfeng|oneapi|newapi|api2d|closeai|aihubmix|fastgpt|litellm|vllm|lmstudio|localai|celestiai/i

const OFFICIAL_ENDPOINT =
  /openai\.com|anthropic\.com|api\.deepseek\.com|googleapis\.com|openrouter\.ai|siliconflow\.cn|moonshot\.(cn|ai)|api\.x\.ai|groq\.com|dashscope\.aliyuncs\.com|bigmodel\.cn|volces\.com|minimaxi\.com|ollama|mistral\.ai|perplexity\.ai|fireworks\.ai|huggingface\.co|azure\.com|amazonaws\.com|cloudflare\.com|cohere\.com/i

function matchMap(key: string, map: Array<{ test: RegExp; src: string }>): string | null {
  for (const row of map) {
    if (row.test.test(key)) return row.src
  }
  return null
}

/** 按「API 域名 → 模型 id → 渠道名」顺序解析图标，避免 Grok/Groq 互伤 */
export function resolveProviderIcon(name: string, baseUrl = '', modelId = ''): string | null {
  const url = (baseUrl || '').toLowerCase()
  // 中转/自建网关始终使用 DrawDream 标识，模型 ID 不参与覆盖。
  if (isRelayProvider(name, baseUrl) || (baseUrl.trim() && !OFFICIAL_ENDPOINT.test(url) && !matchMap(name, PROVIDER_ICON_MAP))) {
    return relayChannel
  }
  // 1) 域名最可靠
  if (/api\.x\.ai|(?:^|\/\/)x\.ai(?:\/|$)/i.test(url)) return grok
  if (/api\.groq\.com|groq\.com/i.test(url)) return groq
  if (/moonshot\.(cn|ai)|api\.moonshot/i.test(url)) return kimi

  // 2) 仅用模型 id 匹配品牌（不要混入渠道名，防止 groq 渠道 + grok 模型时误判）
  const mid = (modelId || '').trim()
  if (mid) {
    // 模型 id 明确是 grok / x-ai 路径 → Grok
    if (/(?:^|[^a-z0-9])grok(?:[^a-z0-9]|$)|grok-|[\/.]x-?ai[\/.]/i.test(mid)) return grok
    // 绝不要把 groq 模型 id 当成 grok
    const fromModel = matchMap(mid, MODEL_ICON_MAP)
    if (fromModel) return fromModel
  }

  // 3) 渠道名（xai / grok / groq）
  const n = (name || '').trim()
  if (n) {
    if (/(?:^|[^a-z0-9])groq(?:[^a-z0-9]|$)/i.test(n)) return groq
    if (/(?:^|[^a-z0-9])grok(?:[^a-z0-9]|$)|(?:^|[^a-z0-9])xai(?:[^a-z0-9]|$)|(?:^|[^a-z0-9])x-ai(?:[^a-z0-9]|$)/i.test(n)) {
      return grok
    }
    return matchMap(n, PROVIDER_ICON_MAP)
  }
  if (baseUrl.trim()) return relayChannel
  return null
}

export function isRelayProvider(name: string, baseUrl = ''): boolean {
  return RELAY_TEST.test(`${name} ${baseUrl}`)
}

interface ProviderIconProps {
  name: string
  baseUrl?: string
  /** 具体模型 id/名称，优先用于匹配品牌图标（如 grok-4、claude-3.5） */
  model?: string
  size?: number
  className?: string
}

export function ProviderIcon({
  name,
  baseUrl = '',
  model = '',
  size = 20,
  className = '',
}: ProviderIconProps) {
  const src = resolveProviderIcon(name, baseUrl, model)
  if (src) {
    // lobe 彩色图标 / 自托管 brand（含 kimi / 中转 png）保持原色，暗色下不 invert
    const isColor = /color|\/brand\/|\.png|\.webp/i.test(src)
    return (
      <img
        className={`provider-icon ${isColor ? 'is-color' : ''} ${className}`.trim()}
        src={src}
        alt=""
        width={size}
        height={size}
        draggable={false}
      />
    )
  }
  // 提供商图标统一使用 DrawDream 标识；机器人图标仅用于助手角色本身。
  if (isRelayProvider(name, baseUrl)) {
    return (
      <img
        className={`provider-icon is-color ${className}`.trim()}
        src={relayChannel}
        alt=""
        width={size}
        height={size}
        draggable={false}
        title={name || 'Relay'}
      />
    )
  }
  if (baseUrl.trim()) {
    return (
      <img
        className={`provider-icon is-color ${className}`.trim()}
        src={relayChannel}
        alt=""
        width={size}
        height={size}
        draggable={false}
        title={name || 'Provider'}
      />
    )
  }
  return (
    <img
      className={`provider-icon is-color ${className}`.trim()}
      src={relayChannel}
      alt=""
      width={size}
      height={size}
      draggable={false}
      title={name || 'Provider'}
    />
  )
}
