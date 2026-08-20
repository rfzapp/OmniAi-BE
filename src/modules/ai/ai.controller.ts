import type { Request, Response } from "express";
import { sendSuccess } from "../../utils/ApiResponse";
import { ApiError } from "../../utils/ApiError";
import * as aiService from "./ai.service";

export async function chatHandler(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();

  const files = Array.isArray(req.files) ? req.files : [];
  const { conversation, message, imageUrl, usage } = await aiService.chat(req.user.id, req.body, files as Express.Multer.File[]);

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
      model: message.model,
      imageUrl: imageUrl ?? null,
      createdAt: message.createdAt,
    },
    usage,
  });
}

export async function chatStreamHandler(req: Request, res: Response) {
  if (!req.user) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  // SSE headers — must be set before any write
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();

  const files = Array.isArray(req.files) ? (req.files as Express.Multer.File[]) : [];

  function sendEvent(data: object) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  try {
    const generator = aiService.chatStream(req.user.id, req.body, files);

    for await (const chunk of generator) {
      if (typeof chunk === "string") {
        // Token chunk
        sendEvent({ token: chunk });
      } else {
        // Final done event with conversation/message/usage metadata
        sendEvent(chunk);
      }
    }
  } catch (err) {
    const apiErr = err instanceof ApiError ? err : null;
    sendEvent({
      error: true,
      status: apiErr?.statusCode ?? 500,
      message: apiErr?.message ?? "Something went wrong",
    });
  } finally {
    res.end();
  }
}
