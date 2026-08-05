import type { NextFunction, Request, Response } from "express";
import { MongooseError } from "mongoose";
import { ApiError } from "../utils/ApiError";
import { isProduction } from "../config/env";

interface MongoDuplicateKeyError {
  code: number;
  keyValue?: Record<string, unknown>;
}

function isDuplicateKeyError(err: unknown): err is MongoDuplicateKeyError {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === 11000;
}

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  let statusCode = 500;
  let message = "Internal server error";
  let errors: unknown;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
    errors = err.errors;
  } else if (isDuplicateKeyError(err)) {
    statusCode = 409;
    const field = err.keyValue ? Object.keys(err.keyValue)[0] : "field";
    message = `${field} already in use`;
  } else if (err instanceof MongooseError) {
    statusCode = 400;
    message = err.message;
  } else if (err instanceof Error && err.name === "JsonWebTokenError") {
    statusCode = 401;
    message = "Invalid token";
  } else if (err instanceof Error && err.name === "TokenExpiredError") {
    statusCode = 401;
    message = "Token expired";
  } else if (err instanceof Error) {
    message = isProduction ? message : err.message;
  }

  if (!isProduction && err instanceof Error) {
    console.error(err.stack ?? err.message);
  }

  res.status(statusCode).json({
    success: false,
    message,
    error: errors ?? undefined,
  });
}
