import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { loginSchema, registerSchema } from "./auth.validation";
import { loginHandler, logoutHandler, meHandler, refreshHandler, registerHandler } from "./auth.controller";

const router = Router();

router.post("/register", validate({ body: registerSchema }), registerHandler);
router.post("/login", validate({ body: loginSchema }), loginHandler);
router.post("/logout", logoutHandler);
router.post("/refresh", refreshHandler);
router.get("/me", authMiddleware, meHandler);

export default router;
