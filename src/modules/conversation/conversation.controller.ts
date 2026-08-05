import type { Request, Response } from "express";
import { sendSuccess } from "../../utils/ApiResponse";
import { ApiError } from "../../utils/ApiError";
import * as conversationService from "./conversation.service";

export async function listConversationsHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();
  const conversations = await conversationService.listConversations(req.user.id);
  sendSuccess(res, 200, "Conversations fetched successfully", { conversations });
}

export async function listMessagesHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();
  const conversationId = req.params["id"] as string;
  const messages = await conversationService.listMessages(req.user.id, conversationId);
  sendSuccess(res, 200, "Messages fetched successfully", { messages });
}

export async function deleteConversationHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();
  const conversationId = req.params["id"] as string;
  await conversationService.deleteConversation(req.user.id, conversationId);
  sendSuccess(res, 200, "Conversation deleted successfully");
}
