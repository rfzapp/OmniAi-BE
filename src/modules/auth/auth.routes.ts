import { Router } from "express";
import passport from "passport";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema } from "./auth.validation";
import {
  loginHandler, logoutHandler, meHandler, refreshHandler, registerHandler,
  forgotPasswordHandler, resetPasswordHandler,
} from "./auth.controller";
import { issueGoogleTokens } from "./google.strategy";
import { env, isProduction } from "../../config/env";
import type { Request, Response } from "express";

const router = Router();

router.post("/register", validate({ body: registerSchema }), registerHandler);
router.post("/login", validate({ body: loginSchema }), loginHandler);
router.post("/logout", logoutHandler);
router.post("/refresh", refreshHandler);
router.get("/me", authMiddleware, meHandler);
router.post("/forgot-password", validate({ body: forgotPasswordSchema }), forgotPasswordHandler);
router.post("/reset-password", validate({ body: resetPasswordSchema }), resetPasswordHandler);

// ─── Google OAuth ─────────────────────────────────────────────────────────────

// Step 1: redirect user to Google consent screen
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"], session: false }),
);

// Step 2: Google redirects back here with a code
router.get(
  "/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: `${env.FRONTEND_URL.split(",")[0]}/login?error=google_failed` }),
  (req: Request, res: Response) => {
    const user = req.user as any;
    if (!user) {
      res.redirect(`${env.FRONTEND_URL.split(",")[0]}/login?error=google_failed`);
      return;
    }

    const { accessToken, refreshToken } = issueGoogleTokens({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    // Set httpOnly refresh cookie
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    // Redirect to frontend with tokens in query so the client can store them
    const frontendOrigin = env.FRONTEND_URL.split(",")[0]!.trim();
    res.redirect(
      `${frontendOrigin}/auth/callback?accessToken=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken)}`,
    );
  },
);

export default router;
