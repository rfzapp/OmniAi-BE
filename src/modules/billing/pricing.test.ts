import assert from "node:assert/strict";
import test from "node:test";
import { IMAGE_LIMITS_BY_PLAN, MONTHLY_CREDIT_ALLOWANCES } from "../../config/plans";
import {
  CREDITS_PER_USD,
  MODEL_PRICING,
  MissingPricingError,
  calculateCredits,
  calculateProviderCostUsd,
  type ModelPricing,
} from "./pricing";

test("all paid plans have the requested credit allowances and daily image limits", () => {
  assert.deepEqual(MONTHLY_CREDIT_ALLOWANCES, {
    free: 0,
    starter: 60_000,
    pro: 120_000,
    extreme: 220_000,
    ultra: 500_000,
  });
  assert.deepEqual(IMAGE_LIMITS_BY_PLAN, {
    free: 0,
    starter: 5,
    pro: 8,
    extreme: 15,
    ultra: 20,
  });
});

test("exact model rates calculate provider dollars and converted credits", () => {
  const pricing = MODEL_PRICING["gpt-5.6-luna"]!;
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
  assert.equal(calculateProviderCostUsd(usage, pricing, "gpt-5.6-luna"), 1.4);
  assert.equal(calculateCredits(usage, pricing, "gpt-5.6-luna"), 14_000);
  assert.equal(CREDITS_PER_USD, 10_000);
});

test("cached tokens use their own rate without double counting", () => {
  const pricing = MODEL_PRICING["kimi-k3"]!;
  const cost = calculateProviderCostUsd(
    { inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 100_000 },
    pricing,
    "kimi-k3",
  );
  assert.equal(cost, 3.96);
  assert.equal(calculateCredits(
    { inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 100_000 },
    pricing,
    "kimi-k3",
  ), 39_600);
});

test("published image rates are selected by output quality", () => {
  const pricing = MODEL_PRICING["qwen-image-3.0-pro"]!;
  assert.equal(calculateProviderCostUsd({ generatedImages: 2, imageQuality: "high" }, pricing, "qwen-image-3.0-pro"), 0.15);
  assert.equal(calculateCredits({ generatedImages: 1, imageQuality: "low" }, pricing, "qwen-image-3.0-pro"), 400);
});

test("missing pricing dimensions fail closed while OpenRouter DeepSeek prices are available", () => {
  const qwenImage = MODEL_PRICING["qwen-image-3.0"]!;
  assert.throws(
    () => calculateCredits({ generatedImages: 1, imageQuality: "medium" }, qwenImage, "qwen-image-3.0"),
    (error: unknown) => error instanceof MissingPricingError && error.modelId === "qwen-image-3.0",
  );
  const deepseek = MODEL_PRICING["deepseek-chat"]!;
  assert.equal(deepseek.provider, "openrouter");
  assert.equal(calculateProviderCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, deepseek, "deepseek-chat"), 1.21);
  assert.equal(calculateCredits({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, deepseek, "deepseek-chat"), 12_100);
  assert.equal(MODEL_PRICING["deepseek-reasoner"]?.inputUsdPerMillionTokens, 0.7);
  assert.equal(MODEL_PRICING["deepseek-reasoner"]?.outputUsdPerMillionTokens, 2.5);
});

test("the pricing catalog contains explicit entries for every configured model id", () => {
  assert.ok(Object.keys(MODEL_PRICING).length >= 35);
  for (const [modelId, row] of Object.entries(MODEL_PRICING)) {
    assert.ok(row.provider, `${modelId} must identify its provider`);
    assert.ok("inputUsdPerMillionTokens" in row && "outputUsdPerMillionTokens" in row, `${modelId} must explicitly price or mark token rates unavailable`);
  }
});