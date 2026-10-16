export const PRICING_TABLE_VERSION = "2026-10-15.1";
export const CREDITS_PER_USD = 10_000;
export const USD_PER_MILLION_TOKENS = 1_000_000;

export type ProviderName = "openai" | "anthropic" | "xai" | "deepseek" | "openrouter" | "qwen" | "mistral" | "moonshot";

export interface BillableUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheWrite5mTokens?: number;
  cacheWrite1hTokens?: number;
  imageInputTokens?: number;
  imageOutputTokens?: number;
  inputImages?: number;
  audioInputTokens?: number;
  audioOutputTokens?: number;
  generatedImages?: number;
  imageQuality?: "low" | "medium" | "high";
  operations?: Record<string, number>;
}

export interface ModelPricing {
  provider: ProviderName;
  inputUsdPerMillionTokens: number | null;
  outputUsdPerMillionTokens: number | null;
  cachedInputUsdPerMillionTokens?: number | null;
  cacheWrite5mUsdPerMillionTokens?: number | null;
  cacheWrite1hUsdPerMillionTokens?: number | null;
  imageInputUsdPerMillionTokens?: number | null;
  imageInputUsdPerImage?: number | null;
  imageOutputUsdPerMillionTokens?: number | null;
  imageOutputUsdPerImage?: number | null;
  audioInputUsdPerMillionTokens?: number | null;
  audioOutputUsdPerMillionTokens?: number | null;
  imageUsdByQuality?: Partial<Record<"low" | "medium" | "high", number>>;
  operationUsd?: Record<string, number>;
  source?: string;
}

export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = Object.freeze({
  "gpt-omni": { provider: "openai", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
  "gpt-5.6-luna": { provider: "openai", inputUsdPerMillionTokens: 0.2, outputUsdPerMillionTokens: 1.2, cachedInputUsdPerMillionTokens: 0.02, source: "https://developers.openai.com/api/docs/pricing" },
  "gpt-5.6-sol": { provider: "openai", inputUsdPerMillionTokens: 4, outputUsdPerMillionTokens: 20, cachedInputUsdPerMillionTokens: 0.4, source: "https://developers.openai.com/api/docs/pricing" },
  "gpt-5.6-terra": { provider: "openai", inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 12, cachedInputUsdPerMillionTokens: 0.2, source: "https://developers.openai.com/api/docs/pricing" },
  "gpt-4.1-mini": { provider: "openai", inputUsdPerMillionTokens: 0.4, outputUsdPerMillionTokens: 1.6, cachedInputUsdPerMillionTokens: 0.1, source: "https://developers.openai.com/api/docs/pricing" },
  "gpt-4o-mini": { provider: "openai", inputUsdPerMillionTokens: 0.15, outputUsdPerMillionTokens: 0.6, cachedInputUsdPerMillionTokens: 0.075, source: "https://developers.openai.com/api/docs/pricing" },
  "gpt-image-2": { provider: "openai", inputUsdPerMillionTokens: 5, outputUsdPerMillionTokens: null, cachedInputUsdPerMillionTokens: 1.25, imageInputUsdPerMillionTokens: 8, imageOutputUsdPerMillionTokens: 30, source: "https://developers.openai.com/api/docs/pricing" },
  "gpt-image-2-low": { provider: "openai", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
  "gpt-image-2-medium": { provider: "openai", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
  "gpt-image-2-high": { provider: "openai", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
  "dall-e-2": { provider: "openai", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
  "dall-e-3": { provider: "openai", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
  "claude-omni": { provider: "anthropic", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
  "claude-haiku-4-5": { provider: "anthropic", inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 5, cachedInputUsdPerMillionTokens: 0.1, cacheWrite5mUsdPerMillionTokens: 1.25, cacheWrite1hUsdPerMillionTokens: 2, source: "https://platform.claude.com/docs/en/about-claude/pricing" },
  "claude-haiku-4-5-20251001": { provider: "anthropic", inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 5, cachedInputUsdPerMillionTokens: 0.1, cacheWrite5mUsdPerMillionTokens: 1.25, cacheWrite1hUsdPerMillionTokens: 2, source: "https://platform.claude.com/docs/en/about-claude/pricing" },
  "claude-sonnet-5": { provider: "anthropic", inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 10, cachedInputUsdPerMillionTokens: 0.2, cacheWrite5mUsdPerMillionTokens: 2.5, cacheWrite1hUsdPerMillionTokens: 4, source: "https://platform.claude.com/docs/en/about-claude/pricing" },
  "claude-opus-5": { provider: "anthropic", inputUsdPerMillionTokens: 5, outputUsdPerMillionTokens: 25, cachedInputUsdPerMillionTokens: 0.5, cacheWrite5mUsdPerMillionTokens: 6.25, cacheWrite1hUsdPerMillionTokens: 10, source: "https://platform.claude.com/docs/en/about-claude/pricing" },
  "claude-fable-5": { provider: "anthropic", inputUsdPerMillionTokens: 10, outputUsdPerMillionTokens: 50, cachedInputUsdPerMillionTokens: 1, cacheWrite5mUsdPerMillionTokens: 12.5, cacheWrite1hUsdPerMillionTokens: 20, source: "https://platform.claude.com/docs/en/about-claude/pricing" },
  "deepseek-omni": { provider: "openrouter", inputUsdPerMillionTokens: 0.32, outputUsdPerMillionTokens: 0.89, source: "https://openrouter.ai/api/v1/models" },
  "deepseek-chat": { provider: "openrouter", inputUsdPerMillionTokens: 0.32, outputUsdPerMillionTokens: 0.89, source: "https://openrouter.ai/api/v1/models" },
  "deepseek-reasoner": { provider: "openrouter", inputUsdPerMillionTokens: 0.7, outputUsdPerMillionTokens: 2.5, source: "https://openrouter.ai/api/v1/models" },
  "grok-omni": { provider: "xai", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
  "grok-3": { provider: "xai", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
  "grok-4": { provider: "xai", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
  "qwen-omni": { provider: "qwen", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
  "qwen-max": { provider: "qwen", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
  "qwen-plus": { provider: "qwen", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
  "qwen-turbo": { provider: "qwen", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
  "qwen-vl-plus": { provider: "qwen", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
  "qwen-vl-max": { provider: "qwen", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
  "qwen-image-3.0": { provider: "qwen", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null, imageInputUsdPerImage: 0.003, imageOutputUsdPerImage: null, imageUsdByQuality: { low: 0.03, high: 0.03 }, source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing" },
  "qwen-image-3.0-pro": { provider: "qwen", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null, imageInputUsdPerImage: 0.003, imageOutputUsdPerImage: null, imageUsdByQuality: { low: 0.04, high: 0.075 }, source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing" },
  "qwen-image-plus": { provider: "qwen", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
  "wan2.7-image": { provider: "qwen", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null, imageOutputUsdPerImage: 0.03, imageUsdByQuality: { low: 0.03, medium: 0.03, high: 0.03 }, source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing" },
  "wan2.7-image-pro": { provider: "qwen", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null, imageOutputUsdPerImage: 0.075, imageUsdByQuality: { low: 0.075, medium: 0.075, high: 0.075 }, source: "https://www.alibabacloud.com/help/en/model-studio/model-pricing" },
  "mistral-omni": { provider: "mistral", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
  "mistral-large-latest": { provider: "mistral", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
  "mistral-small-latest": { provider: "mistral", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
  "kimi-omni": { provider: "moonshot", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
  "kimi-k3": { provider: "moonshot", inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15, cachedInputUsdPerMillionTokens: 0.3, cacheWrite5mUsdPerMillionTokens: 3, cacheWrite1hUsdPerMillionTokens: 6, source: "https://platform.kimi.ai/docs/pricing" },
  "kimi-k2.6": { provider: "moonshot", inputUsdPerMillionTokens: 0.95, outputUsdPerMillionTokens: 4, cachedInputUsdPerMillionTokens: 0.16, source: "https://platform.kimi.ai/docs/pricing" },
  "moonshot-v1-128k": { provider: "moonshot", inputUsdPerMillionTokens: null, outputUsdPerMillionTokens: null },
});

export class MissingPricingError extends Error {
  constructor(readonly modelId: string, readonly missingRates: string[]) {
    super(`Pricing is not configured for ${modelId}: ${missingRates.join(", ")}`);
    this.name = "MissingPricingError";
  }
}

export function getModelPricing(modelId: string): ModelPricing | undefined {
  return MODEL_PRICING[modelId];
}

export function estimateCredits(usage: BillableUsage, pricing: ModelPricing, modelId = "unknown"): number {
  return calculateCredits(usage, pricing, modelId);
}

export function calculateCredits(usage: BillableUsage, pricing: ModelPricing, modelId = "unknown"): number {
  return Math.ceil(calculateProviderCostUsd(usage, pricing, modelId) * CREDITS_PER_USD);
}

export function calculateProviderCostUsd(usage: BillableUsage, pricing: ModelPricing, modelId = "unknown"): number {
  let costUsd = 0;
  const missingRates: string[] = [];
  const addTokenCost = (metric: string, count: number, rate: number | null | undefined) => {
    if (count <= 0) return;
    if (rate == null) {
      missingRates.push(metric);
      return;
    }
    costUsd += (count * rate) / USD_PER_MILLION_TOKENS;
  };

  const inputTokens = usage.inputTokens ?? 0;
  const cachedInputTokens = usage.cachedInputTokens ?? 0;
  const imageInputTokens = usage.imageInputTokens ?? 0;
  const imageOutputTokens = usage.imageOutputTokens ?? 0;
  if (cachedInputTokens + imageInputTokens > inputTokens) missingRates.push("invalid input token breakdown");
  if (imageOutputTokens > (usage.outputTokens ?? 0)) missingRates.push("invalid output token breakdown");
  const cacheWriteTokens = (usage.cacheWrite5mTokens ?? 0) + (usage.cacheWrite1hTokens ?? 0);
  addTokenCost("inputTokens", Math.max(0, inputTokens - cachedInputTokens - cacheWriteTokens - imageInputTokens), pricing.inputUsdPerMillionTokens);
  addTokenCost("cachedInputTokens", cachedInputTokens, pricing.cachedInputUsdPerMillionTokens);
  addTokenCost("imageInputTokens", imageInputTokens, pricing.imageInputUsdPerMillionTokens);
  addTokenCost("outputTokens", Math.max(0, (usage.outputTokens ?? 0) - imageOutputTokens), pricing.outputUsdPerMillionTokens);
  addTokenCost("imageOutputTokens", imageOutputTokens, pricing.imageOutputUsdPerMillionTokens);
  addTokenCost("cacheWrite5mTokens", usage.cacheWrite5mTokens ?? 0, pricing.cacheWrite5mUsdPerMillionTokens);
  addTokenCost("cacheWrite1hTokens", usage.cacheWrite1hTokens ?? 0, pricing.cacheWrite1hUsdPerMillionTokens);
  addTokenCost("audioInputTokens", usage.audioInputTokens ?? 0, pricing.audioInputUsdPerMillionTokens);
  addTokenCost("audioOutputTokens", usage.audioOutputTokens ?? 0, pricing.audioOutputUsdPerMillionTokens);

  const inputImages = usage.inputImages ?? 0;
  if (inputImages > 0) {
    if (pricing.imageInputUsdPerImage == null) missingRates.push("inputImages");
    else costUsd += inputImages * pricing.imageInputUsdPerImage;
  }

  const generatedImages = usage.generatedImages ?? 0;
  if (generatedImages > 0 && imageOutputTokens === 0) {
    if (pricing.imageOutputUsdPerImage != null) {
      costUsd += generatedImages * pricing.imageOutputUsdPerImage;
    } else {
    const imageRate = usage.imageQuality ? pricing.imageUsdByQuality?.[usage.imageQuality] : undefined;
    if (imageRate == null) missingRates.push("generatedImages quality/size rate");
    else costUsd += generatedImages * imageRate;
    }
  }
  for (const [operation, count] of Object.entries(usage.operations ?? {})) {
    const rate = pricing.operationUsd?.[operation];
    if (rate == null) missingRates.push(`operation:${operation}`);
    else costUsd += count * rate;
  }

  if (missingRates.length > 0) throw new MissingPricingError(modelId, missingRates);
  return costUsd;
}