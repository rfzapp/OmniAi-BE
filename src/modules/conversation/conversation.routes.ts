import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { conversationIdParamSchema, pinConversationBodySchema } from "./conversation.validation";
import {
  deleteConversationHandler,
  listConversationsHandler,
  listMessagesHandler,
  shareConversationHandler,
  unshareConversationHandler,
  getSharedConversationHandler,
  pinConversationHandler,
} from "./conversation.controller";

const router = Router();

// Public route — no auth needed to view a shared conversation
router.get("/shared/:token", getSharedConversationHandler);

router.use(authMiddleware);

router.get("/", listConversationsHandler);
router.get("/:id/messages", validate({ params: conversationIdParamSchema }), listMessagesHandler);
router.delete("/:id", validate({ params: conversationIdParamSchema }), deleteConversationHandler);
router.post("/:id/share", validate({ params: conversationIdParamSchema }), shareConversationHandler);
router.delete("/:id/share", validate({ params: conversationIdParamSchema }), unshareConversationHandler);
router.patch("/:id/pin", validate({ params: conversationIdParamSchema, body: pinConversationBodySchema }), pinConversationHandler);

export default router;
