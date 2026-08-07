import type { ImagePlan, SubscriptionPlan } from "../types";

/** `null` means unlimited prompts for that plan. */
export const PROMPT_LIMITS: Record<SubscriptionPlan, number | null> = {
  free: 3,
  pro: null,
  enterprise: null,
};

/** Image generation limits per image plan. `null` means unlimited. */
export const IMAGE_LIMITS: Record<ImagePlan, number | null> = {
  none: 0,
  basic: 50,   // 50 images/month
  pro: null,   // unlimited
};

export function getPromptLimit(plan: SubscriptionPlan): number | null {
  return PROMPT_LIMITS[plan];
}

export function canGenerateImages(imagePlan: ImagePlan): boolean {
  return imagePlan !== "none";
}

export function getImageLimit(imagePlan: ImagePlan): number | null {
  return IMAGE_LIMITS[imagePlan];
}
