import type { Request, Response } from "express";
import { sendSuccess } from "../../utils/ApiResponse";
import { ApiError } from "../../utils/ApiError";
import { encrypt, maskKey } from "../../utils/encryption";
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

export async function listApiKeysHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();
  const apiKeys = await userService.listApiKeys(req.user.id);
  sendSuccess(res, 200, "API keys fetched successfully", { apiKeys });
}

export async function addApiKeyHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();
  const { provider, apiKey } = req.body as { provider: string; apiKey: string };
  const maskedKey = maskKey(apiKey);
  const encryptedKey = encrypt(apiKey);
  const saved = await userService.addApiKey(req.user.id, provider, maskedKey, encryptedKey);
  sendSuccess(res, 201, "API key saved successfully", { apiKey: saved });
}

export async function deleteApiKeyHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();
  const provider = req.params["provider"] as string;
  await userService.deleteApiKey(req.user.id, provider);
  sendSuccess(res, 200, "API key removed successfully");
}
