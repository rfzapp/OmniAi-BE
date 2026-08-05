import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { chatSchema } from "./ai.validation";
import { chatHandler } from "./ai.controller";

const router = Router();

router.use(authMiddleware);
router.post("/chat", validate({ body: chatSchema }), chatHandler);

export default router;
