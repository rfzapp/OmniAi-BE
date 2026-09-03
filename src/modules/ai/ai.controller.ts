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

  // AbortController for cancelling the AI provider stream.
  //
  // IMPORTANT: We do NOT abort on req "close" or res "close" events.
  //
  // On multipart/form-data requests (file uploads), Node.js fires both the
  // req "close" and res "close" events when the browser transitions from
  // "sending the request body" to "receiving the streaming response" — i.e.
  // right after flushHeaders(). Listening to either of these would abort the
  // signal before the Cloudinary upload or AI API call even starts, silently
  // killing every image request.
  //
  // The ONLY reliable signal for a genuine client disconnect is the underlying
  // TCP socket's "close" event, which only fires when the socket is actually
  // destroyed (browser navigated away, tab closed, network dropped).
  const abortController = new AbortController();

  // Use the response socket's "close" event, which fires only when the TCP
  // connection is truly torn down — not during the multipart body → SSE transition.
  const socket = (res as any).socket ?? (res as any).req?.socket;
  if (socket) {
    socket.once("close", () => {
      if (clientConnected) {
        console.log("[CHAT] Client disconnected (socket closed), stopping token generation");
        clientConnected = false;
        abortController.abort();
      }
    });
  }

  // Start a keep-alive ping every 3 seconds to prevent proxy / HTTP timeouts
  // during slow tasks (such as image generation or heavy attachments).
  const keepAliveTimer = setInterval(() => {
    if (!clientConnected) return;
    try {
      res.write(": keep-alive\n\n");
      if (typeof (res as any).flush === "function") {
        (res as any).flush();
      }
    } catch {
      clientConnected = false;
    }
  }, 3000);

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
    clearInterval(keepAliveTimer);
    if (!res.writableEnded) res.end();
  }
}
