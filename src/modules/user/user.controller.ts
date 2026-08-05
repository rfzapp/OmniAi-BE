import type { Request, Response } from "express";
import { sendSuccess } from "../../utils/ApiResponse";
import { ApiError } from "../../utils/ApiError";
import * as userService from "./user.service";

export async function updateProfileHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();
  const user = await userService.updateProfile(req.user.id, req.body);
  sendSuccess(res, 200, "Profile updated successfully", { user });
}

export async function changePasswordHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();
  await userService.changePassword(req.user.id, req.body);
  sendSuccess(res, 200, "Password changed successfully");
}

export async function deleteAccountHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();
  await userService.deleteAccount(req.user.id);
  sendSuccess(res, 200, "Account deleted successfully");
}
