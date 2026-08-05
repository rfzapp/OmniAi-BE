import type { Request, Response } from "express";
import { sendSuccess } from "../../utils/ApiResponse";
import { ApiError } from "../../utils/ApiError";
import * as aiService from "./ai.service";

export async function chatHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();

  const { conversation, message, usage } = await aiService.chat(req.user.id, req.body);

  sendSuccess(res, 200, "AI response generated successfully", {
    conversation: {
      id: conversation.id,
      title: conversation.title,
      model: conversation.model,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    },
    message: {
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    },
    usage,
  });
}
