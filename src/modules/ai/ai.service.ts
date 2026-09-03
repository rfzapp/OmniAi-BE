import { ApiError } from "../../utils/ApiError";
import { getPromptLimit, canGenerateImages, getAttachmentLimit, getImageLimit, getPromptCharLimit } from "../../config/plans";
import { User } from "../user/user.model";
import { Message } from "../message/message.model";
import * as conversationService from "../conversation/conversation.service";
import { openaiProvider } from "./providers/openai.provider";
import { anthropicProvider } from "./providers/anthropic.provider";
import { groqProvider } from "./providers/groq.provider";
import { deepseekProvider } from "./providers/deepseek.provider";
import { qwenProvider } from "./providers/qwen.provider";
import { mistralProvider } from "./providers/mistral.provider";
import { kimiProvider } from "./providers/kimi.provider";
import { getOpenAIClient } from "../../config/openai";
import { env } from "../../config/env";
import OpenAI from "openai";
import { uploadImageToCloudinary, downloadImageFromCloudinary } from "../../config/cloudinary";
import { toFile } from "openai/core/uploads";
import type { AIStreamChunk } from "./providers/provider.types";

import { supportsVision } from "../../config/capabilities";
import type { ChatInput } from "./ai.validation";
import type { ProviderChatMessage } from "./providers/provider.types";
import { LatencyTimer } from "../../utils/latencyTimer";

const HISTORY_LIMIT = 20;

/** Pick the right provider based on the model ID prefix. */
function getProvider(model: string) {
  if (model.startsWith("claude-")) return anthropicProvider;
  if (model.startsWith("grok-")) return groqProvider;
  if (model.startsWith("deepseek-")) return deepseekProvider;
  if (model.startsWith("qwen-")) return qwenProvider;
  if (model.startsWith("mistral-") || model.startsWith("codestral-")) return mistralProvider;
  if (model.startsWith("moonshot-") || model.startsWith("kimi-")) return kimiProvider;
  return openaiProvider;
}

/**
 * LLM-based intent classifier — replaces fragile regex patterns.
 *
 * Sends a single cheap gpt-4o-mini call that reads the user's message plus
 * whether a prior generated image exists in the conversation, then returns
 * one of three labels:
 *
 *   "new_image"    — generate a brand-new image (no reference image needed).
 *   "modify_image" — modify/edit the most-recent generated image.
 *   "chat"         — normal text conversation, no image involved.
 *
 * We ask the model to respond with ONLY the label word so parsing is trivial
 * and there is no risk of exceeding the provider's input limits.
 *
 * Falls back to "chat" on any error so the app never crashes.
 */
async function classifyImageIntent(
  message: string,
  hasPreviousImage: boolean,
): Promise<"new_image" | "modify_image" | "chat"> {
const systemPrompt = `You are an intent classifier for an AI assistant that can generate and edit images.
Given a user message, classify the intent as exactly one of these three labels:

new_image    — the user wants to generate a brand-new image from scratch.
               Examples: "generate an image of a car", "draw a sunset", "create a logo", "make a picture of Quaid e Azam".
               CRITICAL: Even if hasPreviousImage is true, if the user explicitly asks to "generate", "create", or "draw" a new image, classify as new_image.

modify_image — the user wants to change, edit, or update a previously generated image.
               This includes: removing or adding elements, changing background, style, position, color, lighting, subject, cropping, or any visual modification.
               Examples: "change the suit of this image", "put the plane on the ground", "remove the background", "just the car", "without the flag".
               ONLY classify as modify_image when the user is explicitly referring to or modifying the existing image. Do NOT use this for brand new requests.

chat         — the user is asking a question or having a normal text conversation.
               Examples: "what is Pakistan's capital?", "explain RAG".

Respond with ONLY the single label word: new_image, modify_image, or chat. No other text.`;

  const userPrompt = `hasPreviousImage: ${hasPreviousImage}\nUser message: ${message.slice(0, 500)}`;

  try {
    const client = getOpenAIClient();
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      max_tokens: 10,
      temperature: 0,
    });
    const label = (res.choices[0]?.message?.content ?? "").trim().toLowerCase();
    if (label === "new_image" || label === "modify_image" || label === "chat") {
      return label;
    }
    // Unexpected output — safe fallback
    console.warn(`[INTENT] Unexpected classifier label: "${label}", falling back to chat`);
    return "chat";
  } catch (err) {
    console.error("[INTENT] classifyImageIntent failed, falling back to chat:", err);
    return "chat";
  }
}

function buildMemoryContext(user: { preferences?: { memoryEnabled?: boolean }; memories?: Array<{ content: string }> }): string {
  if (user.preferences?.memoryEnabled === false || !Array.isArray(user.memories) || user.memories.length === 0) {
    return "";
  }
  const list = user.memories.map((m) => `- ${m.content}`).join("\n");
  return `\n\n[User Memory Context]\nOmniAI remembers the following details about the user across conversations:\n${list}\nUse this context to provide personalized and relevant responses naturally.`;
}



async function extractPdfText(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text: string; numpages: number }>;
  const result = await pdfParse(buffer);
  return result.text?.trim() || "";
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mammoth = require("mammoth") as { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> };
  const result = await mammoth.extractRawText({ buffer });
  return result.value?.trim() || "";
}

function extractXlsxText(buffer: Buffer): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx") as typeof import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const rows: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet!, { defval: "", raw: false });
    rows.push(`Worksheet: ${sheetName}`);
    rows.push(JSON.stringify(data).slice(0, 8000));
  }

  return rows.join("\n\n");
}

async function extractAttachmentContext(files: Express.Multer.File[] | undefined, model: string): Promise<string> {
  if (!files || files.length === 0) return "";

  const sections = await Promise.all(
    files.map(async (file) => {
      const name = file.originalname || file.filename || file.fieldname || "attached file";
      const lower = name.toLowerCase();
      const mime = file.mimetype || "application/octet-stream";

      // Determine whether this file is an image by MIME type OR by extension.
      // Browsers (and some multipart parsers) may report "application/octet-stream"
      // for image files, so extension-based detection is essential here.
      const isImageMime = mime.startsWith("image/");
      const isImageExt =
        lower.endsWith(".png") ||
        lower.endsWith(".jpg") ||
        lower.endsWith(".jpeg") ||
        lower.endsWith(".webp") ||
        lower.endsWith(".gif");
      const isImage = isImageMime || isImageExt;

      console.log(`[ATTACHMENT] name=${name} mime=${mime} size=${file.size} isImage=${isImage} model=${model}`);

      if (isImage) {
        if (!supportsVision(model)) {
          throw ApiError.badRequest("This model does not support image attachments. Please select a vision-capable model.");
        }
        return null; // vision models handle images via buildImageContentParts
      }

      let text = "";

      if (mime === "application/pdf" || lower.endsWith(".pdf")) {
        try {
          text = await extractPdfText(file.buffer);
        } catch {
          text = "";
        }
      } else if (
        mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        mime === "application/msword" ||
        lower.endsWith(".docx") ||
        lower.endsWith(".doc")
      ) {
        try {
          text = await extractDocxText(file.buffer);
        } catch {
          text = "";
        }
      } else if (
        mime === "application/vnd.ms-excel" ||
        mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        lower.endsWith(".xls") ||
        lower.endsWith(".xlsx") ||
        lower.endsWith(".csv")
      ) {
        try {
          text = extractXlsxText(file.buffer);
        } catch {
          text = file.buffer.toString("utf-8");
        }
      } else if (
        mime.startsWith("text/") ||
        mime === "application/json" ||
        mime === "application/javascript" ||
        mime === "application/xml" ||
        /\.(txt|csv|json|md|ts|tsx|js|jsx|py|html|css|xml|log|yaml|yml|sh|c|cpp|h|java|sql)$/i.test(lower)
      ) {
        text = file.buffer.toString("utf-8");
      } else {
        // Fallback: try reading as UTF-8 text for general/unknown files.
        // Guard: never apply this fallback to image or binary file extensions —
        // if an image slipped through MIME detection, we must not convert its
        // raw binary buffer to a string (that produces millions of garbage tokens).
        const looksLikeBinary =
          lower.endsWith(".png") ||
          lower.endsWith(".jpg") ||
          lower.endsWith(".jpeg") ||
          lower.endsWith(".webp") ||
          lower.endsWith(".gif") ||
          lower.endsWith(".bmp") ||
          lower.endsWith(".ico") ||
          lower.endsWith(".tiff") ||
          lower.endsWith(".heic");
        if (looksLikeBinary) {
          return null; // should have been caught by isImage above; skip silently
        }
        text = file.buffer.toString("utf-8");
      }

      if (!text.trim()) {
        return `Attachment file ${name} (${mime}, ${file.size} bytes) was received but did not yield readable text.`;
      }
      return `Attachment file ${name} (${mime}, ${file.size} bytes) content:\n${text}`;
    }),
  );

  return sections.filter(Boolean).join("\n\n");
}

/**
 * Upload user-attached image files to Cloudinary and return provider-compatible
 * image_url content parts using persistent HTTPS URLs.
 *
 * Using Cloudinary URLs instead of base64 data URIs:
 * - Avoids sending megabytes of base64 to text token counters
 * - Works with providers (like Qwen) that only accept HTTP image URLs
 * - Keeps the multipart message payload small
 */
async function buildImageContentParts(files: Express.Multer.File[] | undefined): Promise<Array<{
  type: "image_url";
  image_url: { url: string; detail: "auto" };
}>> {
  if (!files || files.length === 0) return [];

  const imageFiles = files.filter((file) => {
    const mime = (file.mimetype || "").toLowerCase();
    const ext = (file.originalname || "").toLowerCase();
    return (
      mime.startsWith("image/") ||
      ext.endsWith(".png") ||
      ext.endsWith(".jpg") ||
      ext.endsWith(".jpeg") ||
      ext.endsWith(".webp") ||
      ext.endsWith(".gif")
    );
  });

  if (imageFiles.length === 0) return [];

  const parts = await Promise.all(
    imageFiles.map(async (file) => {
      // Derive a valid MIME type in case the browser sent application/octet-stream
      let mime = file.mimetype || "";
      if (!mime.startsWith("image/")) {
        const ext = (file.originalname || "").toLowerCase();
        if (ext.endsWith(".png")) mime = "image/png";
        else if (ext.endsWith(".jpg") || ext.endsWith(".jpeg")) mime = "image/jpeg";
        else if (ext.endsWith(".webp")) mime = "image/webp";
        else if (ext.endsWith(".gif")) mime = "image/gif";
        else mime = "image/png";
      }

      // Upload to Cloudinary and use the persistent HTTPS URL.
      // This works with ALL vision providers (OpenAI, Claude, Qwen, Grok, etc.)
      // because they all accept standard HTTP image URLs.
      const cloudinaryUrl = await uploadImageToCloudinary(file.buffer, {
        folder: "omniai/attachments",
      });

      console.log(`[VISION] Uploaded attachment to Cloudinary: name=${file.originalname} mime=${mime} url=${cloudinaryUrl}`);

      return {
        type: "image_url" as const,
        image_url: {
          url: cloudinaryUrl,
          detail: "auto" as const,
        },
      };
    }),
  );

  return parts;
}

/**
 * Looks back through the conversation's persisted messages and returns the
 * imageUrl of the most recent assistant message that has one.  Returns null
 * when no prior generated image exists (fresh conversation, or the user has
 * not asked for an image yet).
 *
 * We query the DB directly here instead of reusing an in-memory history slice
 * so that (a) the result survives page reloads and (b) we only fetch the
 * single most-recent image message rather than the whole history.
 */
async function findPreviousGeneratedImage(conversationId: string): Promise<string | null> {
  const msg = await Message.findOne(
    { conversationId, role: "assistant", imageUrl: { $exists: true, $ne: null } },
    { imageUrl: 1 },
  ).sort({ createdAt: -1 });
  return msg?.imageUrl ?? null;
}

/**
 * Resolves a stored image reference to a raw Buffer + mime pair for use with
 * OpenAI's images.edit endpoint.
 *
 * Supports two storage formats:
 *   1. Legacy base64 data URL: "data:<mime>;base64,<data>"
 *   2. Cloudinary HTTPS URL:   "https://res.cloudinary.com/..."
 */
async function resolveImageToBuffer(imageRef: string): Promise<{ buffer: Buffer; mime: string }> {
  // Cloudinary (or any plain HTTPS) URL
  if (imageRef.startsWith("https://") || imageRef.startsWith("http://")) {
    const buffer = await downloadImageFromCloudinary(imageRef);
    // Derive MIME from URL extension; default to png
    const lower = imageRef.toLowerCase().split("?")[0] ?? "";
    let mime = "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) mime = "image/jpeg";
    else if (lower.endsWith(".webp")) mime = "image/webp";
    else if (lower.endsWith(".gif")) mime = "image/gif";
    return { buffer, mime };
  }

  // Legacy base64 data URL
  const match = imageRef.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw new Error("Previous image is not in a supported format (expected HTTPS URL or data URI)");
  return { buffer: Buffer.from(match[2]!, "base64"), mime: match[1]! };
}

/**
 * Edit (image-to-image) generation using OpenAI's images.edit endpoint.
 *
 * Accepts either a Cloudinary HTTPS URL or a legacy base64 data URL as the
 * reference image. The result is uploaded to Cloudinary and a persistent
 * HTTPS URL is returned — no base64 is stored in MongoDB.
 *
 * Image generation always uses gpt-image-2. The user's selected model is only
 * used for chat/text responses, not for pixel generation.
 */
async function editImage(previousImageRef: string, prompt: string, apiKeyOverride?: string): Promise<string> {
  const t0 = Date.now();
  console.log(`[IMAGE_EDIT] editImage START — imageRef="${previousImageRef.slice(0, 80)}" len=${previousImageRef.length}`);

  const client = getOpenAIClient(apiKeyOverride);

  // ── Step 1: resolve reference → Buffer ───────────────────────────────────
  const t1 = Date.now();
  const { buffer, mime } = await resolveImageToBuffer(previousImageRef);
  console.log(`[IMAGE_EDIT] resolve image: ${Date.now() - t1}ms — mime=${mime} bufferBytes=${buffer.length}`);

  // ── Step 2: wrap Buffer as Uploadable File ────────────────────────────────
  const t2 = Date.now();
  const imageFile = await toFile(buffer, "reference.png", { type: mime });
  console.log(`[IMAGE_EDIT] toFile: ${Date.now() - t2}ms`);

  // ── Step 3: OpenAI images.edit API call ──────────────────────────────────
  const t3 = Date.now();
  console.log(`[IMAGE_EDIT] provider API request START — model=gpt-image-2 prompt="${prompt.slice(0, 80)}"`);

  let response;
  try {
    response = await client.images.edit({
      model: "gpt-image-2",
      image: imageFile,
      prompt,
      n: 1,
      size: "1024x1024",
    });
  } catch (err: any) {
    throw ApiError.badRequest(`Image editing failed: ${err.message || "Unknown provider error"}`);
  }

  console.log(`[IMAGE_EDIT] provider API response RECEIVED: ${Date.now() - t3}ms`);

  const item = response.data?.[0];
  if (!item) throw ApiError.internal("Image edit returned no result");

  // ── Step 4: get raw image bytes from the response ─────────────────────────
  const t4 = Date.now();
  let rawBuffer: Buffer;

  if (item.b64_json) {
    rawBuffer = Buffer.from(item.b64_json, "base64");
    console.log(`[IMAGE_EDIT] got b64_json: ${Date.now() - t4}ms`);
  } else if (item.url) {
    console.log(`[IMAGE_EDIT] downloading from OpenAI URL`);
    const imgRes = await fetch(item.url);
    rawBuffer = Buffer.from(await imgRes.arrayBuffer());
    console.log(`[IMAGE_EDIT] OpenAI URL download: ${Date.now() - t4}ms`);
  } else {
    throw ApiError.internal("Image edit returned no usable data");
  }

  // ── Step 5: upload to Cloudinary ─────────────────────────────────────────
  const t5 = Date.now();
  const cloudinaryUrl = await uploadImageToCloudinary(rawBuffer, { folder: "omniai/generated" });
  console.log(`[IMAGE_EDIT] Cloudinary upload: ${Date.now() - t5}ms — url=${cloudinaryUrl}`);
  console.log(`[IMAGE_EDIT] COMPLETE: total=${Date.now() - t0}ms`);

  return cloudinaryUrl;
}

/**
 * Generate a new image using gpt-image-2.
 * Image generation always uses gpt-image-2 regardless of selected chat model.
 */
async function generateImage(prompt: string, apiKeyOverride?: string): Promise<string> {
  const client = getOpenAIClient(apiKeyOverride);
  let response;
  try {
    response = await client.images.generate({
      model: "gpt-image-2",
      prompt,
      n: 1,
      size: "1024x1024",
      response_format: "b64_json",
    });
  } catch (err: any) {
    // Fallback without response_format
    try {
      response = await client.images.generate({
        model: "gpt-image-2",
        prompt,
        n: 1,
        size: "1024x1024",
      });
    } catch (err2: any) {
      throw ApiError.badRequest(`Image generation failed: ${err2.message || "Unknown provider error"}`);
    }
  }

  const item = response.data?.[0];
  if (!item) throw ApiError.internal("Image generation returned no result");

  let rawBuffer: Buffer;

  if (item.b64_json) {
    rawBuffer = Buffer.from(item.b64_json, "base64");
  } else if (item.url) {
    try {
      const imgRes = await fetch(item.url);
      rawBuffer = Buffer.from(await imgRes.arrayBuffer());
    } catch (err) {
      console.error("[IMAGE] Failed to download image from OpenAI URL:", err);
      return item.url;
    }
  } else {
    throw ApiError.internal("Image generation returned no usable data");
  }

  // Upload to Cloudinary and return a persistent HTTPS URL
  const cloudinaryUrl = await uploadImageToCloudinary(rawBuffer, { folder: "omniai/generated" });
  return cloudinaryUrl;
}

export async function chat(userId: string, input: ChatInput, files?: Express.Multer.File[]) {
  const timer = new LatencyTimer('chat');
  timer.start();
  const user = await User.findById(userId).select("subscription imagePlan promptCount promptCount24h attachmentCount24h imageCount24h lastImageResetAt lastPromptResetAt preferences.memoryEnabled memories");
  if (!user) throw ApiError.unauthorized("User no longer exists");

  // Enforce per-message character limit based on plan
  const charLimit = getPromptCharLimit(user.subscription);
  if (input.message.length > charLimit) {
    throw new ApiError(403, `Message exceeds the ${charLimit.toLocaleString()}-character limit for your plan. Upgrade to Ultra Pro for up to 8,000 characters per message.`);
  }

  const limit = getPromptLimit(user.subscription);

  const now = new Date();
  const resetInterval = 30 * 24 * 60 * 60 * 1000; // 30-day rolling window
  const originalLastResetAt = user.lastPromptResetAt ? new Date(user.lastPromptResetAt) : null;
  const needsReset = !originalLastResetAt || (now.getTime() - originalLastResetAt.getTime() >= resetInterval);

  // After a reset, counters restart from 0 for limit-checking purposes
  const promptCount24h = needsReset ? 0 : (user.promptCount24h || 0);
  let attachmentCount24h = needsReset ? 0 : (user.attachmentCount24h || 0);

  const freePromptLimit = limit ?? 3;
  if (user.subscription === "free") {
    // Free plan uses promptCount (all-time lifetime total) — 3 prompts forever, no reset
    if (user.promptCount >= freePromptLimit) {
      throw new ApiError(403, "Free prompt limit reached. Please upgrade your plan.");
    }
    if (files && files.length > 0) {
      throw new ApiError(403, "File attachments are not allowed on the Free plan. Please upgrade to Standard or higher.");
    }
  } else {
    const promptLimit = limit;
    if (promptLimit !== null && (promptCount24h + 1) > promptLimit) {
      throw new ApiError(403, `Monthly prompt limit reached for your ${user.subscription} plan (${promptLimit} prompts/month). Limit resets every 30 days.`);
    }

    const attachmentLimit = getAttachmentLimit(user.subscription);
    const attachmentsCount = files ? files.length : 0;
    if ((attachmentCount24h + attachmentsCount) > attachmentLimit) {
      throw new ApiError(403, `Monthly file attachment limit reached for your ${user.subscription} plan (${attachmentLimit} attachments).`);
    }
  }

  // Parse attachments + find/create conversation
  const [attachmentContext, conversation] = await Promise.all([
    extractAttachmentContext(files, input.model),
    conversationService.findOrCreateConversation(userId, input.model, input.message, input.conversationId),
  ]);

  const memoryContext = buildMemoryContext(user);
  const dbUserMessage = [input.message, attachmentContext].filter(Boolean).join("\n\n");
  const aiPromptMessage = [input.message, memoryContext, attachmentContext].filter(Boolean).join("\n\n");

  const imageParts = await buildImageContentParts(files);
  const hasAttachedImages = imageParts.length > 0;

  // ── Intent classification ────────────────────────────────────────────────
  // If the user attached an image file, this is always a vision/understanding
  // request — never image generation. Skip the classifier in that case.
  let wantsImage = false;
  let wantsModification = false;

  if (!hasAttachedImages) {
    const hasPrevImage = input.conversationId
      ? (await findPreviousGeneratedImage(input.conversationId)) !== null
      : false;
    const intent = await classifyImageIntent(input.message, hasPrevImage);
    console.log(`[INTENT] "${input.message.slice(0, 80)}" → ${intent}`);
    wantsImage = intent === "new_image";
    wantsModification = intent === "modify_image";
  } else {
    console.log(`[INTENT] attached image file — routing to vision/chat path`);
  }

  // Only look up the previous image URL when we actually need it.
  const previousImageUrl = wantsModification && input.conversationId
    ? await findPreviousGeneratedImage(input.conversationId)
    : null;

  const isModification = wantsModification && previousImageUrl !== null;
  const isImageOp = wantsImage || isModification;

  if (isImageOp && !canGenerateImages(user.imagePlan)) {
    throw new ApiError(403, "Image generation requires an Image Generation plan. Please subscribe to unlock it.");
  }

  if (isImageOp) {
    const imageLimit = getImageLimit(user.imagePlan);
    const lastImageReset = user.lastImageResetAt ? new Date(user.lastImageResetAt) : now;
    const imageCount = (now.getTime() - lastImageReset.getTime() >= resetInterval)
      ? 0
      : (user.imageCount24h ?? 0);
    if (imageCount >= imageLimit) {
      throw new ApiError(403, `Monthly image limit reached for your plan (${imageLimit} images/month). Upgrade your Image Generation plan for more.`);
    }
  }

  const userImageUrl = imageParts[0]?.image_url.url;

  const provider = getProvider(input.model);

  // Append clean user message to DB first, then fetch history for AI context
  await conversationService.appendMessage(conversation.id as string, "user", dbUserMessage, input.model, userImageUrl);
  const history = isImageOp
    ? []
    : await conversationService.getRecentMessages(conversation.id as string, HISTORY_LIMIT);

  let replyText: string;
  let imageUrl: string | undefined;

  if (isModification && previousImageUrl) {
    // Image-to-image edit: pass the previous image + the user's instruction
    imageUrl = await editImage(previousImageUrl, input.message);
    replyText = "Here is your modified image.";
  } else if (wantsImage) {
    imageUrl = await generateImage(input.message);
    replyText = "Here is your generated image.";
  } else {
    const providerMessages: ProviderChatMessage[] = history.map((m, idx) => {
      if (idx === history.length - 1 && m.role === "user") {
        return { role: m.role, content: aiPromptMessage };
      }
      return { role: m.role, content: m.content };
    });
    if (imageParts.length > 0) {
      const lastUser = [...providerMessages].reverse().find((m) => m.role === "user");
      if (lastUser) {
        const textContent = String(lastUser.content || "").trim();
        lastUser.content = textContent
          ? [{ type: "text", text: textContent }, ...imageParts]
          : [...imageParts];
      }
    }
    replyText = await provider.generateReply(input.model, providerMessages);
  }

  // Append assistant reply + update user counters in parallel; touch conversation fire-and-forget
  const updateFields: Record<string, any> = {
    $inc: { promptCount: 1 },
  };

  if (user.subscription !== "free") {
    if (needsReset) {
      updateFields.$set = {
        promptCount24h: 1,
        attachmentCount24h: files ? files.length : 0,
        lastPromptResetAt: now,
      };
    } else {
      updateFields.$inc.promptCount24h = 1;
      updateFields.$inc.attachmentCount24h = files ? files.length : 0;
    }
  }

  if (isImageOp) {
    const lastImageReset = user.lastImageResetAt ? new Date(user.lastImageResetAt) : now;
    const imageIsReset = now.getTime() - lastImageReset.getTime() >= resetInterval;
    if (imageIsReset) {
      updateFields.$set = { ...(updateFields.$set ?? {}), imageCount24h: 1, lastImageResetAt: now };
    } else {
      updateFields.$inc.imageCount24h = 1;
    }
  }

  const [assistantMessage, updatedUser] = await Promise.all([
    conversationService.appendMessage(conversation.id as string, "assistant", replyText, input.model, imageUrl),
    User.findByIdAndUpdate(userId, updateFields, { new: true }).select("promptCount promptCount24h attachmentCount24h"),
  ]);

  // Touch conversation timestamp — not in critical path, fire-and-forget
  void conversationService.touchConversation(conversation.id as string);

  const promptsUsed = updatedUser?.promptCount ?? user.promptCount + 1;
  const promptsUsed24h = updatedUser?.promptCount24h ?? (promptCount24h + 1);

  const assistantPayload = {
    id: String(assistantMessage._id),
    role: assistantMessage.role,
    content: replyText,
    model: assistantMessage.model,
    imageUrl: imageUrl ?? null,
    createdAt: assistantMessage.createdAt,
  };

  return {
    conversation,
    message: assistantPayload,
    imageUrl,
    usage: {
      promptsUsed,
      promptsUsed24h,
      promptsLimit: limit,
    },
  };
}



/**
 * SSE streaming variant of chat().
 * Validates limits, creates the conversation, then streams tokens from the
 * AI provider. Any error — pre-stream, mid-stream, or provider failure — is
 * captured and persisted as the assistant message so page-reload always shows
 * the same text as the live session.
 */
export async function* chatStream(
  userId: string,
  input: ChatInput,
  files?: Express.Multer.File[],
  signal?: AbortSignal,
): AsyncGenerator<import("./providers/provider.types").AIStreamChunk | { done: true; conversation: object; message: object; usage: object }> {
  const tTotal = new LatencyTimer("Total");
  tTotal.start();

  // ── 1. Auth + limits (throw before any yield — controller handles these) ──
  const tUser = new LatencyTimer("User lookup");
  tUser.start();
  const user = await User.findById(userId).select(
    "subscription imagePlan promptCount promptCount24h attachmentCount24h imageCount24h lastImageResetAt lastPromptResetAt preferences.memoryEnabled memories",
  );
  tUser.stop();
  console.log(`[CHAT] ${tUser.report()}`);

  if (!user) throw ApiError.unauthorized("User no longer exists");

  const charLimit = getPromptCharLimit(user.subscription);
  if (input.message.length > charLimit) {
    throw new ApiError(403, `Message exceeds the ${charLimit.toLocaleString()}-character limit for your plan. Upgrade to Ultra Pro for up to 8,000 characters per message.`);
  }

  const limit = getPromptLimit(user.subscription);
  const now = new Date();
  const resetInterval = 30 * 24 * 60 * 60 * 1000;
  const originalLastResetAt = user.lastPromptResetAt ? new Date(user.lastPromptResetAt) : null;
  const needsReset = !originalLastResetAt || now.getTime() - originalLastResetAt.getTime() >= resetInterval;
  const promptCount24h = needsReset ? 0 : (user.promptCount24h || 0);
  const attachmentCount24h = needsReset ? 0 : (user.attachmentCount24h || 0);

  if (user.subscription === "free") {
    const freeLimit = limit ?? 3;
    if (user.promptCount >= freeLimit)
      throw new ApiError(403, "Free prompt limit reached. Please upgrade your plan.");
    if (files && files.length > 0)
      throw new ApiError(403, "File attachments are not allowed on the Free plan. Please upgrade to Standard or higher.");
  } else {
    const promptLimit = limit;
    if (promptLimit !== null && promptCount24h + 1 > promptLimit)
      throw new ApiError(403, `Monthly prompt limit reached for your ${user.subscription} plan (${promptLimit} prompts/month). Limit resets every 30 days.`);
    const attachmentLimit = getAttachmentLimit(user.subscription);
    const attachmentsCount = files ? files.length : 0;
    if (attachmentCount24h + attachmentsCount > attachmentLimit)
      throw new ApiError(403, `Monthly file attachment limit reached for your ${user.subscription} plan (${attachmentLimit} attachments).`);
  }

  // ── 2. Create conversation + kick off attachment processing in parallel ────
  // Attachment processing (PDF text extraction, image base64) can be slow.
  // We await the conversation first so we can emit the "start" SSE event with
  // the conversationId immediately, giving the frontend the ID even if the
  // client disconnects during attachment extraction.
  const tAttachment = new LatencyTimer("Attachment processing");
  const tConversation = new LatencyTimer("Conversation lookup/create");

  tAttachment.start();
  const attachmentContextPromise = extractAttachmentContext(files, input.model).then((res) => {
    tAttachment.stop();
    console.log(`[CHAT] ${tAttachment.report()}`);
    return res;
  });

  tConversation.start();
  const conversation = await conversationService
    .findOrCreateConversation(userId, input.model, input.message, input.conversationId)
    .then((res) => {
      tConversation.stop();
      console.log(`[CHAT] ${tConversation.report()}`);
      return res;
    });

  // Emit start immediately — frontend registers conversationId from this event.
  yield { type: "start", conversationId: conversation.id } as unknown as AIStreamChunk;

  // ── 3. Stream + persist ───────────────────────────────────────────────────
  // Everything from here is wrapped in try/catch. Any error is stored as the
  // assistant message so reload shows the same text as the live session.
  const FALLBACK_ERROR = "Something went wrong. Please try again.";
  let fullReply = "";
  let generatedImageUrl: string | undefined;
  let streamError: string | null = null;
  // Hoisted outside try so the image-counter update block can see it after the stream ends.
  let didImageOp = false;

  try {
    // Wait for attachment extraction (may already be done).
    const attachmentContext = await attachmentContextPromise;

    const memoryContext = buildMemoryContext(user);
    // dbUserMessage = clean text saved to MongoDB (no memory injected)
    const dbUserMessage = [input.message, attachmentContext].filter(Boolean).join("\n\n");
    // aiPromptMessage = full prompt sent to the AI (includes memory)
    const aiPromptMessage = [input.message, memoryContext, attachmentContext].filter(Boolean).join("\n\n");

    const imageParts = await buildImageContentParts(files);
    const userImageUrl = imageParts[0]?.image_url.url;
    const provider = getProvider(input.model);

    console.log(`[CHAT] model=${input.model} imageParts=${imageParts.length} hasFiles=${(files?.length ?? 0) > 0}`);

    const tContext = new LatencyTimer("Context construction");
    tContext.start();

    // ── Intent classification (LLM-based) ────────────────────────────────────
    // IMPORTANT: If the user attached an image file, this is always an image
    // understanding/vision request — never an image generation request.
    // Skip the classifier entirely and go straight to the chat/vision path.
    const hasAttachedImages = imageParts.length > 0;

    let wantsImage = false;
    let wantsModification = false;

    if (!hasAttachedImages) {
      // Only run the LLM classifier when no image file is attached.
      const tHasPrev = Date.now();
      const hasPrevImage = input.conversationId
        ? (await findPreviousGeneratedImage(input.conversationId)) !== null
        : false;
      console.log(`[IMAGE_EDIT] findPreviousGeneratedImage (hasPrev check): ${Date.now() - tHasPrev}ms — hasPrevImage=${hasPrevImage}`);

      const tClassify = Date.now();
      const intent = await classifyImageIntent(input.message, hasPrevImage);
      console.log(`[IMAGE_EDIT] classifyImageIntent: ${Date.now() - tClassify}ms`);
      console.log(`[INTENT] "${input.message.slice(0, 80)}" → ${intent}`);

      wantsImage = intent === "new_image";
      wantsModification = intent === "modify_image";
    } else {
      console.log(`[INTENT] attached image file detected — routing to vision/chat path`);
    }

    // Only fetch the actual image URL when we need it for editing.
    const tPrevUrl = Date.now();
    const previousImageUrl = wantsModification && input.conversationId
      ? await findPreviousGeneratedImage(input.conversationId)
      : null;
    if (wantsModification) {
      console.log(`[IMAGE_EDIT] findPreviousGeneratedImage (URL fetch): ${Date.now() - tPrevUrl}ms — found=${previousImageUrl !== null} urlLen=${previousImageUrl?.length ?? 0}`);
    }

    const isModification = wantsModification && previousImageUrl !== null;
    const isImageOp = wantsImage || isModification;
    if (isImageOp) didImageOp = true;

    if (isImageOp && !canGenerateImages(user.imagePlan)) {
      throw new ApiError(403, "Image generation requires an Image Generation plan. Please subscribe to unlock it.");
    }

    if (isImageOp) {
      const imageLimit = getImageLimit(user.imagePlan);
      const lastImageReset = user.lastImageResetAt ? new Date(user.lastImageResetAt) : now;
      const imageCount = now.getTime() - lastImageReset.getTime() >= resetInterval ? 0 : (user.imageCount24h ?? 0);
      if (imageCount >= imageLimit) {
        throw new ApiError(403, `Monthly image limit reached for your plan (${imageLimit} images/month). Upgrade your Image Generation plan for more.`);
      }
    }

    // Save clean user message to DB, fetch history in parallel
    const tHistory = new LatencyTimer("History fetch");
    tHistory.start();

    const [, history] = await Promise.all([
      conversationService.appendMessage(conversation.id as string, "user", dbUserMessage, input.model, userImageUrl),
      (isImageOp ? Promise.resolve([]) : conversationService.getRecentMessages(conversation.id as string, HISTORY_LIMIT)).then((res) => {
        tHistory.stop();
        console.log(`[CHAT] ${tHistory.report()}`);
        return res;
      }),
    ]);

    tContext.stop();
    console.log(`[CHAT] ${tContext.report()}`);

    // ── Image modification path ──────────────────────────────────────────────
    if (isModification && previousImageUrl) {
      const tEditStart = Date.now();
      console.log(`[IMAGE_EDIT] modify_image BRANCH START — prevImageUrlLen=${previousImageUrl.length}`);

      generatedImageUrl = await editImage(previousImageUrl, input.message);

      console.log(`[IMAGE_EDIT] editImage RETURNED — took=${Date.now() - tEditStart}ms resultLen=${generatedImageUrl.length}`);

      // fullReply is the text saved to DB and sent as message content.
      // The actual image is delivered via generatedImageUrl → done event → imageUrl field.
      // Do NOT yield a markdown image token here — the frontend renders imageUrl
      // as a standalone <img> tag, so yielding markdown would produce two images.
      fullReply = "Here is your modified image.";
      yield { type: "token", content: fullReply } as unknown as AIStreamChunk;

    // ── Image generation path ────────────────────────────────────────────────
    } else if (wantsImage) {
      generatedImageUrl = await generateImage(input.message);
      // fullReply is the text label stored in DB and sent as message content.
      // The image itself is delivered through generatedImageUrl → done event → imageUrl.
      // Do NOT yield a markdown image token — that would render a second image
      // alongside the one the frontend already shows from the imageUrl field.
      fullReply = "Here is your generated image.";
      yield { type: "token", content: fullReply } as unknown as AIStreamChunk;
    } else {

      // ── Text streaming path ──────────────────────────────────────────────────
      // Filter out any messages with empty content — these are failed responses
      // that were persisted as empty strings. Sending them to providers like Qwen
      // causes "Range of input length should be [1, 1000000]" errors since they
      // reject zero-length message content.
      //
      // Also strip messages whose content is a base64 data URL (e.g. a previously
      // generated image stored as "![Generated Image](data:image/png;base64,...)").
      // Those strings are megabytes long and will exceed provider input limits.
      const providerMessages: ProviderChatMessage[] = history
        .filter((m) => {
          if (typeof m.content !== "string") return true;
          const text = m.content.trim();
          if (text.length === 0) return false;
          // Drop messages that are (or embed) base64 data URLs — they are far too
          // large for text model context windows.
          if (text.includes("data:image/") && text.includes(";base64,")) return false;
          return true;
        })
        .map((m) => ({ role: m.role, content: m.content }));

      // Add the current user message (appended in parallel so may not be in history yet)
      providerMessages.push({ role: "user", content: aiPromptMessage });

      if (imageParts.length > 0) {
        const lastUser = providerMessages[providerMessages.length - 1];
        if (lastUser && lastUser.role === "user") {
          const textContent = String(lastUser.content || "").trim();
          lastUser.content = textContent
            ? [{ type: "text", text: textContent }, ...imageParts]
            : [...imageParts];
        }
      }

      const providerName = ((input.model || "").split("-")[0] ?? "").toUpperCase();
      console.log(`\n[${providerName}] Request started`);

      const tProvider = new LatencyTimer("Provider stream");
      tProvider.start();

      const tTTFT = new LatencyTimer("TTFT");
      tTTFT.start();

      let firstToken = true;

      try {
        for await (const chunk of provider.generateStream(input.model, providerMessages, undefined, signal)) {
          if (chunk.type === "start") continue;

          // Provider signalled a stream-level error — capture it, yield it so
          // the frontend shows the message immediately, then stop consuming.
          if ((chunk as any).type === "error") {
            streamError = (chunk as any).content ?? "AI provider error during streaming";
            yield chunk;
            break;
          }

          if (chunk.type === "token" && firstToken) {
            tTTFT.stop();
            console.log(`[${providerName}] First chunk: ${tTTFT.elapsed()}ms`);
            console.log(`[CHAT] TTFT: ${tTotal.elapsed()}ms`);
            firstToken = false;
          }
          if (chunk.type === "token" && chunk.content) {
            fullReply += chunk.content;
          }
          yield chunk;
        }
      } catch (genErr: any) {
        if (!streamError) {
          streamError = genErr?.message || "Stream interrupted";
        }
      }

      tProvider.stop();
      console.log(`[${providerName}] Total: ${tProvider.elapsed()}ms\n`);
    } // end else (text streaming path)

  } catch (preStreamErr: any) {
    if (!streamError) {
      streamError = preStreamErr instanceof ApiError
        ? preStreamErr.message
        : (preStreamErr?.message || FALLBACK_ERROR);
    }
  }

  // ── 4. Persist assistant message ──────────────────────────────────────────
  // When a stream error occurs we intentionally save the FALLBACK_ERROR string
  // rather than the raw provider error message. Storing provider errors (e.g.
  // "400 InternalError.Algo.InvalidParameter: Range of input length...") would
  // re-inject them into conversation history on the next turn, potentially
  // triggering the same failure again on providers like Qwen.
  const contentToSave = fullReply.trim() || (streamError !== null ? FALLBACK_ERROR : fullReply);

  const updateFields: Record<string, any> = { $inc: { promptCount: 1 } };
  if (user.subscription !== "free") {
    if (needsReset) {
      updateFields.$set = {
        promptCount24h: 1,
        attachmentCount24h: files ? files.length : 0,
        lastPromptResetAt: now,
      };
    } else {
      updateFields.$inc.promptCount24h = 1;
      updateFields.$inc.attachmentCount24h = files ? files.length : 0;
    }
  }

  // Count image generations (new images and edits both consume from the image quota).
  if (didImageOp) {
    const lastImageReset = user.lastImageResetAt ? new Date(user.lastImageResetAt) : now;
    const imageIsReset = now.getTime() - lastImageReset.getTime() >= resetInterval;
    if (imageIsReset) {
      updateFields.$set = { ...(updateFields.$set ?? {}), imageCount24h: 1, lastImageResetAt: now };
    } else {
      updateFields.$inc.imageCount24h = 1;
    }
  }

  const tPersist = Date.now();

  const [assistantMessage, updatedUser] = await Promise.all([
    conversationService.appendMessage(conversation.id as string, "assistant", contentToSave, input.model, generatedImageUrl),
    User.findByIdAndUpdate(userId, updateFields, { new: true }).select("promptCount promptCount24h attachmentCount24h"),
  ]);
  void conversationService.touchConversation(conversation.id as string);

  console.log(`[IMAGE_EDIT] DB persist (appendMessage + user update): ${Date.now() - tPersist}ms`);

  const promptsUsed = updatedUser?.promptCount ?? user.promptCount + 1;
  const promptsUsed24h = updatedUser?.promptCount24h ?? promptCount24h + 1;

  // ── 5. Final SSE event ────────────────────────────────────────────────────
  if (streamError !== null) {
    yield {
      error: true,
      status: 502,
      message: streamError,
    } as unknown as AIStreamChunk;
    tTotal.stop();
    console.log(`[CHAT] ${tTotal.report()}\n`);
    return;
  }

  yield {
    done: true,
    conversation: {
      id: conversation.id,
      title: conversation.title,
      model: conversation.model,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    },
    message: {
      id: String(assistantMessage._id),
      role: assistantMessage.role,
      content: fullReply,
      model: assistantMessage.model,
      imageUrl: generatedImageUrl ?? null,
      createdAt: assistantMessage.createdAt,
    },
    usage: {
      promptsUsed,
      promptsUsed24h,
      promptsLimit: limit,
    },
  };

  tTotal.stop();
  console.log(`[CHAT] ${tTotal.report()}\n`);
}
