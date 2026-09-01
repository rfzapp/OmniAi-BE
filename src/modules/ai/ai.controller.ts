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
  res.setHeader("Transfer-Encoding", "chunked");
  res.flushHeaders();

  const files = Array.isArray(req.files) ? (req.files as Express.Multer.File[]) : [];

  // Track whether the client is still connected so we can skip writes on a
  // closed socket (res.write throws on a destroyed socket).
  let clientConnected = true;

  function sendEvent(data: object) {
    if (!clientConnected) return;
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      // Force-flush the response buffer so each token reaches the client immediately.
      // This matters when compression middleware or Node's internal buffering
      // would otherwise batch multiple small writes together.
      if (typeof (res as any).flush === "function") {
        (res as any).flush();
      }
    } catch {
      // Socket closed mid-write — mark as disconnected so subsequent writes are skipped.
      clientConnected = false;
    }
  }

  // The abort signal is passed to the AI provider so it stops generating tokens
  // when the client disconnects. The generator itself continues to run after the
  // abort so it can persist whatever content was accumulated before disconnecting.
  const abortController = new AbortController();
  req.on("close", () => {
    console.log("[CHAT] Client disconnected, stopping token generation");
    clientConnected = false;
    abortController.abort();
  });

  try {
    const generator = aiService.chatStream(req.user.id, req.body, files, abortController.signal);

    // Consume the entire generator to ensure the persist step always runs,
    // even if the client disconnected mid-stream.
    for await (const chunk of generator) {
      sendEvent(chunk);
    }
  } catch (err) {
    const apiErr = err instanceof ApiError ? err : null;
    sendEvent({
      error: true,
      status: apiErr?.statusCode ?? 500,
      message: apiErr?.message ?? "Something went wrong",
    });
  } finally {
    if (!res.writableEnded) res.end();
  }
}
