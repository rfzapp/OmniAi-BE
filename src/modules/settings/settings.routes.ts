import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { addApiKeySchema, apiKeyProviderParamSchema, updateSettingsSchema } from "./settings.validation";
import {
  addApiKeyHandler,
  deleteApiKeyHandler,
  getSettingsHandler,
  listApiKeysHandler,
  updateSettingsHandler,
} from "./settings.controller";

const router = Router();

router.use(authMiddleware);

router.get("/", getSettingsHandler);
router.put("/", validate({ body: updateSettingsSchema }), updateSettingsHandler);

router.get("/api-keys", listApiKeysHandler);
router.post("/api-keys", validate({ body: addApiKeySchema }), addApiKeyHandler);
router.delete("/api-keys/:provider", validate({ params: apiKeyProviderParamSchema }), deleteApiKeyHandler);

export default router;
