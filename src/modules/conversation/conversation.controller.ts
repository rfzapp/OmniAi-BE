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

export async function shareConversationHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();
  const conversationId = req.params["id"] as string;
  const conversation = await conversationService.shareConversation(req.user.id, conversationId);
  sendSuccess(res, 200, "Conversation shared successfully", { shareToken: conversation.shareToken });
}

export async function unshareConversationHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();
  const conversationId = req.params["id"] as string;
  await conversationService.unshareConversation(req.user.id, conversationId);
  sendSuccess(res, 200, "Conversation unshared successfully");
}

export async function pinConversationHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();
  const conversationId = req.params["id"] as string;
  const { isPinned } = req.body;
  const conversation = await conversationService.pinConversation(req.user.id, conversationId, isPinned);
  sendSuccess(res, 200, isPinned ? "Conversation pinned successfully" : "Conversation unpinned successfully", { conversation });
}

export async function getSharedConversationHandler(req: Request, res: Response) {
  const shareToken = req.params["token"] as string;
  const { conversation, messages } = await conversationService.getSharedMessages(shareToken);
  sendSuccess(res, 200, "Shared conversation fetched successfully", { conversation, messages });
}
