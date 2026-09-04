import { Schema, model, type HydratedDocument, type Model } from "mongoose";
import bcrypt from "bcrypt";
import type { AuthProvider, SubscriptionPlan, UserRole } from "../../types";

// ─── Canonical subscription enum ─────────────────────────────────────────────
// The single source of truth for plans. Legacy imagePlan-era values that may
// still exist in old documents are normalized at the read boundary below so
// backend logic and API responses only ever see canonical values.
const SUBSCRIPTION_PLANS = ["free", "starter", "pro", "extreme", "ultra"] as const;

const LEGACY_PLAN_MAP: Record<string, SubscriptionPlan> = {
  standard:  "starter",
  ultra_pro: "ultra",
};

function normalizeSubscription(value: unknown): SubscriptionPlan {
  if (typeof value !== "string" || !value) return "free";
  return LEGACY_PLAN_MAP[value] ?? (value as SubscriptionPlan);
}

export interface INotificationPrefs {
  emailUpdates: boolean;
  productAnnouncements: boolean;
  chatMentions: boolean;
}

export interface IPrivacyPrefs {
  improveModel: boolean;
  shareUsageAnalytics: boolean;
}

export interface IMemoryEntry {
  id: string;
  content: string;
  createdAt: Date;
}


// Mirrors the frontend's AI_MODELS catalog (src/features/models/data/models.ts) —
// the default "everything connected" state for a new user.
const DEFAULT_CONNECTED_MODEL_IDS = [
  "gpt-omni",
  "claude-omni",
  "gemini-omni",
  "deepseek-omni",
  "kimi-omni",
  "grok-omni",
  "llama-omni",
  "mistral-omni",
  "qwen-omni",
];

export interface IUser {
  fullName: string;
  email: string;
  password: string;
  avatar: string;
  provider: AuthProvider;
  role: UserRole;
  subscription: SubscriptionPlan;
  promptCount: number;
  promptCount24h: number;
  attachmentCount24h: number;
  imageCount24h: number;
  lastImageResetAt: Date;
  lastPromptResetAt: Date;
  emailVerified: boolean;
  passwordResetToken: string | null;
  passwordResetExpiresAt: Date | null;
  preferences: {
    defaultModel: string;
    theme: "light" | "dark";
    connectedModelIds: string[];
    notifications: INotificationPrefs;
    privacy: IPrivacyPrefs;
    memoryEnabled: boolean;
  };
  memories: IMemoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserMethods {
  comparePassword(candidate: string): Promise<boolean>;
}

type UserModel = Model<IUser, object, IUserMethods>;

const userSchema = new Schema<IUser, UserModel, IUserMethods>(
  {
    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      select: false,
    },
    avatar: {
      type: String,
      default: "",
    },
    provider: {
      type: String,
      enum: ["local", "google", "github"],
      default: "local",
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    subscription: {
      type: String,
      enum: SUBSCRIPTION_PLANS,
      default: "free",
      // Normalize legacy DB values ("standard" → "starter", "ultra_pro" → "ultra")
      // on every read — document access AND toJSON output.
      get: normalizeSubscription,
    },
    promptCount: {
      type: Number,
      default: 0,
    },
    promptCount24h: {
      type: Number,
      default: 0,
    },
    attachmentCount24h: {
      type: Number,
      default: 0,
    },
    imageCount24h: {
      type: Number,
      default: 0,
    },
    lastImageResetAt: {
      type: Date,
      default: Date.now,
    },
    lastPromptResetAt: {
      type: Date,
      default: Date.now,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    passwordResetToken: {
      type: String,
      default: null,
      select: false,
    },
    passwordResetExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
    preferences: {
      defaultModel: { type: String, default: "gpt-5.6-luna" },
      theme: { type: String, enum: ["light", "dark"], default: "light" },
      connectedModelIds: { type: [String], default: DEFAULT_CONNECTED_MODEL_IDS },
      notifications: {
        emailUpdates: { type: Boolean, default: true },
        productAnnouncements: { type: Boolean, default: false },
        chatMentions: { type: Boolean, default: true },
      },
      privacy: {
        improveModel: { type: Boolean, default: false },
        shareUsageAnalytics: { type: Boolean, default: true },
      },
      memoryEnabled: { type: Boolean, default: true },
    },
    memories: {
      type: [
        {
          content: { type: String, required: true, trim: true },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

userSchema.pre("save", async function preSave(this: HydratedDocument<IUser, IUserMethods>) {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = function comparePassword(candidate: string) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.set("toJSON", {
  virtuals: true,
  getters: true, // apply schema getters (subscription normalization) in API responses
  transform: (_doc, ret) => {
    delete (ret as { password?: string }).password;
    delete (ret as { __v?: number }).__v;
    delete (ret as { _id?: unknown })._id;
    if (Array.isArray(ret.memories)) {
      ret.memories = ret.memories.map((m: any) => ({
        id: m._id ? String(m._id) : String(m.id),
        content: m.content,
        createdAt: m.createdAt,
      }));
    }
    return ret;
  },
});

export type UserDocument = HydratedDocument<IUser, IUserMethods>;

export const User = model<IUser, UserModel>("User", userSchema);
