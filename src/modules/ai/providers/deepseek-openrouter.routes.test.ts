import assert from "node:assert/strict";
import test from "node:test";
import {
  DEEPSEEK_OPENROUTER_ROUTES,
  resolveDeepSeekOpenRouterRoute,
} from "./deepseek-openrouter.routes";

test("DeepSeek entries resolve only to their explicitly configured OpenRouter models", () => {
  assert.equal(DEEPSEEK_OPENROUTER_ROUTES["deepseek-chat"]?.openRouterModelId, "deepseek/deepseek-chat");
  assert.equal(DEEPSEEK_OPENROUTER_ROUTES["deepseek-reasoner"]?.openRouterModelId, "deepseek/deepseek-r1");
  assert.equal(DEEPSEEK_OPENROUTER_ROUTES["deepseek-omni"]?.openRouterModelId, "deepseek/deepseek-chat");
  for (const route of Object.values(DEEPSEEK_OPENROUTER_ROUTES)) {
    assert.equal(route.provider, "openrouter");
    assert.equal(route.enabled, true);
    assert.deepEqual(route.capabilities, { text: true, vision: false, streaming: true });
  }
});

test("unknown DeepSeek models do not get a guessed route", () => {
  assert.equal(resolveDeepSeekOpenRouterRoute("deepseek-unknown"), undefined);
  assert.equal(resolveDeepSeekOpenRouterRoute("qwen-max"), undefined);
});
