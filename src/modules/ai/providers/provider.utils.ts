import OpenAI from "openai";
import { ApiError } from "../../../utils/ApiError";
import type { ProviderChatMessage } from "./provider.types";
import type { BillableUsage } from "../../billing/pricing";

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function normalizeOpenAIUsage(usage: any): BillableUsage | undefined {
  if (!usage) return undefined;
  const inputTokens = numeric(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = numeric(usage.completion_tokens ?? usage.output_tokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  const inputDetails = usage.prompt_tokens_details ?? usage.input_tokens_details ?? {};
  const outputDetails = usage.completion_tokens_details ?? usage.output_tokens_details ?? {};
  const cachedInputTokens = numeric(inputDetails.cached_tokens);
  const imageInputTokens = numeric(inputDetails.image_tokens);
  const imageOutputTokens = numeric(outputDetails.image_tokens);
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(imageInputTokens !== undefined ? { imageInputTokens } : {}),
    ...(imageOutputTokens !== undefined ? { imageOutputTokens } : {}),
  };
}

export function normalizeAnthropicUsage(usage: any): BillableUsage | undefined {
  if (!usage) return undefined;
  const cacheCreation = usage.cache_creation ?? {};
  const cacheWrite5mTokens = numeric(cacheCreation.ephemeral_5m_input_tokens);
  const cacheWrite1hTokens = numeric(cacheCreation.ephemeral_1h_input_tokens);
  const cachedInputTokens = numeric(usage.cache_read_input_tokens);
  const uncachedInputTokens = numeric(usage.input_tokens);
  const outputTokens = numeric(usage.output_tokens);
  const inputTokens = (uncachedInputTokens ?? 0) + (cachedInputTokens ?? 0) + (cacheWrite5mTokens ?? 0) + (cacheWrite1hTokens ?? 0);
  if (uncachedInputTokens === undefined && outputTokens === undefined && cachedInputTokens === undefined && cacheWrite5mTokens === undefined && cacheWrite1hTokens === undefined) return undefined;
  return {
    ...((uncachedInputTokens !== undefined || cachedInputTokens !== undefined || cacheWrite5mTokens !== undefined || cacheWrite1hTokens !== undefined) ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(cacheWrite5mTokens !== undefined ? { cacheWrite5mTokens } : {}),
    ...(cacheWrite1hTokens !== undefined ? { cacheWrite1hTokens } : {}),
  };
}

/**
 * Converts a provider message content (string or parts array) to a plain text string.
 * Used by OpenAI-compatible providers that don't support multi-part content natively.
 */
export function toTextContent(content: ProviderChatMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join("\n");
}

/**
 * Converts ProviderChatMessage array to OpenAI-compatible ChatCompletionMessageParam array,
 * preserving both text and image_url content parts for vision-capable models.
 */
export function toOpenAICompatMessages(messages: ProviderChatMessage[]): any[] {
  return messages.map((m) => {
    const content = m.content;
    if (typeof content === "string") {
      return { role: m.role, content };
    }
    const parts = content.map((part) => {
      if (part.type === "text") {
        return { type: "text", text: part.text };
      }
      return {
        type: "image_url",
        image_url: {
          url: part.image_url.url,
          detail: part.image_url.detail,
        },
      };
    });
    return { role: m.role, content: parts };
  });
}

/**
 * Maps OpenAI SDK API errors to structured ApiErrors.
 * Used by all OpenAI-compatible providers (DeepSeek, Groq, Mistral, Kimi, Qwen).
 */
export function handleOpenAICompatError(err: unknown, providerName: string): never {
  if (err instanceof ApiError) throw err;
  if (err instanceof OpenAI.APIError) {
    if (err.status === 401) throw ApiError.internal(`${providerName} rejected the configured API key`);
    if (err.status === 429) throw new ApiError(429, `${providerName} rate limit exceeded, please try again later`);
    if (err.status === 400) throw ApiError.badRequest(err.message || `Invalid request sent to ${providerName}`);
    throw new ApiError(err.status ?? 502, err.message || `${providerName} request failed`);
  }
  throw ApiError.internal(`Failed to reach ${providerName}`);
}
