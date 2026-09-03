/**
 * Vision-capable model IDs — these can receive image attachments.
 * Uses the actual API model strings that reach the providers.
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
  // Qwen — only qwen-max supports vision via DashScope compatible-mode.
  // qwen-plus and qwen-turbo are text-only; do NOT add them here.
  "qwen-max",
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
