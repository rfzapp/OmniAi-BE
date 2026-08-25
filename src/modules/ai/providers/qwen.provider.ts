import OpenAI from "openai";
import { env } from "../../../config/env";
import type { AIProvider, ProviderChatMessage } from "./provider.types";
import { toTextContent, handleOpenAICompatError } from "./provider.utils";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

function getClient(apiKeyOverride?: string): OpenAI {
  const apiKey = apiKeyOverride ?? env.QWEN_API_KEY;
  if (!apiKey) throw new Error("QWEN_API_KEY is not configured.");
  return new OpenAI({ apiKey, baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" });
}

function toMessages(messages: ProviderChatMessage[]): ChatCompletionMessageParam[] {
  return messages.map((m) => ({ role: m.role, content: toTextContent(m.content) })) as ChatCompletionMessageParam[];
}

export const qwenProvider: AIProvider = {
  async generateReply(model, messages, apiKeyOverride) {
    try {
      const completion = await getClient(apiKeyOverride).chat.completions.create({ model, messages: toMessages(messages) });
      const text = completion.choices[0]?.message?.content;
      if (!text) throw new Error("Qwen returned an empty response");
      return text;
    } catch (err) {
      handleOpenAICompatError(err, "Qwen");
    }
  },

  async *generateStream(model, messages, apiKeyOverride) {
    const stream = await getClient(apiKeyOverride).chat.completions.create({ model, messages: toMessages(messages), stream: true });
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content;
      if (token) yield token;
    }
  },
};
