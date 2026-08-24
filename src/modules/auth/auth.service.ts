import crypto from "crypto";
import { ApiError } from "../../utils/ApiError";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../utils/jwt";
import { sendPasswordResetEmail } from "../../utils/email";
import { User } from "../user/user.model";
import { env } from "../../config/env";
import type { LoginInput, RegisterInput } from "./auth.validation";

function issueTokens(user: { id: string; email: string; role: "user" | "admin" }) {
  const payload = { id: user.id, email: user.email, role: user.role };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
  };
}

export async function register(input: RegisterInput) {
  const existing = await User.findOne({ email: input.email });
  if (existing) throw ApiError.conflict("Email is already registered");

  const user = await User.create({
    fullName: input.fullName,
    email: input.email,
    password: input.password,
  });

  const tokens = issueTokens({ id: user.id, email: user.email, role: user.role });
  return { user, ...tokens };
}

export async function login(input: LoginInput) {
  const user = await User.findOne({ email: input.email }).select("+password");
  if (!user) throw ApiError.unauthorized("Invalid email or password");

  const isMatch = await user.comparePassword(input.password);
  if (!isMatch) throw ApiError.unauthorized("Invalid email or password");

  const tokens = issueTokens({ id: user.id, email: user.email, role: user.role });
  return { user, ...tokens };
}

export async function refresh(refreshToken: string) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized("Invalid or expired refresh token");
  }

  const user = await User.findById(payload.id);
  if (!user) throw ApiError.unauthorized("User no longer exists");

  return issueTokens({ id: user.id, email: user.email, role: user.role });
}

export async function forgotPassword(email: string): Promise<void> {
  const user = await User.findOne({ email }).select("+passwordResetToken +passwordResetExpiresAt");
  // Always respond with success to prevent email enumeration
  if (!user) return;

  // Generate a cryptographically secure token
  const rawToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

  user.passwordResetToken = hashedToken;
  user.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${rawToken}`;

  try {
    await sendPasswordResetEmail(user.email, resetUrl);
  } catch (err) {
    console.error("[forgotPassword] Failed to send reset email:", err);
    // Roll back token if email fails so user can retry
    user.passwordResetToken = null;
    user.passwordResetExpiresAt = null;
    await user.save({ validateBeforeSave: false });
    throw ApiError.internal("Failed to send password reset email. Please try again later.");
  }
}

export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpiresAt: { $gt: new Date() },
  }).select("+passwordResetToken +passwordResetExpiresAt +password");

  if (!user) {
    throw new ApiError(400, "Password reset token is invalid or has expired.");
  }

  user.password = newPassword;
  user.passwordResetToken = null;
  user.passwordResetExpiresAt = null;
  await user.save();
}
