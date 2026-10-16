import OpenAI from "openai";
import { env } from "../../../config/env";
import type { AIProvider, ProviderChatMessage } from "./provider.types";
import { toOpenAICompatMessages, handleOpenAICompatError, normalizeOpenAIUsage } from "./provider.utils";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

function getClient(apiKeyOverride?: string): OpenAI {
  const apiKey = apiKeyOverride ?? env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured. Add it to your environment variables.");
  return new OpenAI({ apiKey, baseURL: "https://api.deepseek.com/v1" });
}

function toMessages(messages: ProviderChatMessage[]): ChatCompletionMessageParam[] {
  return toOpenAICompatMessages(messages) as ChatCompletionMessageParam[];
}

export const deepseekProvider: AIProvider = {
  async generateReply(model, messages, apiKeyOverride) {
    try {
      const completion = await getClient(apiKeyOverride).chat.completions.create({ model, messages: toMessages(messages), max_tokens: 4096 });
      const text = completion.choices[0]?.message?.content;
      if (!text) throw new Error("DeepSeek returned an empty response");
      return { text, usage: normalizeOpenAIUsage(completion.usage) };
    } catch (err) {
      handleOpenAICompatError(err, "DeepSeek");
    }
  },

  async *generateStream(model, messages, apiKeyOverride, signal) {
    yield { type: "start" };
    try {
      const stream = await getClient(apiKeyOverride).chat.completions.create({ model, messages: toMessages(messages), max_tokens: 4096, stream: true, stream_options: { include_usage: true } }, { signal });
      let usage;
      for await (const chunk of stream) {
        if (chunk.usage) usage = normalizeOpenAIUsage(chunk.usage);
        const token = chunk.choices[0]?.delta?.content;
        if (token) yield { type: "token", content: token };
      }
      if (usage) yield { type: "usage", usage };
      yield { type: "done" };
    } catch (err: any) {
      yield { type: "error", content: err?.message || String(err) };
    }
  },
};
