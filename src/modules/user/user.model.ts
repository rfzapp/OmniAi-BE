import { Schema, model, type HydratedDocument, type Model } from "mongoose";
import bcrypt from "bcrypt";
import type { AuthProvider, ImagePlan, SubscriptionPlan, UserRole } from "../../types";

export interface INotificationPrefs {
  emailUpdates: boolean;
  productAnnouncements: boolean;
  chatMentions: boolean;
}

export interface IPrivacyPrefs {
  improveModel: boolean;
  shareUsageAnalytics: boolean;
}

export interface IApiKeyEntry {
  provider: string;
  maskedKey: string;
  encryptedKey: string;
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
  imagePlan: ImagePlan;
  promptCount: number;
  promptCount24h: number;
  attachmentCount24h: number;
  lastPromptResetAt: Date;
  emailVerified: boolean;
  preferences: {
    defaultModel: string;
    theme: "light" | "dark";
    connectedModelIds: string[];
    notifications: INotificationPrefs;
    privacy: IPrivacyPrefs;
  };
  apiKeys: IApiKeyEntry[];
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
      enum: ["free", "standard", "pro", "ultra_pro"],
      default: "free",
    },
    imagePlan: {
      type: String,
      enum: ["none", "basic", "pro"],
      default: "none",
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
    lastPromptResetAt: {
      type: Date,
      default: Date.now,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    preferences: {
      defaultModel: { type: String, default: "gpt-4.1-mini" },
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
    },
    apiKeys: {
      type: [
        {
          provider: { type: String, required: true },
          maskedKey: { type: String, required: true },
          encryptedKey: { type: String, required: true, select: false },
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
  transform: (_doc, ret) => {
    delete (ret as { password?: string }).password;
    delete (ret as { __v?: number }).__v;
    delete (ret as { _id?: unknown })._id;
    const apiKeys = (ret as { apiKeys?: { encryptedKey?: string }[] }).apiKeys;
    apiKeys?.forEach((entry) => delete entry.encryptedKey);
    return ret;
  },
});

export type UserDocument = HydratedDocument<IUser, IUserMethods>;

export const User = model<IUser, UserModel>("User", userSchema);
