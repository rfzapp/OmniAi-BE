import type { SubscriptionPlan } from "../types";

/**
 * Unified plan limits — image generation is bundled into every paid plan.
 * Image access is derived directly from the subscription tier.
 *
 * Plans:  free | starter ($25) | pro ($49) | extreme ($89) | ultra ($199)
 */

// ─── Model Access (mirrors frontend modelAccess.ts) ──────────────────────────

/** Free: only 3 recommended models */
const FREE_MODELS = [
  "gpt-5.6-luna",
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
  "kimi-k3",
];

const PAID_IMAGE_MODELS = [
  "gpt-image-2",
  "gpt-image-2-low",
  "gpt-image-2-medium",
  "gpt-image-2-high",
  "qwen-image-3.0",
  "qwen-image-3.0-pro",
  "qwen-image-plus",
  "wan2.7-image",
  "wan2.7-image-pro",
];

/** Starter ($25): cheapest/fastest model from every provider */
const STARTER_MODELS = [
  ...FREE_MODELS,
  ...PAID_IMAGE_MODELS,
  "gpt-5.6-sol",
  "deepseek-chat",
  "grok-3",
  "qwen-turbo",
  "mistral-small-latest",
  "kimi-k2.6",
];

/** Pro ($49): mid-tier models */
const PRO_MODELS = [
  ...STARTER_MODELS,
  "claude-opus-5",
  "deepseek-reasoner",
  "grok-4",
  "qwen-plus",
  "qwen-max",
  "mistral-large-latest",
];

/** Extreme ($89): most powerful non-vision models */
const EXTREME_MODELS = [
  ...PRO_MODELS,
  "gpt-5.6-terra",
  "claude-sonnet-5",
  "moonshot-v1-128k",
];

/** Ultra ($199): everything including vision models */
const ULTRA_MODELS = [
  ...EXTREME_MODELS,
  "claude-fable-5",
  "qwen-vl-plus",
  "qwen-vl-max",
];

/** Model access by subscription plan — cumulative unlocking. */
export const MODEL_ACCESS_BY_PLAN: Record<SubscriptionPlan, string[]> = {
  free:    FREE_MODELS,
  starter: STARTER_MODELS,
  pro:     PRO_MODELS,
  extreme: EXTREME_MODELS,
  ultra:   ULTRA_MODELS,
};

const PLAN_ORDER: SubscriptionPlan[] = ["free", "starter", "pro", "extreme", "ultra"];

/** Check if a model is accessible for the given subscription plan. */
export function isModelAccessible(modelId: string, plan: SubscriptionPlan): boolean {
  if (PAID_IMAGE_MODELS.includes(modelId)) return plan !== "free";
  const allowed = MODEL_ACCESS_BY_PLAN[plan] ?? MODEL_ACCESS_BY_PLAN.free;
  return allowed.includes(modelId);
}

/** Returns the minimum plan required to unlock a model, or null if free. */
export function getRequiredPlanForModel(modelId: string): SubscriptionPlan | null {
  if (PAID_IMAGE_MODELS.includes(modelId)) return "starter";
  for (const plan of PLAN_ORDER) {
    if (MODEL_ACCESS_BY_PLAN[plan].includes(modelId)) return plan;
  }
  return "ultra"; // unknown model → highest plan
}

/** Free retains its existing lifetime message cap; paid plans use credits. */
export const PROMPT_LIMITS: Record<SubscriptionPlan, number | null> = {
  free:    3,      // lifetime total (tracked via promptCount)
  starter: null,
  pro:     null,
  extreme: null,
  ultra:   null,
};

/** Monthly provider-cost credit allowances. Free keeps its existing lifetime message cap. */
export const MONTHLY_CREDIT_ALLOWANCES: Record<SubscriptionPlan, number> = {
  free: 0,
  starter: 60_000,
  pro: 120_000,
  extreme: 220_000,
  ultra: 500_000,
};

/** Per-message character limit per plan. */
export const PROMPT_CHAR_LIMITS: Record<SubscriptionPlan, number> = {
  free:    2000,
  starter: 4000,
  pro:     6000,
  extreme: 8000,
  ultra:   16000,
};

/**
 * Monthly file attachment limits per plan.
 * Free plan has no attachments.
 */
export const ATTACHMENT_LIMITS: Record<SubscriptionPlan, number> = {
  free:    0,
  starter: 30,
  pro:     80,
  extreme: 200,
  ultra:   500,
};

/**
 * Daily image generation limits per plan.
 * Images are bundled — every paid plan includes image gen.
 */
export const IMAGE_LIMITS_BY_PLAN: Record<SubscriptionPlan, number> = {
  free:    0,
  starter: 5,
  pro:     8,
  extreme: 15,
  ultra:   20,
};

export function getPromptLimit(plan: SubscriptionPlan): number | null {
  return PROMPT_LIMITS[plan];
}

export function getPromptCharLimit(plan: SubscriptionPlan): number {
  return PROMPT_CHAR_LIMITS[plan];
}

export function getAttachmentLimit(plan: SubscriptionPlan): number {
  return ATTACHMENT_LIMITS[plan];
}

/** Image generation is included in every paid plan. */
export function canGenerateImages(plan: SubscriptionPlan): boolean {
  return plan === "starter" || plan === "pro" || plan === "extreme" || plan === "ultra";
}

/** Returns the image generation limit for a given plan. */
export function getImageLimit(plan: SubscriptionPlan): number {
  return IMAGE_LIMITS_BY_PLAN[plan];
}

/** Capitalize plan name for user-facing messages. */
export function capitalizePlan(plan: SubscriptionPlan): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

/**
 * Normalize a raw subscription string from the DB to the canonical SubscriptionPlan.
 * Handles legacy plan names (standard → starter, ultra_pro → ultra) so all
 * limit lookups work correctly without requiring a DB migration.
 */
export function normalizePlan(raw: string): SubscriptionPlan {
  const legacyMap: Record<string, SubscriptionPlan> = {
    standard:  "starter",
    ultra_pro: "ultra",
  };
  if (raw in legacyMap) return legacyMap[raw]!;
  const valid: SubscriptionPlan[] = ["free", "starter", "pro", "extreme", "ultra"];
  return valid.includes(raw as SubscriptionPlan) ? (raw as SubscriptionPlan) : "free";
}
