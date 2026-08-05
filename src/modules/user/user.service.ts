import { ApiError } from "../../utils/ApiError";
import { User } from "./user.model";
import type { ChangePasswordInput, UpdateProfileInput } from "./user.validation";

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

export async function updatePreferences(userId: string, input: Partial<{ defaultModel: string; theme: "light" | "dark" }>) {
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: { ...(input.defaultModel && { "preferences.defaultModel": input.defaultModel }), ...(input.theme && { "preferences.theme": input.theme }) } },
    { new: true, runValidators: true },
  ).select("preferences");
  if (!user) throw ApiError.notFound("User not found");
  return user.preferences;
}
