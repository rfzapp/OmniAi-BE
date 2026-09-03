/**
 * Vision-capable model IDs — these can receive image attachments.
 * Uses the actual API model strings that reach the providers.
 *
 * IMPORTANT — Qwen vision models:
 * Only the qwen-vl-* series are true vision-language models on DashScope.
 * qwen-max, qwen-plus, and qwen-turbo are text-only LLMs — they do NOT
 * accept image_url content parts. Sending images to them results in an
 * empty response or an API error. Do NOT add text-only Qwen models here.
 *
 * Confirmed DashScope vision model IDs (OpenAI-compatible endpoint):
 *   qwen-vl-plus  — Qwen-VL-Plus (enhanced vision, high-res image support)
 *   qwen-vl-max   — Qwen-VL-Max  (strongest visual reasoning)
 *   qwen3-vl-plus — Qwen3-VL-Plus (latest generation, spatial/video support)
 */
const VISION_MODELS = new Set([
  // OpenAI
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  // Anthropic Claude — all current models support vision
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
  "claude-sonnet-5",
  "claude-opus-5",
  "claude-fable-5",
  // Grok (xAI)
  "grok-4",
  "grok-3",
  // DeepSeek — V3 supports vision
  "deepseek-chat",
  // Qwen — ONLY the qwen-vl-* series are vision models on DashScope.
  // qwen-max, qwen-plus, qwen-turbo are text-only; they will return empty
  // responses if sent image_url content parts.
  "qwen-vl-plus",
  "qwen-vl-max",
  // Kimi (Moonshot) — vision supported
  "kimi-k3",
  "kimi-k2.6",
  "moonshot-v1-128k",
  // Mistral — vision not reliably supported via OpenAI-compatible endpoint
  // "mistral-large-latest",
]);

export function supportsVision(modelId: string): boolean {
  return VISION_MODELS.has(modelId);
}
