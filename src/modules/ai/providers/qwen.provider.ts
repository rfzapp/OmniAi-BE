import OpenAI from "openai";
import { env } from "../../../config/env";
import { ApiError } from "../../../utils/ApiError";
import type { AIProvider, ProviderChatMessage } from "./provider.types";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

function getQwenClient(apiKeyOverride?: string): OpenAI {
  const apiKey = apiKeyOverride ?? env.QWEN_API_KEY;
  if (!apiKey) throw new Error("QWEN_API_KEY is not configured.");
  return new OpenAI({ apiKey, baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" });
}

export const qwenProvider: AIProvider = {
  async generateReply(model, messages, apiKeyOverride) {
    try {
      const client = getQwenClient(apiKeyOverride);
      const completion = await client.chat.completions.create({
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content
            : m.content.filter((p) => p.type === "text").map((p) => (p as any).text).join("\n"),
        })) as ChatCompletionMessageParam[],
      });
      const text = completion.choices[0]?.message?.content;
      if (!text) throw ApiError.internal("Qwen returned an empty response");
      return text;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof OpenAI.APIError) {
        if (err.status === 401) throw ApiError.internal("Qwen rejected the configured API key");
        if (err.status === 429) throw new ApiError(429, "Qwen rate limit exceeded, please try again later");
        throw new ApiError(err.status ?? 502, err.message || "Qwen request failed");
      }
      throw ApiError.internal("Failed to reach Qwen");
    }
  },
};
