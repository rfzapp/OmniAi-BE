import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema } from "./auth.validation";
import {
  loginHandler, logoutHandler, meHandler, refreshHandler, registerHandler,
  forgotPasswordHandler, resetPasswordHandler,
} from "./auth.controller";

const router = Router();

router.post("/register", validate({ body: registerSchema }), registerHandler);
router.post("/login", validate({ body: loginSchema }), loginHandler);
router.post("/logout", logoutHandler);
router.post("/refresh", refreshHandler);
router.get("/me", authMiddleware, meHandler);
router.post("/forgot-password", validate({ body: forgotPasswordSchema }), forgotPasswordHandler);
router.post("/reset-password", validate({ body: resetPasswordSchema }), resetPasswordHandler);

export default router;
