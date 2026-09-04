import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { changePasswordSchema, updateProfileSchema } from "./user.validation";
import { changePasswordHandler, deleteAccountHandler, updateProfileHandler, getUsageHandler } from "./user.controller";

const router = Router();

router.use(authMiddleware);

router.put("/profile", validate({ body: updateProfileSchema }), updateProfileHandler);
router.put("/change-password", validate({ body: changePasswordSchema }), changePasswordHandler);
router.delete("/delete", deleteAccountHandler);
router.get("/usage", getUsageHandler);

export default router;
