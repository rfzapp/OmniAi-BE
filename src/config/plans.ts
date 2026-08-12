import type { ImagePlan, SubscriptionPlan } from "../types";

/** `null` means unlimited prompts for that plan. */
export const PROMPT_LIMITS: Record<SubscriptionPlan, number | null> = {
  free: 3,
  standard: 100,
  pro: 500,
  ultra_pro: 1500,
};

/** Daily image generation limits per image plan. */
export const IMAGE_LIMITS: Record<ImagePlan, number> = {
  none: 0,
  basic: 3,        // $50/mo — 3 images/day
  pro: 10,         // $150/mo — 10 images/day
  ultra_pro: 15,   // $250/mo — 15 images/day
};

export function getPromptLimit(plan: SubscriptionPlan): number | null {
  return PROMPT_LIMITS[plan];
}

export function canGenerateImages(imagePlan: ImagePlan): boolean {
  return imagePlan !== "none";
}

export function getImageLimit(imagePlan: ImagePlan): number {
  return IMAGE_LIMITS[imagePlan];
}

export function getAttachmentLimit(plan: SubscriptionPlan): number {
  if (plan === "ultra_pro") return 100;
  if (plan === "pro") return 50;
  if (plan === "standard") return 20;
  return 0;
}
