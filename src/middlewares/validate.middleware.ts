import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ApiError } from "../utils/ApiError";

interface ValidationSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        return next(ApiError.badRequest("Validation failed", result.error.issues));
      }
      req.body = result.data;
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        return next(ApiError.badRequest("Validation failed", result.error.issues));
      }
      req.params = result.data as typeof req.params;
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        return next(ApiError.badRequest("Validation failed", result.error.issues));
      }
    }

    next();
  };
}
