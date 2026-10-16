import { randomUUID } from "node:crypto";
import { ApiError } from "../../utils/ApiError";
import { MONTHLY_CREDIT_ALLOWANCES, getImageLimit, normalizePlan } from "../../config/plans";
import { User, type IUser } from "../user/user.model";
import { AIUsageLog, CreditTransaction, DailyImageUsage } from "./billing.models";
import { PRICING_TABLE_VERSION, calculateCredits, calculateProviderCostUsd, getModelPricing, type BillableUsage } from "./pricing";

type BillableOperation = "chat" | "image-generation" | "image-edit";
type BillingAccount = Pick<
  IUser,
  | "subscription"
  | "creditsAvailable"
  | "creditsReserved"
  | "creditsDebt"
  | "creditsUsedThisPeriod"
  | "monthlyCreditAllowance"
  | "creditPeriodStartAt"
  | "creditPeriodEndAt"
  | "creditReservations"
>;

function addUtcMonth(value: Date): Date {
  const result = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1));
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(value.getUTCDate(), lastDay));
  return result;
}

function validRequestId(value?: string): string {
  const requestId = value || randomUUID();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) throw ApiError.badRequest("Invalid request ID");
  return requestId;
}

async function writeTransaction(input: {
  userId: string;
  requestId: string;
  kind: "reserve" | "charge" | "release" | "refund" | "renewal";
  credits: number;
  balanceAfter?: number;
  providerCostUsd?: number;
  model?: string;
  metadata?: Record<string, unknown>;
}) {
  const idempotencyKey = `${input.userId}:${input.requestId}:${input.kind}`;
  await CreditTransaction.updateOne(
    { idempotencyKey },
    { $setOnInsert: { ...input, idempotencyKey, pricingVersion: PRICING_TABLE_VERSION } },
    { upsert: true },
  );
}

async function initializeAccount(userId: string, now: Date): Promise<BillingAccount> {
  let user = await User.findById(userId).select(
    "subscription creditsAvailable creditsReserved creditsDebt creditsUsedThisPeriod monthlyCreditAllowance creditPeriodStartAt creditPeriodEndAt creditReservations",
  ) as unknown as BillingAccount | null;
  if (!user) throw ApiError.notFound("User not found");

  const plan = normalizePlan(user.subscription as string);
  if (!user.creditPeriodStartAt || (plan !== "free" && !user.creditPeriodEndAt)) {
    const allowance = MONTHLY_CREDIT_ALLOWANCES[plan];
    const initialized = await User.findOneAndUpdate(
      { _id: userId, $or: [{ creditPeriodStartAt: null }, { creditPeriodStartAt: { $exists: false } }] },
      {
        $set: {
          creditPeriodStartAt: now,
          creditPeriodEndAt: plan === "free" ? null : addUtcMonth(now),
          monthlyCreditAllowance: allowance,
          creditsAvailable: Math.max(0, allowance - (user.creditsDebt ?? 0)),
          creditsUsedThisPeriod: 0,
          creditsReserved: 0,
          creditReservations: {},
        },
      },
      { new: true },
    ) as unknown as BillingAccount | null;
    user = initialized ?? await User.findById(userId).select(
      "subscription creditsAvailable creditsReserved creditsDebt creditsUsedThisPeriod monthlyCreditAllowance creditPeriodStartAt creditPeriodEndAt creditReservations",
    ) as unknown as BillingAccount | null;
    if (!user) throw ApiError.notFound("User not found");
    if (initialized && allowance > 0) {
      await writeTransaction({
        userId,
        requestId: `initial-${now.getTime()}`,
        kind: "renewal",
        credits: allowance,
        balanceAfter: initialized.creditsAvailable,
        metadata: { plan, source: "lazy-migration", periodStart: now.toISOString() },
      });
    }
  }

  if (plan !== "free" && user.creditPeriodEndAt && user.creditPeriodEndAt <= now) {
    user = await renewMonthlyCredits(userId, now);
  }
  return user;
}

export async function renewMonthlyCredits(userId: string, effectiveAt = new Date()): Promise<BillingAccount> {
  let user = await User.findById(userId).select(
    "subscription creditsAvailable creditsReserved creditsDebt creditsUsedThisPeriod monthlyCreditAllowance creditPeriodStartAt creditPeriodEndAt",
  ) as unknown as BillingAccount | null;
  if (!user) throw ApiError.notFound("User not found");
  const plan = normalizePlan(user.subscription as string);
  if (plan === "free") return user;
  if (!user.creditPeriodEndAt) return initializeAccount(userId, effectiveAt);

  for (let count = 0; user.creditPeriodEndAt !== null && user.creditPeriodEndAt <= effectiveAt && count < 120; count++) {
    if ((user.creditsReserved ?? 0) > 0) throw new ApiError(409, "Credit renewal is waiting for pending requests to settle.");
    const previousEnd = user.creditPeriodEndAt;
    const allowance = MONTHLY_CREDIT_ALLOWANCES[plan];
    const debt = user.creditsDebt ?? 0;
    const updated = await User.findOneAndUpdate(
      { _id: userId, creditPeriodEndAt: previousEnd, creditsReserved: 0 },
      {
        $set: {
          creditPeriodStartAt: previousEnd,
          creditPeriodEndAt: addUtcMonth(previousEnd),
          monthlyCreditAllowance: allowance,
          creditsAvailable: Math.max(0, allowance - debt),
          creditsDebt: Math.max(0, debt - allowance),
          creditsUsedThisPeriod: 0,
        },
      },
      { new: true },
    ) as unknown as BillingAccount | null;
    if (updated) {
      await writeTransaction({
        userId,
        requestId: `renewal-${previousEnd.getTime()}`,
        kind: "renewal",
        credits: allowance,
        balanceAfter: updated.creditsAvailable,
        metadata: { plan, periodStart: previousEnd.toISOString(), periodEnd: updated.creditPeriodEndAt?.toISOString() },
      });
      user = updated;
    } else {
      user = await User.findById(userId).select(
        "subscription creditsAvailable creditsReserved creditsDebt creditsUsedThisPeriod monthlyCreditAllowance creditPeriodStartAt creditPeriodEndAt",
      ) as unknown as BillingAccount | null;
      if (!user) throw ApiError.notFound("User not found");
      if ((user.creditsReserved ?? 0) > 0 && user.creditPeriodEndAt && user.creditPeriodEndAt <= effectiveAt) {
        throw new ApiError(409, "Credit renewal is waiting for pending requests to settle.");
      }
    }
  }
  return user;
}

export async function getCreditSummary(userId: string, now = new Date()) {
  const user = await initializeAccount(userId, now);
  const allowance = user.monthlyCreditAllowance ?? 0;
  const available = user.creditsAvailable ?? 0;
  const reserved = user.creditsReserved ?? 0;
  return {
    available,
    reserved,
    debt: user.creditsDebt ?? 0,
    // Reconcile legacy accounts whose available balance was debited before the
    // period usage counter was reliably populated. Reserved credits are
    // excluded because they have not been settled as usage yet.
    usedThisPeriod: Math.max(user.creditsUsedThisPeriod ?? 0, allowance - available - reserved),
    allowance,
    periodStartAt: user.creditPeriodStartAt,
    periodEndAt: user.creditPeriodEndAt,
  };
}

export function estimateRequestCredits(modelId: string, estimatedUsage: BillableUsage): number {
  const pricing = getModelPricing(modelId);
  if (!pricing) throw new ApiError(503, `Billing is not configured for model ${modelId}.`);
  try {
    return calculateCredits(estimatedUsage, pricing, modelId);
  } catch {
    throw new ApiError(503, `Billing is not configured for all usage metrics of model ${modelId}.`);
  }
}

export async function reserveCredits(input: {
  userId: string;
  requestId?: string;
  modelId: string;
  operation: BillableOperation;
  estimatedCredits: number;
  imageQuality?: "low" | "medium" | "high";
}) {
  const requestId = validRequestId(input.requestId);
  const pricing = getModelPricing(input.modelId);
  if (!pricing) throw new ApiError(503, `Billing is not configured for model ${input.modelId}.`);
  if (!Number.isSafeInteger(input.estimatedCredits) || input.estimatedCredits < 1) {
    throw ApiError.badRequest("The server could not estimate this request's credit reservation.");
  }

  const user = await initializeAccount(input.userId, new Date());
  const reservations = user.creditReservations as Record<string, { credits: number; status: string }> | undefined;
  const previous = reservations?.[requestId];
  if (previous) {
    if (previous.status === "reserved") return { requestId, reservedCredits: previous.credits, balance: user.creditsAvailable };
    throw new ApiError(409, "This request ID has already been completed.");
  }

  const updated = await User.findOneAndUpdate(
    {
      _id: input.userId,
      creditsAvailable: { $gte: input.estimatedCredits },
      [`creditReservations.${requestId}`]: { $exists: false },
    },
    {
      $inc: { creditsAvailable: -input.estimatedCredits, creditsReserved: input.estimatedCredits },
      $set: {
        [`creditReservations.${requestId}`]: {
          credits: input.estimatedCredits,
          status: "reserved",
          model: input.modelId,
          operation: input.operation,
          imageQuality: input.imageQuality,
        },
      },
    },
    { new: true },
  );
  if (!updated) {
    const latest = await User.findById(input.userId).select("creditsAvailable creditReservations");
    const existing = (latest?.creditReservations as Record<string, { credits: number; status: string }> | undefined)?.[requestId];
    if (existing?.status === "reserved") return { requestId, reservedCredits: existing.credits, balance: latest?.creditsAvailable ?? 0 };
    throw new ApiError(402, "INSUFFICIENT_CREDITS: Not enough credits for this request.");
  }

  await writeTransaction({
    userId: input.userId,
    requestId,
    kind: "reserve",
    credits: input.estimatedCredits,
    balanceAfter: updated.creditsAvailable,
    model: input.modelId,
    metadata: { operation: input.operation },
  });
  await AIUsageLog.updateOne(
    { userId: input.userId, requestId },
    {
      $setOnInsert: {
        userId: input.userId,
        requestId,
        operation: input.operation,
        provider: pricing.provider,
        model: input.modelId,
        pricingVersion: PRICING_TABLE_VERSION,
        status: "reserved",
        reservationCredits: input.estimatedCredits,
      },
    },
    { upsert: true },
  );
  return { requestId, reservedCredits: input.estimatedCredits, balance: updated.creditsAvailable };
}

async function reservationPricing(userId: string, requestId: string) {
  const user = await User.findById(userId).select("creditReservations");
  const reservation = (user?.creditReservations as Record<string, { credits: number; status: string; model: string }> | undefined)?.[requestId];
  if (!reservation?.model) throw ApiError.notFound("Credit reservation not found");
  const pricing = getModelPricing(reservation.model);
  if (!pricing) throw new ApiError(503, `Billing is not configured for model ${reservation.model}.`);
  return { reservation, pricing, modelId: reservation.model };
}

export async function settleCredits(userId: string, requestId: string, usage: BillableUsage) {
  const { reservation, pricing, modelId } = await reservationPricing(userId, requestId);
  let actualCredits: number;
  let actualCostUsd: number;
  try {
    actualCredits = calculateCredits(usage, pricing, modelId);
    actualCostUsd = calculateProviderCostUsd(usage, pricing, modelId);
  } catch {
    await AIUsageLog.updateOne({ userId, requestId }, { $set: { status: "unpriced", usage } });
    throw new ApiError(503, `Provider usage included unpriced metrics for model ${modelId}.`);
  }

  const delta = reservation.credits - actualCredits;
  const updated = await User.findOneAndUpdate(
    { _id: userId, [`creditReservations.${requestId}.status`]: "reserved" },
    [
      {
        $set: {
          creditsAvailable: { $max: [0, { $subtract: [{ $add: [{ $ifNull: ["$creditsAvailable", 0] }, reservation.credits] }, actualCredits] }] },
          creditsReserved: { $subtract: [{ $ifNull: ["$creditsReserved", 0] }, reservation.credits] },
          creditsDebt: {
            $add: [
              { $ifNull: ["$creditsDebt", 0] },
              { $max: [0, { $subtract: [actualCredits, { $add: [{ $ifNull: ["$creditsAvailable", 0] }, reservation.credits] }] }] },
            ],
          },
          creditsUsedThisPeriod: { $add: [{ $ifNull: ["$creditsUsedThisPeriod", 0] }, actualCredits] },
          [`creditReservations.${requestId}`]: { credits: actualCredits, status: "settled" },
        },
      },
    ],
    { new: true },
  );
  if (!updated) {
    const latest = await User.findById(userId).select("creditReservations creditsAvailable");
    const existing = (latest?.creditReservations as Record<string, { status: string }> | undefined)?.[requestId];
    if (existing?.status === "settled") return { creditsCharged: actualCredits, balance: latest?.creditsAvailable ?? 0 };
    throw ApiError.conflict("Credit reservation is no longer active.");
  }

  await writeTransaction({
    userId,
    requestId,
    kind: "charge",
    credits: actualCredits,
    providerCostUsd: actualCostUsd,
    balanceAfter: updated.creditsAvailable,
    model: modelId,
  });
  if (delta > 0) await writeTransaction({ userId, requestId, kind: "release", credits: delta, balanceAfter: updated.creditsAvailable, model: modelId });
  await AIUsageLog.updateOne(
    { userId, requestId },
    { $set: { status: "settled", usage, providerCostUsd: actualCostUsd, creditsCharged: actualCredits } },
  );
  return { creditsCharged: actualCredits, balance: updated.creditsAvailable };
}

export async function refundCredits(userId: string, requestId: string, reason = "provider-failure", imageDate?: string) {
  const user = await User.findById(userId).select("creditReservations creditsAvailable");
  const reservation = (user?.creditReservations as Record<string, { credits: number; status: string; model?: string }> | undefined)?.[requestId];
  if (!reservation || reservation.status !== "reserved") return { refunded: false, balance: user?.creditsAvailable ?? 0 };
  const updated = await User.findOneAndUpdate(
    { _id: userId, [`creditReservations.${requestId}.status`]: "reserved" },
    {
      $inc: { creditsAvailable: reservation.credits, creditsReserved: -reservation.credits },
      $set: { [`creditReservations.${requestId}.status`]: "refunded" },
    },
    { new: true },
  );
  if (!updated) return { refunded: false, balance: user?.creditsAvailable ?? 0 };
  await writeTransaction({
    userId,
    requestId,
    kind: "refund",
    credits: reservation.credits,
    balanceAfter: updated.creditsAvailable,
    ...(reservation.model ? { model: reservation.model } : {}),
    metadata: { reason },
  });
  await AIUsageLog.updateOne({ userId, requestId }, { $set: { status: "refunded", failureCode: reason } });
  await releaseImageQuota(userId, requestId, imageDate);
  return { refunded: true, balance: updated.creditsAvailable };
}

export async function reserveImageQuota(userId: string, requestId: string, imageCount = 1) {
  const user = await User.findById(userId).select("subscription");
  if (!user) throw ApiError.notFound("User not found");
  const plan = normalizePlan(user.subscription as string);
  const limit = getImageLimit(plan);
  if (limit < 1) throw new ApiError(403, "Image generation is not available on the Free plan. Upgrade to a paid plan.");

  const date = new Date().toISOString().slice(0, 10);
  const key = validRequestId(requestId);
  await DailyImageUsage.updateOne(
    { userId, date },
    { $setOnInsert: { userId, date, used: 0, reserved: 0, reservations: {} } },
    { upsert: true },
  );
  const record = await DailyImageUsage.findOneAndUpdate(
    {
      userId,
      date,
      [`reservations.${key}`]: { $exists: false },
      $expr: { $lte: [{ $add: ["$used", "$reserved", imageCount] }, limit] },
    },
    { $inc: { reserved: imageCount }, $set: { [`reservations.${key}`]: { count: imageCount, status: "reserved" } } },
    { new: true },
  );
  if (!record) {
    const existingDoc = await DailyImageUsage.findOne({ userId, date });
    const reservations = existingDoc?.get("reservations") as Record<string, { count: number; status: string }> | undefined;
    if (reservations?.[key]?.status === "reserved") return { date, reserved: reservations[key].count, limit };
    throw new ApiError(403, `DAILY_IMAGE_LIMIT: Daily image limit reached for your ${plan} plan (${limit} images per UTC day).`);
  }
  return { date, reserved: imageCount, limit };
}

export async function settleImageQuota(userId: string, requestId: string, outputImages: number, date = new Date().toISOString().slice(0, 10)) {
  const key = validRequestId(requestId);
  const doc = await DailyImageUsage.findOne({ userId, date });
  const reservations = doc?.get("reservations") as Record<string, { count: number; status: string }> | undefined;
  const reservation = reservations?.[key];
  if (!reservation || reservation.status !== "reserved") return;
  if (!Number.isSafeInteger(outputImages) || outputImages < 0 || outputImages > reservation.count) {
    throw ApiError.badRequest("Invalid image output count");
  }
  await DailyImageUsage.updateOne(
    { userId, date, [`reservations.${key}.status`]: "reserved" },
    {
      $inc: { reserved: -reservation.count, used: outputImages },
      $set: { [`reservations.${key}.status`]: "settled", [`reservations.${key}.outputImages`]: outputImages },
    },
  );
}

async function releaseImageQuota(userId: string, requestId: string, reservedDate?: string) {
  const key = validRequestId(requestId);
  const date = reservedDate ?? new Date().toISOString().slice(0, 10);
  const doc = await DailyImageUsage.findOne({ userId, date });
  const reservations = doc?.get("reservations") as Record<string, { count: number; status: string }> | undefined;
  const reservation = reservations?.[key];
  if (!reservation || reservation.status !== "reserved") return;
  await DailyImageUsage.updateOne(
    { userId, date, [`reservations.${key}.status`]: "reserved" },
    { $inc: { reserved: -reservation.count }, $set: { [`reservations.${key}.status`]: "released" } },
  );
}

export async function getDailyImageSummary(userId: string, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const [user, usage] = await Promise.all([
    User.findById(userId).select("subscription"),
    DailyImageUsage.findOne({ userId, date }),
  ]);
  if (!user) throw ApiError.notFound("User not found");
  const plan = normalizePlan(user.subscription as string);
  const limit = getImageLimit(plan);
  const used = usage?.get("used") ?? 0;
  const reserved = usage?.get("reserved") ?? 0;
  return { date, used, reserved, limit, remaining: Math.max(0, limit - used - reserved), timezone: "UTC" };
}

export async function getBillingHistory(userId: string, limit = 50) {
  const [transactions, usage] = await Promise.all([
    CreditTransaction.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean(),
    AIUsageLog.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean(),
  ]);
  return { transactions, usage };
}

export async function markUsageUnpriced(userId: string, requestId: string, failureCode: string) {
  await AIUsageLog.updateOne(
    { userId, requestId },
    { $set: { status: "unpriced", failureCode } },
  );
}