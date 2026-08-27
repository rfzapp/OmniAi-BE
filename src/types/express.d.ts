import type { AuthUser } from "./index";

declare global {
  namespace Express {
    // Extend passport's User interface to match our AuthUser shape
    // so req.user.id is accessible after passport.authenticate()
    interface User extends AuthUser {}

    interface Request {
      user?: AuthUser;
      files?: Express.Multer.File[];
    }
  }
}

export {};
