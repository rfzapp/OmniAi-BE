import OpenAI from "openai";
import { env } from "../../../config/env";
import { ApiError } from "../../../utils/ApiError";
import type { AIProvider, ProviderChatMessage } from "./provider.types";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

function getKimiClient(apiKeyOverride?: string): OpenAI {
  const apiKey = apiKeyOverride ?? env.KIMI_API_KEY;
  if (!apiKey) throw new Error("KIMI_API_KEY is not configured.");
  return new OpenAI({ apiKey, baseURL: "https://api.moonshot.ai/v1" });
}

export const kimiProvider: AIProvider = {
  async generateReply(model, messages, apiKeyOverride) {
    try {
      const client = getKimiClient(apiKeyOverride);
      const completion = await client.chat.completions.create({
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content
            : m.content.filter((p) => p.type === "text").map((p) => (p as any).text).join("\n"),
        })) as ChatCompletionMessageParam[],
      });
      const text = completion.choices[0]?.message?.content;
      if (!text) throw ApiError.internal("Kimi returned an empty response");
      return text;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof OpenAI.APIError) {
        if (err.status === 401) throw ApiError.internal("Kimi rejected the configured API key");
        if (err.status === 429) throw new ApiError(429, "Kimi rate limit exceeded, please try again later");
        throw new ApiError(err.status ?? 502, err.message || "Kimi request failed");
      }
      throw ApiError.internal("Failed to reach Kimi");
    }
  },

  async *generateStream(model, messages, apiKeyOverride) {
    const client = getKimiClient(apiKeyOverride);
    const stream = await client.chat.completions.create({
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content
          : m.content.filter((p) => p.type === "text").map((p) => (p as any).text).join("\n"),
      })) as ChatCompletionMessageParam[],
      stream: true,
    });
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content;
      if (token) yield token;
    }
  },
};
