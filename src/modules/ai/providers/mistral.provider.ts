import OpenAI from "openai";
import { env } from "../../../config/env";
import { ApiError } from "../../../utils/ApiError";
import type { AIProvider, ProviderChatMessage } from "./provider.types";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

function getMistralClient(apiKeyOverride?: string): OpenAI {
  const apiKey = apiKeyOverride ?? env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("MISTRAL_API_KEY is not configured.");
  return new OpenAI({ apiKey, baseURL: "https://api.mistral.ai/v1" });
}

export const mistralProvider: AIProvider = {
  async generateReply(model, messages, apiKeyOverride) {
    try {
      const client = getMistralClient(apiKeyOverride);
      const completion = await client.chat.completions.create({
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content
            : m.content.filter((p) => p.type === "text").map((p) => (p as any).text).join("\n"),
        })) as ChatCompletionMessageParam[],
      });
      const text = completion.choices[0]?.message?.content;
      if (!text) throw ApiError.internal("Mistral returned an empty response");
      return text;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof OpenAI.APIError) {
        if (err.status === 401) throw ApiError.internal("Mistral rejected the configured API key");
        if (err.status === 429) throw new ApiError(429, "Mistral rate limit exceeded, please try again later");
        throw new ApiError(err.status ?? 502, err.message || "Mistral request failed");
      }
      throw ApiError.internal("Failed to reach Mistral");
    }
  },

  async *generateStream(model, messages, apiKeyOverride) {
    const client = getMistralClient(apiKeyOverride);
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
