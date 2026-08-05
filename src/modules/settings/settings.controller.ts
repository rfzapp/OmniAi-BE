import type { Request, Response } from "express";
import { sendSuccess } from "../../utils/ApiResponse";
import { ApiError } from "../../utils/ApiError";
import * as userService from "../user/user.service";

export async function getSettingsHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();
  const preferences = await userService.getPreferences(req.user.id);
  sendSuccess(res, 200, "Settings fetched successfully", { preferences });
}

export async function updateSettingsHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();
  const preferences = await userService.updatePreferences(req.user.id, req.body);
  sendSuccess(res, 200, "Settings updated successfully", { preferences });
}
