import type { ImagePlan, SubscriptionPlan } from "../types";

/** `null` means unlimited prompts for that plan. */
export const PROMPT_LIMITS: Record<SubscriptionPlan, number | null> = {
  free: 3,
  standard: 100,
  pro: 500,
  ultra_pro: 1500,
};

/** Image generation limits per image plan. `null` means unlimited. */
export const IMAGE_LIMITS: Record<ImagePlan, number | null> = {
  none: 0,
  basic: 50,   // 50 images/month
  pro: null,   // unlimited
};

/** File attachment limits per 24 hours. */
export const ATTACHMENT_LIMITS: Record<SubscriptionPlan, number> = {
  free: 0,
  standard: 3,
  pro: 15,
  ultra_pro: 45,
};

export function getPromptLimit(plan: SubscriptionPlan): number | null {
  return PROMPT_LIMITS[plan];
}

export function getAttachmentLimit(plan: SubscriptionPlan): number {
  return ATTACHMENT_LIMITS[plan] ?? 0;
}

export function canGenerateImages(imagePlan: ImagePlan): boolean {
  return imagePlan !== "none";
}

export function getImageLimit(imagePlan: ImagePlan): number | null {
  return IMAGE_LIMITS[imagePlan];
}
