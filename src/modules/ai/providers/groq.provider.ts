import OpenAI from "openai";
import { env } from "../../../config/env";
import { ApiError } from "../../../utils/ApiError";
import type { AIProvider, ProviderChatMessage } from "./provider.types";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

function getGroqClient(apiKeyOverride?: string): OpenAI {
  const apiKey = apiKeyOverride ?? env.XAI_API_KEY;
  if (!apiKey) throw new Error("XAI_API_KEY is not configured. Add it to your environment variables.");
  return new OpenAI({
    apiKey,
    baseURL: "https://api.x.ai/v1",
  });
}

export const groqProvider: AIProvider = {
  async generateReply(model, messages, apiKeyOverride) {
    try {
      const client = getGroqClient(apiKeyOverride);
      const msgs = messages
        .filter((m) => m.role !== "system" || typeof m.content === "string")
        .map((m) => ({
          role: m.role,
          content: typeof m.content === "string"
            ? m.content
            : m.content.filter((p) => p.type === "text").map((p) => (p as any).text).join("\n"),
        })) as ChatCompletionMessageParam[];

      const completion = await client.chat.completions.create({ model, messages: msgs });
      const text = completion.choices[0]?.message?.content;
      if (!text) throw ApiError.internal("Groq returned an empty response");
      return text;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof OpenAI.APIError) {
        if (err.status === 401) throw ApiError.internal("Groq rejected the configured API key");
        if (err.status === 429) throw new ApiError(429, "Groq rate limit exceeded, please try again later");
        if (err.status === 400) throw ApiError.badRequest(err.message || "Invalid request sent to Groq");
        throw new ApiError(err.status ?? 502, err.message || "Groq request failed");
      }
      throw ApiError.internal("Failed to reach Groq");
    }
  },

  async *generateStream(model, messages, apiKeyOverride) {
    const client = getGroqClient(apiKeyOverride);
    const msgs = messages
      .filter((m) => m.role !== "system" || typeof m.content === "string")
      .map((m) => ({
        role: m.role,
        content: typeof m.content === "string"
          ? m.content
          : m.content.filter((p) => p.type === "text").map((p) => (p as any).text).join("\n"),
      })) as ChatCompletionMessageParam[];

    const stream = await client.chat.completions.create({ model, messages: msgs, stream: true });
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content;
      if (token) yield token;
    }
  },
};
