import OpenAI from "openai";
import { env } from "../../../config/env";
import { ApiError } from "../../../utils/ApiError";
import type { AIProvider, ProviderChatMessage } from "./provider.types";
import {
  normalizeOpenAIUsage,
  toOpenAICompatMessages,
} from "./provider.utils";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_TIMEOUT_MS = 30_000;

function assertTextOnly(messages: ProviderChatMessage[]): void {
  if (messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url"))) {
    throw new ApiError(400, "The selected DeepSeek model supports text input only.");
  }
}

function mapOpenRouterError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const errorName = error instanceof Error ? error.name.toLowerCase() : "";
  const causeName = error instanceof OpenAI.APIError && error.cause instanceof Error
    ? error.cause.name.toLowerCase()
    : "";
  if (error instanceof OpenAI.APIUserAbortError
    || errorName.includes("abort")
    || errorName.includes("cancel")
    || causeName.includes("abort")
    || causeName.includes("cancel")) {
    return new ApiError(408, "The OpenRouter request was cancelled.");
  }
  if (error instanceof OpenAI.APIConnectionTimeoutError || errorName.includes("timeout") || causeName.includes("timeout")) {
    return new ApiError(504, "The OpenRouter request timed out.");
  }
  if (error instanceof OpenAI.APIError) {
    if (error.status === 400) return new ApiError(400, "OpenRouter rejected the chat request.");
    if (error.status === 401 || error.status === 403) return new ApiError(502, "OpenRouter rejected the configured API key.");
    if (error.status === 402) return new ApiError(502, "OpenRouter reports that the configured account cannot fulfill this request.");
    if (error.status === 404) return new ApiError(502, "The configured DeepSeek model is unavailable through OpenRouter.");
    if (error.status === 429) return new ApiError(429, "OpenRouter rate limit exceeded. Please try again later.");
    return new ApiError(502, "OpenRouter could not complete the chat request.");
  }
  return new ApiError(502, "Failed to reach OpenRouter.");
}

function toErrorChunk(error: unknown) {
  const mapped = mapOpenRouterError(error);
  return { type: "error" as const, content: mapped.message };
}

export function createOpenRouterProvider(
  apiKeyProvider: () => string | undefined = () => env.OPENROUTER_API_KEY,
  fetchImpl?: typeof fetch,
): AIProvider {
  function getClient(apiKeyOverride?: string): OpenAI {
    const apiKey = apiKeyOverride ?? apiKeyProvider();
    if (!apiKey?.trim()) {
      throw new ApiError(503, "OpenRouter is not configured. Set OPENROUTER_API_KEY in the backend environment.");
    }
    return new OpenAI({
      apiKey,
      baseURL: OPENROUTER_BASE_URL,
      timeout: OPENROUTER_TIMEOUT_MS,
      maxRetries: 0,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
  }

  return {
    async generateReply(model, messages, apiKeyOverride) {
      assertTextOnly(messages);
      try {
        const completion = await getClient(apiKeyOverride).chat.completions.create({
          model,
          messages: toOpenAICompatMessages(messages),
          max_tokens: 4096,
        });
        const text = completion.choices[0]?.message?.content;
        if (typeof text !== "string" || text.length === 0) {
          throw new ApiError(502, "OpenRouter returned an empty or malformed response.");
        }
        return { text, usage: normalizeOpenAIUsage(completion.usage) };
      } catch (error) {
        throw mapOpenRouterError(error);
      }
    },

    async *generateStream(model, messages, apiKeyOverride, signal) {
      yield { type: "start" };
      try {
        assertTextOnly(messages);
        const stream = await getClient(apiKeyOverride).chat.completions.create({
          model,
          messages: toOpenAICompatMessages(messages),
          max_tokens: 4096,
          stream: true,
          stream_options: { include_usage: true },
        }, { signal });
        let usage;
        let receivedText = false;
        for await (const chunk of stream) {
          if (chunk.usage) usage = normalizeOpenAIUsage(chunk.usage);
          const token = chunk.choices[0]?.delta?.content;
          if (typeof token === "string" && token.length > 0) {
            receivedText = true;
            yield { type: "token", content: token };
          }
        }
        if (!receivedText) {
          throw new ApiError(502, "OpenRouter returned an empty or malformed response.");
        }
        if (usage) yield { type: "usage", usage };
        yield { type: "done" };
      } catch (error) {
        yield toErrorChunk(error);
      }
    },
  };
}

export const openRouterProvider = createOpenRouterProvider();
