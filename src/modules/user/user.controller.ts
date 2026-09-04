import type { Request, Response } from "express";
import { sendSuccess } from "../../utils/ApiResponse";
import { ApiError } from "../../utils/ApiError";
import * as userService from "./user.service";
import {
  getPromptLimit, getAttachmentLimit, getImageLimit, getPromptCharLimit,
  MODEL_ACCESS_BY_PLAN, normalizePlan,
} from "../../config/plans";

export async function updateProfileHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();
  const user = await userService.updateProfile(req.user.id, req.body);
  sendSuccess(res, 200, "Profile updated successfully", { user });
}

export async function changePasswordHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();
  await userService.changePassword(req.user.id, req.body);
  sendSuccess(res, 200, "Password changed successfully");
}

export async function deleteAccountHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();
  await userService.deleteAccount(req.user.id);
  sendSuccess(res, 200, "Account deleted successfully");
}

export async function getUsageHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();

  const user = await userService.getUserById(req.user.id);
  // Normalize legacy plan names (standard → starter, ultra_pro → ultra) so
  // all limit lookups work without requiring a DB migration.
  const plan = normalizePlan(user.subscription as string);
  const now = new Date();
  const resetInterval = 30 * 24 * 60 * 60 * 1000; // 30-day rolling window

  // Prompt usage
  const promptLimit = getPromptLimit(plan);
  let promptsUsed: number;
  if (plan === "free") {
    promptsUsed = user.promptCount ?? 0;
  } else {
    const lastPromptReset = user.lastPromptResetAt ? new Date(user.lastPromptResetAt) : now;
    const needsReset = now.getTime() - lastPromptReset.getTime() >= resetInterval;
    promptsUsed = needsReset ? 0 : (user.promptCount24h ?? 0);
  }

  // Attachment usage
  const attachmentLimit = getAttachmentLimit(plan);
  const lastPromptReset = user.lastPromptResetAt ? new Date(user.lastPromptResetAt) : now;
  const attachNeedsReset = now.getTime() - lastPromptReset.getTime() >= resetInterval;
  const attachmentsUsed = plan === "free" ? 0 : (attachNeedsReset ? 0 : (user.attachmentCount24h ?? 0));

  // Image usage
  const imageLimit = getImageLimit(plan);
  const lastImageReset = user.lastImageResetAt ? new Date(user.lastImageResetAt) : now;
  const imageNeedsReset = now.getTime() - lastImageReset.getTime() >= resetInterval;
  const imagesUsed = plan === "free" ? 0 : (imageNeedsReset ? 0 : (user.imageCount24h ?? 0));

  sendSuccess(res, 200, "Usage data fetched successfully", {
    plan,
    usage: {
      prompts: {
        used: promptsUsed,
        limit: promptLimit,
        unlimited: promptLimit === null,
      },
      attachments: {
        used: attachmentsUsed,
        limit: attachmentLimit,
        unlimited: false,
      },
      images: {
        used: imagesUsed,
        limit: imageLimit,
        unlimited: false,
      },
    },
    charLimit: getPromptCharLimit(plan),
    modelAccess: MODEL_ACCESS_BY_PLAN[plan] ?? MODEL_ACCESS_BY_PLAN.free,
  });
}
