import type { CookieOptions, Request, Response } from "express";
import { sendSuccess } from "../../utils/ApiResponse";
import { ApiError } from "../../utils/ApiError";
import { isProduction, env } from "../../config/env";
import { parseDurationToMs } from "../../utils/duration";
import * as authService from "./auth.service";
import * as userService from "../user/user.service";

const REFRESH_COOKIE_NAME = "refreshToken";

function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    maxAge: parseDurationToMs(env.JWT_REFRESH_EXPIRES_IN),
    path: "/",
  };
}

export async function registerHandler(req: Request, res: Response) {
  const { user, accessToken, refreshToken } = await authService.register(req.body);
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
  sendSuccess(res, 201, "Registration successful", { user, accessToken });
}

export async function loginHandler(req: Request, res: Response) {
  const { user, accessToken, refreshToken } = await authService.login(req.body);
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
  sendSuccess(res, 200, "Login successful", { user, accessToken });
}

export async function logoutHandler(_req: Request, res: Response) {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: "/" });
  sendSuccess(res, 200, "Logout successful");
}

export async function meHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();
  const user = await userService.getUserById(req.user.id);
  sendSuccess(res, 200, "Current user fetched successfully", { user });
}

export async function refreshHandler(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  if (!token) throw ApiError.unauthorized("Refresh token missing");

  const { accessToken, refreshToken } = await authService.refresh(token);
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
  sendSuccess(res, 200, "Token refreshed successfully", { accessToken });
}
