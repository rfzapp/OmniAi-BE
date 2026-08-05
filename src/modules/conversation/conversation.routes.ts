import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { conversationIdParamSchema } from "./conversation.validation";
import { deleteConversationHandler, listConversationsHandler, listMessagesHandler } from "./conversation.controller";

const router = Router();

router.use(authMiddleware);

router.get("/", listConversationsHandler);
router.get("/:id/messages", validate({ params: conversationIdParamSchema }), listMessagesHandler);
router.delete("/:id", validate({ params: conversationIdParamSchema }), deleteConversationHandler);

export default router;
