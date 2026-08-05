import type { SubscriptionPlan } from "../types";

/** `null` means unlimited prompts for that plan. */
export const PROMPT_LIMITS: Record<SubscriptionPlan, number | null> = {
  free: 3,
  pro: null,
  enterprise: null,
};

export function getPromptLimit(plan: SubscriptionPlan): number | null {
  return PROMPT_LIMITS[plan];
}
