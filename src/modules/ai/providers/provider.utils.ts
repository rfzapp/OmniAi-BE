import OpenAI from "openai";
import { ApiError } from "../../../utils/ApiError";
import type { ProviderChatMessage } from "./provider.types";

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
