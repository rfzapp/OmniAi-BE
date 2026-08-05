import { Schema, model, type HydratedDocument, type Model } from "mongoose";
import bcrypt from "bcrypt";
import type { AuthProvider, SubscriptionPlan, UserRole } from "../../types";

export interface IUser {
  fullName: string;
  email: string;
  password: string;
  avatar: string;
  provider: AuthProvider;
  role: UserRole;
  subscription: SubscriptionPlan;
  promptCount: number;
  emailVerified: boolean;
  preferences: {
    defaultModel: string;
    theme: "light" | "dark";
  };
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
      enum: ["free", "pro", "enterprise"],
      default: "free",
    },
    promptCount: {
      type: Number,
      default: 0,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    preferences: {
      defaultModel: { type: String, default: "gpt-4.1-mini" },
      theme: { type: String, enum: ["light", "dark"], default: "light" },
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
    return ret;
  },
});

export type UserDocument = HydratedDocument<IUser, IUserMethods>;

export const User = model<IUser, UserModel>("User", userSchema);
