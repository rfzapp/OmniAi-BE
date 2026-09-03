import OpenAI from "openai";
import { env } from "../../../config/env";
import type { AIProvider, ProviderChatMessage } from "./provider.types";
import { toOpenAICompatMessages, handleOpenAICompatError } from "./provider.utils";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

function getClient(apiKeyOverride?: string): OpenAI {
  const apiKey = apiKeyOverride ?? env.QWEN_API_KEY;
  if (!apiKey) throw new Error("QWEN_API_KEY is not configured.");
  return new OpenAI({ apiKey, baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" });
}

function toMessages(messages: ProviderChatMessage[]): ChatCompletionMessageParam[] {
  return toOpenAICompatMessages(messages) as ChatCompletionMessageParam[];
}

/** Log safe structural info about the outgoing Qwen messages — no URLs or content. */
function logQwenRequest(messages: ChatCompletionMessageParam[], model: string): void {
  const multimodalMsg = messages.find(
    (m) => Array.isArray(m.content)
  );
  const isMultimodal = !!multimodalMsg;

  console.log(`[QWEN] API request START`);
  console.log(`[QWEN] model=${model}`);
  console.log(`[QWEN] messages=${messages.length}`);
  console.log(`[QWEN] multimodal=${isMultimodal}`);

  if (isMultimodal && Array.isArray(multimodalMsg?.content)) {
    const parts = multimodalMsg.content as Array<{ type: string }>;
    const textParts = parts.filter((p) => p.type === "text").length;
    const imageParts = parts.filter((p) => p.type === "image_url").length;
    console.log(`[QWEN] message role=${multimodalMsg.role}`);
    console.log(`[QWEN] content is array=true`);
    console.log(`[QWEN] content parts=${parts.length}`);
    console.log(`[QWEN] text parts=${textParts}`);
    console.log(`[QWEN] image parts=${imageParts}`);
    if (imageParts > 0) {
      const imgPart = parts.find((p) => p.type === "image_url") as { type: "image_url"; image_url: { url: string; detail?: string } } | undefined;
      if (imgPart) {
        const url = imgPart.image_url.url ?? "";
        const host = url.startsWith("https://") ? url.split("/")[2] : "unknown";
        console.log(`[QWEN] image type=image_url`);
        console.log(`[QWEN] image URL present=${url.length > 0}`);
        console.log(`[QWEN] image host=${host}`);
        console.log(`[QWEN] image detail=${imgPart.image_url.detail ?? "auto"}`);
      }
    }
  } else {
    console.log(`[QWEN] message format=text-only`);
  }
}

export const qwenProvider: AIProvider = {
  async generateReply(model, messages, apiKeyOverride) {
    try {
      const converted = toMessages(messages);
      logQwenRequest(converted, model);
      const completion = await getClient(apiKeyOverride).chat.completions.create({ model, messages: converted });
      const text = completion.choices[0]?.message?.content;
      if (!text) throw new Error("Qwen returned an empty response");
      return text;
    } catch (err) {
      handleOpenAICompatError(err, "Qwen");
    }
  },

  async *generateStream(model, messages, apiKeyOverride, signal) {
    yield { type: "start" };
    try {
      const converted = toMessages(messages);
      logQwenRequest(converted, model);

      const stream = await getClient(apiKeyOverride).chat.completions.create(
        { model, messages: converted, stream: true },
        { signal },
      );

      let chunkIndex = 0;
      let tokenCount = 0;
      let lastFinishReason: string | null = null;

      for await (const chunk of stream) {
        chunkIndex++;
        const choice = chunk.choices[0];
        const delta = choice?.delta as Record<string, unknown> | undefined;
        const deltaKeys = delta ? Object.keys(delta).filter((k) => delta[k] !== undefined && delta[k] !== null && delta[k] !== "").join(",") : "";

        // Safe chunk diagnostics — never log actual content
        if (chunkIndex <= 3 || chunkIndex % 20 === 0) {
          console.log(`[QWEN] chunk=${chunkIndex} hasChoice=${!!choice} deltaKeys=${deltaKeys || "(empty)"}`);
        }

        if (choice?.finish_reason) {
          lastFinishReason = choice.finish_reason;
        }

        const token = choice?.delta?.content;
        if (token) {
          tokenCount++;
          yield { type: "token", content: token };
        }
      }

      console.log(`[QWEN] API response complete: chunks=${chunkIndex} tokens=${tokenCount} finishReason=${lastFinishReason}`);

      // Guard: if Qwen returned chunks but no content tokens, emit an error
      // instead of silently completing with an empty reply.
      if (tokenCount === 0 && chunkIndex > 0) {
        const isMultimodal = converted.some((m) => Array.isArray(m.content));
        const hint = isMultimodal
          ? "The selected model may not support image input. Please use Qwen VL Plus or Qwen VL Max for image analysis."
          : "Qwen returned an empty response. Please try again.";
        console.warn(`[QWEN] WARNING: stream completed with 0 tokens (chunks=${chunkIndex}, multimodal=${isMultimodal})`);
        yield { type: "error", content: hint };
        return;
      }

      yield { type: "done" };
    } catch (err: any) {
      yield { type: "error", content: err?.message || String(err) };
    }
  },
};
