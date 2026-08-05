import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError";
import { verifyAccessToken } from "../utils/jwt";
import { User } from "../modules/user/user.model";

export async function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

    if (!token) {
      throw ApiError.unauthorized("Authentication token missing");
    }

    const payload = verifyAccessToken(token);

    const user = await User.findById(payload.id).select("_id email role");
    if (!user) {
      throw ApiError.unauthorized("User no longer exists");
    }

    req.user = { id: user.id, email: user.email, role: user.role };
    next();
  } catch {
    next(ApiError.unauthorized("Invalid or expired token"));
  }
}
