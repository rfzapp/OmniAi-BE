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

export async function listApiKeys(userId: string) {
  const user = await User.findById(userId).select("apiKeys");
  if (!user) throw ApiError.notFound("User not found");
  return user.apiKeys.map((entry) => ({
    provider: entry.provider,
    maskedKey: entry.maskedKey,
    createdAt: entry.createdAt,
  }));
}

export async function addApiKey(userId: string, provider: string, maskedKey: string, encryptedKey: string) {
  const createdAt = new Date();
  // One key per provider — drop any existing entry before adding the new one.
  await User.findByIdAndUpdate(userId, { $pull: { apiKeys: { provider } } });
  const user = await User.findByIdAndUpdate(
    userId,
    { $push: { apiKeys: { provider, maskedKey, encryptedKey, createdAt } } },
    { new: true, runValidators: true },
  ).select("apiKeys");
  if (!user) throw ApiError.notFound("User not found");
  return { provider, maskedKey, createdAt };
}

export async function deleteApiKey(userId: string, provider: string) {
  const user = await User.findByIdAndUpdate(userId, { $pull: { apiKeys: { provider } } }, { new: true }).select(
    "apiKeys",
  );
  if (!user) throw ApiError.notFound("User not found");
}

/** Encrypted key for one provider, or null if the user hasn't connected one.
 * Uses `+apiKeys.encryptedKey` alone (no other fields listed) — Mongoose
 * rejects combining a plain-inclusion field with a `+nested.path`
 * force-include under the same array ("path collision"), so this relies on
 * the normal default-projection behavior (everything except select:false
 * fields) instead of trying to name specific fields alongside it. */
export async function getEncryptedApiKey(userId: string, provider: string): Promise<string | null> {
  const user = await User.findById(userId).select("+apiKeys.encryptedKey");
  if (!user) return null;
  return user.apiKeys.find((entry) => entry.provider === provider)?.encryptedKey ?? null;
}
