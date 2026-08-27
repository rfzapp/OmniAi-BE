import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient } from "../../../config/anthropic";
import { ApiError } from "../../../utils/ApiError";
import type { AIProvider, ProviderChatMessage } from "./provider.types";

const MAX_TOKENS = 4096;

function toAnthropicMessages(messages: ProviderChatMessage[]): Anthropic.MessageParam[] {
  // Claude does not support "system" role in the messages array 
  // system messages are handled separately as a top-level param.
  // Also Claude requires alternating user/assistant turns.
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: typeof m.content === "string" ? m.content : m.content
        .filter((p) => p.type === "text")
        .map((p) => (p as { type: "text"; text: string }).text)
        .join("\n"),
    }));
}

export const anthropicProvider: AIProvider = {
  async generateReply(model, messages, apiKeyOverride) {
    try {
      const client = getAnthropicClient(apiKeyOverride);
      const systemMsg = messages.find((m) => m.role === "system");
      const system = systemMsg
        ? typeof systemMsg.content === "string" ? systemMsg.content : undefined
        : undefined;

      const response = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        ...(system ? { system } : {}),
        messages: toAnthropicMessages(messages),
      });

      const block = response.content[0];
      if (!block || block.type !== "text") {
        throw ApiError.internal("Claude returned an empty response");
      }
      return block.text;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof Anthropic.APIError) {
        const status = err.status;
        if (status === 401) throw ApiError.internal("Claude rejected the configured API key");
        if (status === 429) throw new ApiError(429, "Claude rate limit exceeded, please try again later");
        if (status === 400) throw ApiError.badRequest(err.message || "Invalid request sent to Claude");
        if (status === 529) throw new ApiError(503, "Claude is currently overloaded, please try again later");
        throw new ApiError(status ?? 502, err.message || "Claude request failed");
      }
      throw ApiError.internal("Failed to reach Claude");
    }
  },

  async *generateStream(model, messages, apiKeyOverride) {
    const client = getAnthropicClient(apiKeyOverride);
    const systemMsg = messages.find((m) => m.role === "system");
    const system = systemMsg
      ? typeof systemMsg.content === "string" ? systemMsg.content : undefined
      : undefined;

    const stream = await client.messages.stream({
      model,
      max_tokens: MAX_TOKENS,
      ...(system ? { system } : {}),
      messages: toAnthropicMessages(messages),
    });
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }
    }
  },
};
