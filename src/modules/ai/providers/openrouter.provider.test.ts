import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../../utils/ApiError";
import type { ProviderChatMessage } from "./provider.types";
import { createOpenRouterProvider } from "./openrouter.provider";

const messages: ProviderChatMessage[] = [
  { role: "system", content: "Follow the system instruction." },
  { role: "user", content: "Hello" },
];

test("standard chat sends the explicit model and preserves conversation messages", async () => {
  let requestUrl = "";
  let requestBody: Record<string, unknown> | undefined;
  const provider = createOpenRouterProvider(
    () => "test-only-key",
    async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: "test-completion",
        object: "chat.completion",
        created: 0,
        model: "deepseek/deepseek-chat",
        choices: [{ index: 0, message: { role: "assistant", content: "Hello back" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  );

  const response = await provider.generateReply("deepseek/deepseek-chat", messages);

  assert.equal(requestUrl, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(requestBody?.model, "deepseek/deepseek-chat");
  assert.deepEqual(requestBody?.messages, messages);
  assert.deepEqual(response, { text: "Hello back", usage: { inputTokens: 3, outputTokens: 2 } });
});

test("streaming forwards tokens and provider-reported usage", async () => {
  const provider = createOpenRouterProvider(
    () => "test-only-key",
    async () => new Response([
      'data: {"id":"test","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}',
      "",
      'data: {"id":"test","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":1,"total_tokens":5}}',
      "",
      "data: [DONE]",
      "",
      "",
    ].join("\n"), { status: 200, headers: { "content-type": "text/event-stream" } }),
  );

  const chunks = [];
  for await (const chunk of provider.generateStream("deepseek/deepseek-r1", messages)) {
    chunks.push(chunk);
  }

  assert.equal(chunks[0]?.type, "start");
  assert.ok(chunks.some((chunk) => chunk.type === "token" && chunk.content === "Hello"));
  assert.ok(chunks.some((chunk) => chunk.type === "usage" && chunk.usage?.inputTokens === 4 && chunk.usage.outputTokens === 1));
  assert.equal(chunks.at(-1)?.type, "done");
});

test("missing OpenRouter credentials fail before making a request", async () => {
  let requestCount = 0;
  const provider = createOpenRouterProvider(
    () => undefined,
    async () => {
      requestCount += 1;
      return new Response();
    },
  );

  await assert.rejects(
    provider.generateReply("deepseek/deepseek-chat", messages),
    (error: unknown) => error instanceof ApiError && error.statusCode === 503 && error.message.includes("OPENROUTER_API_KEY"),
  );
  assert.equal(requestCount, 0);
});

test("provider HTTP errors are sanitized and streaming cancellation is surfaced", async () => {
  const failingProvider = createOpenRouterProvider(
    () => "test-only-key",
    async () => new Response(JSON.stringify({ error: { message: "private provider response content" } }), { status: 500 }),
  );
  await assert.rejects(
    failingProvider.generateReply("deepseek/deepseek-chat", messages),
    (error: unknown) => error instanceof ApiError
      && error.statusCode === 502
      && !error.message.includes("private provider response content"),
  );

  const controller = new AbortController();
  const cancelProvider = createOpenRouterProvider(
    () => "test-only-key",
    async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
  );
  const iterator = cancelProvider.generateStream("deepseek/deepseek-chat", messages, undefined, controller.signal);
  assert.equal((await iterator.next()).value?.type, "start");
  const pendingChunk = iterator.next();
  controller.abort();
  const cancelled = await pendingChunk;
  assert.equal(cancelled.value?.type, "error");
  assert.match(cancelled.value?.content ?? "", /cancelled/i);

  const timeoutProvider = createOpenRouterProvider(
    () => "test-only-key",
    async () => {
      throw new DOMException("Timeout", "TimeoutError");
    },
  );
  const timeoutChunks = [];
  for await (const chunk of timeoutProvider.generateStream("deepseek/deepseek-chat", messages)) {
    timeoutChunks.push(chunk);
  }
  assert.match(timeoutChunks.find((chunk) => chunk.type === "error")?.content ?? "", /timed out/i);
});
