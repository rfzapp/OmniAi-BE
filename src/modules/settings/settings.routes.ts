import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { updateSettingsSchema } from "./settings.validation";
import { getSettingsHandler, updateSettingsHandler } from "./settings.controller";

const router = Router();

router.use(authMiddleware);

router.get("/", getSettingsHandler);
router.put("/", validate({ body: updateSettingsSchema }), updateSettingsHandler);

export default router;
