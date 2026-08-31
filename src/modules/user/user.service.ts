import { ApiError } from "../../utils/ApiError";
import { User } from "./user.model";
import type { ChangePasswordInput, UpdateProfileInput } from "./user.validation";
import type { UpdateSettingsInput } from "../settings/settings.validation";

export async function getUserById(userId: string) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound("User not found");
  return user;
}

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  const user = await User.findByIdAndUpdate(userId, { $set: input }, { new: true, runValidators: true });
  if (!user) throw ApiError.notFound("User not found");
  return user;
}

export async function changePassword(userId: string, input: ChangePasswordInput) {
  const user = await User.findById(userId).select("+password");
  if (!user) throw ApiError.notFound("User not found");

  const isMatch = await user.comparePassword(input.currentPassword);
  if (!isMatch) throw ApiError.badRequest("Current password is incorrect");

  user.password = input.newPassword;
  await user.save();
}

export async function deleteAccount(userId: string) {
  const user = await User.findByIdAndDelete(userId);
  if (!user) throw ApiError.notFound("User not found");
}

export async function getPreferences(userId: string) {
  const user = await User.findById(userId).select("preferences");
  if (!user) throw ApiError.notFound("User not found");
  return user.preferences;
}

export async function updatePreferences(userId: string, input: UpdateSettingsInput) {
  const setOps: Record<string, unknown> = {};

  if (input.defaultModel !== undefined) setOps["preferences.defaultModel"] = input.defaultModel;
  if (input.theme !== undefined) setOps["preferences.theme"] = input.theme;
  if (input.connectedModelIds !== undefined) setOps["preferences.connectedModelIds"] = input.connectedModelIds;

  if (input.notifications) {
    for (const [key, value] of Object.entries(input.notifications)) {
      if (value !== undefined) setOps[`preferences.notifications.${key}`] = value;
    }
  }
  if (input.privacy) {
    for (const [key, value] of Object.entries(input.privacy)) {
      if (value !== undefined) setOps[`preferences.privacy.${key}`] = value;
    }
  }

  const user = await User.findByIdAndUpdate(userId, { $set: setOps }, { new: true, runValidators: true }).select(
    "preferences",
  );
  if (!user) throw ApiError.notFound("User not found");
  return user.preferences;
}
