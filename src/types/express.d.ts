import type { AuthUser } from "./index";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      files?: Express.Multer.File[];
    }
  }
}

export {};
