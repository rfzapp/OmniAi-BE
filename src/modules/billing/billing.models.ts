import { Schema, model, models, type Model, type Types } from "mongoose";

const creditTransactionSchema = new Schema<ICreditTransaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    requestId: { type: String, required: true },
    idempotencyKey: { type: String, required: true, unique: true },
    kind: { type: String, enum: ["reserve", "charge", "release", "refund", "renewal"], required: true },
    credits: { type: Number, required: true, min: 0 },
    providerCostUsd: { type: Number, min: 0 },
    balanceAfter: { type: Number, min: 0 },
    model: { type: String },
    pricingVersion: { type: String },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

creditTransactionSchema.index({ userId: 1, requestId: 1, kind: 1 }, { unique: true });

export interface ICreditTransaction {
  userId: Types.ObjectId;
  requestId: string;
  idempotencyKey: string;
  kind: "reserve" | "charge" | "release" | "refund" | "renewal";
  credits: number;
  providerCostUsd?: number;
  balanceAfter?: number;
  model?: string;
  pricingVersion?: string;
  metadata?: Record<string, unknown>;
}

export const CreditTransaction = (models.CreditTransaction as Model<ICreditTransaction> | undefined)
  ?? model<ICreditTransaction>("CreditTransaction", creditTransactionSchema);

const usageLogSchema = new Schema<IAIUsageLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    requestId: { type: String, required: true },
    operation: { type: String, enum: ["chat", "image-generation", "image-edit"], required: true },
    provider: { type: String, required: true },
    model: { type: String, required: true },
    pricingVersion: { type: String, required: true },
    status: { type: String, enum: ["reserved", "settled", "refunded", "failed", "unpriced"], required: true },
    usage: { type: Schema.Types.Mixed },
    providerCostUsd: { type: Number, min: 0 },
    creditsCharged: { type: Number, min: 0 },
    reservationCredits: { type: Number, min: 0 },
    failureCode: { type: String },
  },
  { timestamps: true },
);

usageLogSchema.index({ userId: 1, requestId: 1 }, { unique: true });
usageLogSchema.index({ userId: 1, createdAt: -1 });

export interface IAIUsageLog {
  userId: Types.ObjectId;
  requestId: string;
  operation: "chat" | "image-generation" | "image-edit";
  provider: string;
  model: string;
  pricingVersion: string;
  status: "reserved" | "settled" | "refunded" | "failed" | "unpriced";
  usage?: Record<string, unknown>;
  providerCostUsd?: number;
  creditsCharged?: number;
  reservationCredits?: number;
  failureCode?: string;
}

export const AIUsageLog = (models.AIUsageLog as Model<IAIUsageLog> | undefined)
  ?? model<IAIUsageLog>("AIUsageLog", usageLogSchema);

interface IDailyImageUsage {
  userId: Types.ObjectId;
  date: string;
  used: number;
  reserved: number;
  reservations: Record<string, { count: number; status: string }>;
}

const dailyImageUsageSchema = new Schema<IDailyImageUsage>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    date: { type: String, required: true },
    used: { type: Number, default: 0, min: 0 },
    reserved: { type: Number, default: 0, min: 0 },
    reservations: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

dailyImageUsageSchema.index({ userId: 1, date: 1 }, { unique: true });

export const DailyImageUsage = (models.DailyImageUsage as Model<IDailyImageUsage> | undefined)
  ?? model<IDailyImageUsage>("DailyImageUsage", dailyImageUsageSchema);