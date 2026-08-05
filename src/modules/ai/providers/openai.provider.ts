import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { openaiClient } from "../../../config/openai";
import { ApiError } from "../../../utils/ApiError";
import type { AIProvider, ProviderChatMessage } from "./provider.types";

function toOpenAIMessages(messages: ProviderChatMessage[]): ChatCompletionMessageParam[] {
  return messages.map((m) => ({ role: m.role, content: m.content }) as ChatCompletionMessageParam);
}

export const openaiProvider: AIProvider = {
  async generateReply(model, messages) {
    try {
      const completion = await openaiClient.chat.completions.create({
        model,
        messages: toOpenAIMessages(messages),
      });

      const text = completion.choices[0]?.message?.content;
      if (!text) {
        throw ApiError.internal("AI provider returned an empty response");
      }
      return text;
    } catch (err) {
      if (err instanceof ApiError) throw err;

      if (err instanceof OpenAI.APIError) {
        const status = err.status;
        if (status === 401) throw ApiError.internal("AI provider rejected the configured API key");
        if (status === 429) {
          if (err.code === "insufficient_quota") {
            throw new ApiError(429, "AI provider account has no available quota — check your OpenAI plan and billing details");
          }
          throw new ApiError(429, "AI provider rate limit exceeded, please try again later");
        }
        if (status === 400) throw ApiError.badRequest(err.message || "Invalid request sent to AI provider");
        throw new ApiError(status ?? 502, err.message || "AI provider request failed");
      }

      throw ApiError.internal("Failed to reach AI provider");
    }
  },
};
