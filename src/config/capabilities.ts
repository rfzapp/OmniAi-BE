export interface ModelCapabilities {
  text: boolean;
  imageGeneration: boolean;
  imageEditing: boolean;
  vision: boolean;
}

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  text: true,
  imageGeneration: false,
  imageEditing: false,
  vision: true,
};

const MODEL_CAPABILITY_MATRIX: Record<string, ModelCapabilities> = {
  // OpenAI Models
  "gpt-omni": { text: true, imageGeneration: true, imageEditing: true, vision: true },
  "gpt-5.6-sol": { text: true, imageGeneration: true, imageEditing: true, vision: true },
  "gpt-5.6-terra": { text: true, imageGeneration: true, imageEditing: true, vision: true },
  "gpt-5.6-luna": { text: true, imageGeneration: true, imageEditing: true, vision: true },
  "gpt-4.1-mini": { text: true, imageGeneration: true, imageEditing: true, vision: true },
  "gpt-image-2": { text: false, imageGeneration: true, imageEditing: true, vision: false },
  "dall-e-2": { text: false, imageGeneration: true, imageEditing: true, vision: false },
  "dall-e-3": { text: false, imageGeneration: true, imageEditing: true, vision: false },

  // Anthropic Claude
  "claude-omni": { text: true, imageGeneration: false, imageEditing: false, vision: true },
  "claude-haiku-4-5": { text: true, imageGeneration: false, imageEditing: false, vision: true },
  "claude-haiku-4-5-20251001": { text: true, imageGeneration: false, imageEditing: false, vision: true },
  "claude-sonnet-5": { text: true, imageGeneration: false, imageEditing: false, vision: true },
  "claude-fable-5": { text: true, imageGeneration: false, imageEditing: false, vision: true },
  "claude-opus-5": { text: true, imageGeneration: false, imageEditing: false, vision: true },

  // DeepSeek
  "deepseek-omni": { text: true, imageGeneration: false, imageEditing: false, vision: true },
  "deepseek-chat": { text: true, imageGeneration: false, imageEditing: false, vision: true },
  "deepseek-reasoner": { text: true, imageGeneration: false, imageEditing: false, vision: true },

  // xAI Grok
  "grok-omni": { text: true, imageGeneration: false, imageEditing: false, vision: true },
  "grok-4": { text: true, imageGeneration: false, imageEditing: false, vision: true },
  "grok-3": { text: true, imageGeneration: false, imageEditing: false, vision: true },

  // Alibaba Qwen
  "qwen-omni": { text: true, imageGeneration: true, imageEditing: true, vision: true },
  "qwen-max": { text: true, imageGeneration: true, imageEditing: true, vision: true },
  "qwen-plus": { text: true, imageGeneration: true, imageEditing: true, vision: true },
  "qwen-turbo": { text: true, imageGeneration: true, imageEditing: true, vision: true },
  "qwen-image-3.0": { text: false, imageGeneration: true, imageEditing: true, vision: false },
  "qwen-image-3.0-pro": { text: false, imageGeneration: true, imageEditing: true, vision: false },
  "qwen-image-plus": { text: false, imageGeneration: true, imageEditing: true, vision: false },
  "wan2.7-image": { text: false, imageGeneration: true, imageEditing: true, vision: false },
  "wan2.7-image-pro": { text: false, imageGeneration: true, imageEditing: true, vision: false },

  // Mistral AI
  "mistral-omni": { text: true, imageGeneration: false, imageEditing: false, vision: false },
  "mistral-large-latest": { text: true, imageGeneration: false, imageEditing: false, vision: false },
  "mistral-small-latest": { text: true, imageGeneration: false, imageEditing: false, vision: false },

  // Moonshot Kimi
  "kimi-omni": { text: true, imageGeneration: false, imageEditing: false, vision: true },
  "kimi-k3": { text: true, imageGeneration: false, imageEditing: false, vision: true },
  "kimi-k2.6": { text: true, imageGeneration: false, imageEditing: false, vision: true },
  "moonshot-v1-128k": { text: true, imageGeneration: false, imageEditing: false, vision: true },
};

const MODEL_NAME_MAP: Record<string, string> = {
  "gpt-5.6-luna": "GPT-5.6 Luna",
  "gpt-5.6-sol": "GPT-5.6 Sol",
  "gpt-5.6-terra": "GPT-5.6 Terra",
  "gpt-omni": "GPT",
  "claude-omni": "Claude",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
  "claude-sonnet-5": "Claude Sonnet 5",
  "claude-fable-5": "Claude Fable 5",
  "claude-opus-5": "Claude Opus 5",
  "deepseek-omni": "DeepSeek",
  "deepseek-chat": "DeepSeek V3",
  "deepseek-reasoner": "DeepSeek R1",
  "grok-omni": "Grok",
  "grok-4": "Grok 4.6",
  "grok-3": "Grok 4.3",
  "qwen-omni": "Qwen",
  "qwen-max": "Qwen Max",
  "qwen-plus": "Qwen Plus",
  "qwen-turbo": "Qwen Turbo",
  "qwen-image-plus": "Qwen Image Plus",
  "mistral-omni": "Mistral",
  "mistral-large-latest": "Mistral Large",
  "mistral-small-latest": "Mistral Small",
  "kimi-omni": "Kimi",
  "kimi-k3": "Kimi K3",
  "kimi-k2.6": "Kimi K2.6",
  "moonshot-v1-128k": "Kimi 128K",
};

export function getModelDisplayName(modelId: string): string {
  if (!modelId) return "This model";
  const key = modelId.toLowerCase();
  return MODEL_NAME_MAP[key] || MODEL_NAME_MAP[modelId] || modelId;
}

export function getModelCapabilities(modelId?: string): ModelCapabilities {
  if (!modelId) return DEFAULT_CAPABILITIES;
  const key = modelId.toLowerCase();
  if (MODEL_CAPABILITY_MATRIX[key]) {
    return MODEL_CAPABILITY_MATRIX[key]!;
  }
  if (key.includes("gpt") || key.includes("openai")) {
    return { text: true, imageGeneration: true, imageEditing: true, vision: true };
  }
  return DEFAULT_CAPABILITIES;
}

export function supportsImageGeneration(modelId?: string): boolean {
  return getModelCapabilities(modelId).imageGeneration;
}

export function supportsImageEditing(modelId?: string): boolean {
  return getModelCapabilities(modelId).imageEditing;
}

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
]);

export function supportsVision(modelId: string): boolean {
  return VISION_MODELS.has(modelId);
}
