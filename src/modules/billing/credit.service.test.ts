import assert from "node:assert/strict";
import test from "node:test";
import { User } from "../user/user.model";
import { AIUsageLog, CreditTransaction, DailyImageUsage } from "./billing.models";
import { getCreditSummary, refundCredits, renewMonthlyCredits, reserveCredits, reserveImageQuota, settleCredits, settleImageQuota } from "./credit.service";

type Restore = () => void;

function stubModel(target: object, key: string, value: unknown): Restore {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
  return () => {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else delete (target as Record<string, unknown>)[key];
  };
}

function createBillingStubs(plan: "starter" | "pro" = "starter", startingBalance = 60_000) {
  const now = new Date();
  const user: Record<string, any> = {
    subscription: plan,
    creditsAvailable: startingBalance,
    creditsReserved: 0,
    creditsDebt: 0,
    creditsUsedThisPeriod: 0,
    monthlyCreditAllowance: startingBalance,
    creditPeriodStartAt: new Date(now.getTime() - 1_000),
    creditPeriodEndAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    creditReservations: {},
  };
  const imageRows = new Map<string, Record<string, any>>();
  const restore: Restore[] = [];
  const query = (value: unknown) => ({ select: async () => value });

  restore.push(stubModel(User, "findById", () => query(user)));
  restore.push(stubModel(User, "findOneAndUpdate", async (filter: Record<string, any>, update: any) => {
    const reservationPath = Object.keys(filter).find((key) => key.startsWith("creditReservations."));
    const requestId = reservationPath?.split(".")[1];

    if (Array.isArray(update)) {
      if (!requestId || user.creditReservations[requestId]?.status !== "reserved") return null;
      const reserved = user.creditReservations[requestId].credits;
      const actual = update[0].$set.creditsUsedThisPeriod.$add[1];
      const availableBefore = user.creditsAvailable + reserved;
      user.creditsAvailable = Math.max(0, availableBefore - actual);
      user.creditsReserved -= reserved;
      user.creditsDebt += Math.max(0, actual - availableBefore);
      user.creditsUsedThisPeriod += actual;
      user.creditReservations[requestId] = { credits: actual, status: "settled" };
      return user;
    }

    if (update.$inc?.creditsReserved < 0) {
      if (!requestId || user.creditReservations[requestId]?.status !== "reserved") return null;
      const amount = user.creditReservations[requestId].credits;
      user.creditsAvailable += amount;
      user.creditsReserved -= amount;
      user.creditReservations[requestId].status = "refunded";
      return user;
    }

    if (update.$inc?.creditsAvailable < 0) {
      const amount = -update.$inc.creditsAvailable;
      if (!requestId || user.creditsAvailable < amount || user.creditReservations[requestId]) return null;
      user.creditsAvailable -= amount;
      user.creditsReserved += amount;
      user.creditReservations[requestId] = update.$set[`creditReservations.${requestId}`];
      return user;
    }

    if (update.$set?.creditPeriodEndAt) {
      if (filter.creditsReserved !== 0 || user.creditsReserved !== 0) return null;
      user.creditPeriodStartAt = update.$set.creditPeriodStartAt;
      user.creditPeriodEndAt = update.$set.creditPeriodEndAt;
      user.monthlyCreditAllowance = update.$set.monthlyCreditAllowance;
      user.creditsAvailable = update.$set.creditsAvailable;
      user.creditsDebt = update.$set.creditsDebt;
      user.creditsUsedThisPeriod = 0;
      return user;
    }
    return null;
  }));

  restore.push(stubModel(CreditTransaction, "updateOne", async () => ({ acknowledged: true })));
  restore.push(stubModel(AIUsageLog, "updateOne", async () => ({ acknowledged: true })));
  restore.push(stubModel(DailyImageUsage, "updateOne", async (filter: Record<string, any>, update: any) => {
    const key = `${filter.userId}:${filter.date}`;
    let row = imageRows.get(key);
    if (!row) {
      row = { userId: filter.userId, date: filter.date, used: 0, reserved: 0, reservations: {} };
      imageRows.set(key, row);
    }
    Object.assign(row.reservations, update.$setOnInsert?.reservations ?? {});
    const reservationKey = Object.keys(update.$set ?? {}).find((path) => path.startsWith("reservations."))?.split(".")[1];
    if (reservationKey && update.$set[`reservations.${reservationKey}.status`] === "settled") {
      row.reserved += update.$inc.reserved;
      row.used += update.$inc.used;
      row.reservations[reservationKey] = { ...row.reservations[reservationKey], status: "settled" };
    } else if (reservationKey && update.$set[`reservations.${reservationKey}.status`] === "released") {
      row.reserved += update.$inc.reserved;
      row.reservations[reservationKey].status = "released";
    }
    return { acknowledged: true };
  }));
  restore.push(stubModel(DailyImageUsage, "findOneAndUpdate", async (filter: Record<string, any>, update: any) => {
    const row = imageRows.get(`${filter.userId}:${filter.date}`)!;
    const reservationKey = Object.keys(update.$set ?? {}).find((path) => path.startsWith("reservations."))?.split(".")[1];
    const requested = update.$inc.reserved;
    if (!reservationKey || row.reservations[reservationKey] || row.used + row.reserved + requested > 5) return null;
    row.reserved += requested;
    row.reservations[reservationKey] = update.$set[`reservations.${reservationKey}`];
    return row;
  }));
  restore.push(stubModel(DailyImageUsage, "findOne", async (filter: Record<string, any>) => {
    const row = imageRows.get(`${filter.userId}:${filter.date}`);
    return row ? { get: (key: string) => row[key] } : null;
  }));

  return { user, imageRows, restore: () => restore.reverse().forEach((fn) => fn()) };
}

test("concurrent reservations cannot spend the same balance twice", async () => {
  const stubs = createBillingStubs("starter", 60_000);
  try {
    const results = await Promise.allSettled([
      reserveCredits({ userId: "test-user", requestId: "concurrent-request-a", modelId: "gpt-5.6-luna", operation: "chat", estimatedCredits: 40_000 }),
      reserveCredits({ userId: "test-user", requestId: "concurrent-request-b", modelId: "gpt-5.6-luna", operation: "chat", estimatedCredits: 40_000 }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal(stubs.user.creditsAvailable, 20_000);
    assert.equal(stubs.user.creditsReserved, 40_000);
  } finally {
    stubs.restore();
  }
});

test("insufficient credits are rejected before provider execution", async () => {
  const stubs = createBillingStubs("starter", 100);
  try {
    await assert.rejects(
      reserveCredits({ userId: "test-user", requestId: "insufficient-request", modelId: "gpt-5.6-luna", operation: "chat", estimatedCredits: 101 }),
      (error: unknown) => error instanceof Error && error.message.startsWith("INSUFFICIENT_CREDITS:"),
    );
    assert.equal(stubs.user.creditsAvailable, 100);
    assert.equal(stubs.user.creditsReserved, 0);
  } finally {
    stubs.restore();
  }
});

test("settlement releases unused reservation and charges actual provider usage", async () => {
  const stubs = createBillingStubs("starter", 60_000);
  try {
    await reserveCredits({ userId: "test-user", requestId: "settle-request", modelId: "gpt-5.6-luna", operation: "chat", estimatedCredits: 1_000 });
    const result = await settleCredits("test-user", "settle-request", { inputTokens: 1_000, outputTokens: 1_000 });
    assert.equal(result.creditsCharged, 14);
    assert.equal(stubs.user.creditsReserved, 0);
    assert.equal(stubs.user.creditsUsedThisPeriod, 14);
    assert.equal(stubs.user.creditsAvailable, 59_986);
  } finally {
    stubs.restore();
  }
});

test("credit summary reconciles stale period usage against the available balance", async () => {
  const stubs = createBillingStubs("pro", 120_000);
  try {
    stubs.user.creditsAvailable = 119_139;
    stubs.user.creditsUsedThisPeriod = 0;

    const summary = await getCreditSummary("test-user");

    assert.equal(summary.usedThisPeriod, 861);
    assert.equal(summary.available, 119_139);
    assert.equal(summary.allowance, 120_000);
  } finally {
    stubs.restore();
  }
});

test("credit summary excludes unsettled reservations from consumed usage", async () => {
  const stubs = createBillingStubs("pro", 120_000);
  try {
    stubs.user.creditsAvailable = 119_000;
    stubs.user.creditsReserved = 1_000;
    stubs.user.creditsUsedThisPeriod = 0;

    const summary = await getCreditSummary("test-user");

    assert.equal(summary.usedThisPeriod, 0);
    assert.equal(summary.available, 119_000);
    assert.equal(summary.reserved, 1_000);
  } finally {
    stubs.restore();
  }
});

test("failed requests refund their reservation idempotently", async () => {
  const stubs = createBillingStubs("starter", 10_000);
  try {
    await reserveCredits({ userId: "test-user", requestId: "failed-request", modelId: "gpt-5.6-luna", operation: "chat", estimatedCredits: 1_000 });
    assert.equal((await refundCredits("test-user", "failed-request", "provider-failure")).refunded, true);
    assert.equal((await refundCredits("test-user", "failed-request", "provider-failure")).refunded, false);
    assert.equal(stubs.user.creditsAvailable, 10_000);
    assert.equal(stubs.user.creditsReserved, 0);
  } finally {
    stubs.restore();
  }
});

test("monthly renewal is boundary-based and grants one allowance per elapsed period", async () => {
  const stubs = createBillingStubs("pro", 0);
  try {
    const expiredBoundary = new Date(Date.now() - 1_000);
    stubs.user.creditPeriodEndAt = expiredBoundary;
    stubs.user.monthlyCreditAllowance = 120_000;
    const renewed = await renewMonthlyCredits("test-user", new Date());
    assert.equal(renewed.creditsAvailable, 120_000);
    assert.equal(stubs.user.creditsUsedThisPeriod, 0);
    assert.equal(new Date(stubs.user.creditPeriodStartAt).getTime(), expiredBoundary.getTime());
  } finally {
    stubs.restore();
  }
});

test("daily image reservations are atomic and successful outputs count against UTC quota", async () => {
  const stubs = createBillingStubs("starter", 60_000);
  try {
    const results = await Promise.allSettled([
      reserveImageQuota("test-user", "image-request-a", 4),
      reserveImageQuota("test-user", "image-request-b", 4),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const row = [...stubs.imageRows.values()][0]!;
    const winner = Object.keys(row.reservations)[0]!;
    await settleImageQuota("test-user", winner, 1, row.date);
    assert.equal(row.used, 1);
    assert.equal(row.reserved, 0);
  } finally {
    stubs.restore();
  }
});