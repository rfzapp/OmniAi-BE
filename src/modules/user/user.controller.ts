import type { Request, Response } from "express";
import { sendSuccess } from "../../utils/ApiResponse";
import { ApiError } from "../../utils/ApiError";
import * as userService from "./user.service";
import {
  getAttachmentLimit, getPromptCharLimit,
  MODEL_ACCESS_BY_PLAN, normalizePlan,
} from "../../config/plans";
import { getBillingHistory, getCreditSummary, getDailyImageSummary } from "../billing/credit.service";

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
  const [credits, images] = await Promise.all([
    getCreditSummary(req.user.id, now),
    getDailyImageSummary(req.user.id, now),
  ]);

  // Attachment usage
  const attachmentLimit = getAttachmentLimit(plan);
  const lastPromptReset = user.lastPromptResetAt ? new Date(user.lastPromptResetAt) : now;
  const attachNeedsReset = now.getTime() - lastPromptReset.getTime() >= resetInterval;
  const attachmentsUsed = plan === "free" ? 0 : (attachNeedsReset ? 0 : (user.attachmentCount24h ?? 0));

  sendSuccess(res, 200, "Usage data fetched successfully", {
    plan,
    usage: {
      credits: {
        remaining: credits.available,
        reserved: credits.reserved,
        debt: credits.debt,
        used: credits.usedThisPeriod,
        allowance: credits.allowance,
        periodStartAt: credits.periodStartAt,
        periodEndAt: credits.periodEndAt,
      },
      attachments: {
        used: attachmentsUsed,
        limit: attachmentLimit,
        unlimited: false,
      },
      images: {
        used: images.used,
        reserved: images.reserved,
        remaining: images.remaining,
        limit: images.limit,
        date: images.date,
        timezone: images.timezone,
      },
    },
    charLimit: getPromptCharLimit(plan),
    modelAccess: MODEL_ACCESS_BY_PLAN[plan] ?? MODEL_ACCESS_BY_PLAN.free,
  });
}

export async function getBillingHistoryHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();
  const requestedLimit = Number(req.query.limit ?? 50);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.floor(requestedLimit))) : 50;
  const history = await getBillingHistory(req.user.id, limit);
  sendSuccess(res, 200, "Billing history fetched successfully", history);
}
