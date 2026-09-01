import OpenAI from "openai";
import { env } from "../../../config/env";
import type { AIProvider, ProviderChatMessage } from "./provider.types";
import { toTextContent, toOpenAICompatMessages, handleOpenAICompatError } from "./provider.utils";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

function getClient(apiKeyOverride?: string): OpenAI {
  const apiKey = apiKeyOverride ?? env.XAI_API_KEY;
  if (!apiKey) throw new Error("XAI_API_KEY is not configured. Add it to your environment variables.");
  return new OpenAI({ apiKey, baseURL: "https://api.x.ai/v1" });
}

function toMessages(messages: ProviderChatMessage[]): ChatCompletionMessageParam[] {
  // xAI requires strictly alternating user/assistant turns.
  // Merge any consecutive same-role messages to avoid context being dropped.
  const filtered = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const merged: ProviderChatMessage[] = [];
  for (const m of filtered) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) {
      const prevText = toTextContent(last.content);
      const currText = toTextContent(m.content);
      last.content = `${prevText}\n${currText}`;
    } else {
      merged.push({ ...m });
    }
  }
  return toOpenAICompatMessages(merged) as ChatCompletionMessageParam[];
}

export const groqProvider: AIProvider = {
  async generateReply(model, messages, apiKeyOverride) {
    try {
      const completion = await getClient(apiKeyOverride).chat.completions.create({ model, messages: toMessages(messages) });
      const text = completion.choices[0]?.message?.content;
      if (!text) throw new Error("Grok returned an empty response");
      return text;
    } catch (err) {
      handleOpenAICompatError(err, "Grok");
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
