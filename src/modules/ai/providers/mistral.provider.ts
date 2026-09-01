import OpenAI from "openai";
import { env } from "../../../config/env";
import type { AIProvider, ProviderChatMessage } from "./provider.types";
import { toOpenAICompatMessages, handleOpenAICompatError } from "./provider.utils";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

function getClient(apiKeyOverride?: string): OpenAI {
  const apiKey = apiKeyOverride ?? env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("MISTRAL_API_KEY is not configured.");
  return new OpenAI({ apiKey, baseURL: "https://api.mistral.ai/v1" });
}

function toMessages(messages: ProviderChatMessage[]): ChatCompletionMessageParam[] {
  return toOpenAICompatMessages(messages) as ChatCompletionMessageParam[];
}

export const mistralProvider: AIProvider = {
  async generateReply(model, messages, apiKeyOverride) {
    try {
      const completion = await getClient(apiKeyOverride).chat.completions.create({ model, messages: toMessages(messages) });
      const text = completion.choices[0]?.message?.content;
      if (!text) throw new Error("Mistral returned an empty response");
      return text;
    } catch (err) {
      handleOpenAICompatError(err, "Mistral");
    }
  },

  async *generateStream(model, messages, apiKeyOverride, signal) {
    yield { type: "start" };
    try {
      const stream = await getClient(apiKeyOverride).chat.completions.create({ model, messages: toMessages(messages), stream: true }, { signal });
      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content;
        if (token) yield { type: "token", content: token };
      }
      yield { type: "done" };
    } catch (err: any) {
      yield { type: "error", content: err?.message || String(err) };
    }
  },
};
