import { createHash, randomUUID } from "node:crypto";
import { ApiError } from "../../utils/ApiError";
import {
  getPromptLimit, canGenerateImages, getAttachmentLimit, getImageLimit, getPromptCharLimit,
  isModelAccessible, getRequiredPlanForModel, capitalizePlan, normalizePlan,
} from "../../config/plans";
import { User } from "../user/user.model";
import { Message } from "../message/message.model";
import * as conversationService from "../conversation/conversation.service";
import { openaiProvider } from "./providers/openai.provider";
import { anthropicProvider } from "./providers/anthropic.provider";
import { groqProvider } from "./providers/groq.provider";
import { openRouterProvider } from "./providers/openrouter.provider";
import { resolveDeepSeekOpenRouterRoute } from "./providers/deepseek-openrouter.routes";
import { qwenProvider } from "./providers/qwen.provider";
import { mistralProvider } from "./providers/mistral.provider";
import { kimiProvider } from "./providers/kimi.provider";
import { getOpenAIClient } from "../../config/openai";
import { env } from "../../config/env";
import OpenAI from "openai";
import { uploadImageToCloudinary, downloadImageFromCloudinary, uploadDocumentToCloudinary } from "../../config/cloudinary";
import { toFile } from "openai/core/uploads";
import type { AIStreamChunk } from "./providers/provider.types";

import { supportsImageEditing, supportsVision } from "../../config/capabilities";
import type { ChatInput } from "./ai.validation";
import type { ProviderChatMessage } from "./providers/provider.types";
import { LatencyTimer } from "../../utils/latencyTimer";
import {
  estimateRequestCredits,
  getCreditSummary,
  getDailyImageSummary,
  markUsageUnpriced,
  refundCredits,
  reserveImageQuota,
  reserveCredits,
  settleImageQuota,
  settleCredits,
} from "../billing/credit.service";
import type { BillableUsage } from "../billing/pricing";
import { normalizeOpenAIUsage } from "./providers/provider.utils";

const HISTORY_LIMIT = 20;
const OPENAI_IMAGE_MODEL = "gpt-image-2";
const QWEN_IMAGE_MODELS = {
  low: "qwen-image-plus",
  medium: "qwen-image-plus",
  high: "qwen-image-plus",
} as const;
const WAN_IMAGE_MODELS = {
  low: "wan2.7-image",
  medium: "wan2.7-image",
  high: "wan2.7-image-pro",
} as const;
const QWEN_IMAGE_POLL_INTERVAL_MS = 5_000;
const QWEN_IMAGE_MAX_POLLS = 36;
const IMAGE_PROVIDER_REQUEST_TIMEOUT_MS = 30_000;

type ImageQuality = "low" | "medium" | "high";
type ImageProvider = "openai" | "qwen" | "wan";
interface ImageResult {
  url: string;
  modelId: string;
  usage?: BillableUsage | undefined;
  outputImages: number;
}

function normalizeImageProvider(value?: string): ImageProvider | undefined {
  const normalized = (value ?? "").toLowerCase().trim();
  if (normalized === "openai" || normalized === "qwen" || normalized === "wan") {
    return normalized;
  }
  return undefined;
}

function resolveImageProvider(model?: string): ImageProvider {
  const value = (model ?? "").toLowerCase();
  if (value.startsWith("qwen") || value.includes("qwen")) return "qwen";
  if (value.startsWith("wan") || value.includes("wan")) return "wan";
  return "openai";
}

function isImageGenerationModel(model?: string): boolean {
  const value = (model ?? "").toLowerCase();
  return value.startsWith("gpt-image-")
    || value.startsWith("qwen-image-")
    || value.startsWith("wan2.7-image");
}

function resolveImageGenerationModel(
  model: string | undefined,
  quality: ImageQuality = "medium",
  explicitProvider?: ImageProvider,
) {
  const selectedModel = (model ?? "").toLowerCase();
  const modelProvider = selectedModel.startsWith("qwen-image-")
    ? "qwen" as const
    : selectedModel.startsWith("wan")
      ? "wan" as const
      : selectedModel.startsWith("gpt-image-")
        ? "openai" as const
        : undefined;
  // A normal chat model is only the conversation model. Image requests from
  // that context always use the default GPT Image 2 Low path.
  const provider = modelProvider ?? (selectedModel ? "openai" : explicitProvider ?? "openai");
  if (modelProvider && explicitProvider && modelProvider !== explicitProvider) {
    throw new ApiError(400, `Selected image model ${model} does not belong to provider ${explicitProvider}.`);
  }
  if (provider === "qwen") {
    return {
      provider: "qwen" as const,
      model: modelProvider === "qwen" ? model : QWEN_IMAGE_MODELS[quality],
      size: quality === "low" ? "1024*1024" : quality === "medium" ? "1536*1536" : "2048*2048",
    };
  }
  if (provider === "wan") {
    return {
      provider: "wan" as const,
      model: modelProvider === "wan" ? model : WAN_IMAGE_MODELS[quality],
      size: quality === "low" ? "1024x1024" : quality === "medium" ? "1536x1536" : "2048x2048",
    };
  }
  return {
    provider: "openai" as const,
    model: modelProvider === "openai" ? (model === "gpt-image-2" ? model : OPENAI_IMAGE_MODEL) : OPENAI_IMAGE_MODEL,
    size: "1024x1024",
    quality,
  };
}

function resolveImageResponseModel(
  model: string | undefined,
  quality: ImageQuality = "low",
): string {
  const normalized = (model ?? "").toLowerCase();
  if (normalized.startsWith("qwen-image-") || normalized.startsWith("wan")) return model!;
  return `gpt-image-2-${quality}`;
}

function resolveImageEditModel(model: string | undefined, explicitProvider?: ImageProvider) {
  const selectedModel = (model ?? "").toLowerCase();
  const modelProvider = selectedModel.startsWith("qwen-image-")
    ? "qwen" as const
    : selectedModel.startsWith("wan")
      ? "wan" as const
      : selectedModel.startsWith("gpt-image-")
        ? "openai" as const
        : undefined;
  if (modelProvider && explicitProvider && modelProvider !== explicitProvider) {
    throw new ApiError(400, `Selected image model ${model} does not belong to provider ${explicitProvider}.`);
  }
  const provider = modelProvider ?? explicitProvider ?? resolveImageProvider(model);
  if (provider === "qwen") {
    return { provider: "qwen" as const, model: model?.startsWith("qwen-image-") ? model : "qwen-image-plus", size: "2048*2048" };
  }
  if (provider === "wan") {
    return { provider: "wan" as const, model: model?.startsWith("wan") ? model : "wan2.7-image-pro", size: "2048x2048" };
  }
  return { provider: "openai" as const, model: OPENAI_IMAGE_MODEL, size: "1024x1024" };
}

function imageProviderError(operation: "generation" | "edit", err: any): ApiError {
  const message = err?.message || "Unknown provider error";
  const status = err?.status;
  if (status === 400) return ApiError.badRequest(`Image ${operation} request rejected: ${message}`);
  if (status === 401 || status === 403) return ApiError.internal(`Image provider authentication failed: ${message}`);
  if (status === 429) return new ApiError(429, `Image provider rate limit or quota exceeded: ${message}`);
  return new ApiError(502, `Image ${operation} provider failed: ${message}`);
}

function estimateInputTokens(messages: ProviderChatMessage[]): number {
  let textBytes = 0;
  let imageCount = 0;
  for (const message of messages) {
    if (typeof message.content === "string") {
      textBytes += Buffer.byteLength(message.content, "utf8");
      continue;
    }
    for (const part of message.content) {
      if (part.type === "text") textBytes += Buffer.byteLength(part.text, "utf8");
      else imageCount++;
    }
  }
  return Math.max(1, textBytes + imageCount * 100_000);
}

function estimateImageUsage(modelId: string, prompt: string, quality: ImageQuality, editing: boolean): BillableUsage {
  if (modelId === OPENAI_IMAGE_MODEL) {
    return {
      inputTokens: Math.ceil(prompt.length / 4),
      imageInputTokens: editing ? 12_000 : 0,
      outputTokens: 20_000,
      imageOutputTokens: 20_000,
    };
  }
  return {
    ...(editing ? { inputImages: 1 } : {}),
    generatedImages: 1,
    imageQuality: quality,
  };
}

async function runBillableImage(
  userId: string,
  requestId: string,
  modelId: string,
  operation: "image-generation" | "image-edit",
  prompt: string,
  quality: ImageQuality,
  editing: boolean,
  action: () => Promise<ImageResult>,
): Promise<ImageResult> {
  const estimatedCredits = estimateRequestCredits(modelId, estimateImageUsage(modelId, prompt, quality, editing));
  let creditReserved = false;
  let imageReservation: Awaited<ReturnType<typeof reserveImageQuota>> | undefined;
  try {
    await reserveCredits({ userId, requestId, modelId, operation, estimatedCredits, imageQuality: quality });
    creditReserved = true;
    imageReservation = await reserveImageQuota(userId, requestId, 1);
  } catch (error) {
    if (creditReserved) await refundCredits(userId, requestId, "image-quota-reservation-failed").catch(() => {});
    throw error;
  }

  let result: ImageResult;
  try {
    result = await action();
  } catch (error) {
    await refundCredits(userId, requestId, "image-provider-failure", imageReservation.date).catch(() => {});
    throw error;
  }

  if (result.usage) {
    try {
      await settleCredits(userId, requestId, result.usage);
    } catch (error) {
      await markUsageUnpriced(userId, requestId, error instanceof Error ? error.name : "settlement-failure");
    }
  } else {
    await markUsageUnpriced(userId, requestId, "image-provider-usage-missing");
  }
  await settleImageQuota(userId, requestId, result.outputImages, imageReservation.date).catch((error) => {
    console.error("[billing] Failed to settle daily image quota", error instanceof Error ? error.message : "unknown error");
  });
  return result;
}

/** Pick the right provider based on the model ID prefix. */
function getProvider(model: string) {
  if (model.startsWith("claude-")) return { provider: anthropicProvider, modelId: model };
  if (model.startsWith("grok-")) return { provider: groqProvider, modelId: model };
  if (model.startsWith("deepseek-")) {
    const route = resolveDeepSeekOpenRouterRoute(model);
    if (!route) throw ApiError.badRequest(`Unsupported DeepSeek model: ${model}`);
    if (!route.enabled) throw new ApiError(503, `The ${route.displayName} route is currently disabled.`);
    if (!env.OPENROUTER_API_KEY?.trim()) {
      throw new ApiError(503, "OpenRouter is not configured. Set OPENROUTER_API_KEY in the backend environment.");
    }
    if (env.NODE_ENV !== "production") {
      console.info(`Internal model ID: ${model}`);
      console.info("Selected model: DeepSeek");
      console.info(`Selected model display name: ${route.displayName}`);
      console.info(`Selected provider: OpenRouter`);
      console.info(`Resolved model ID: ${route.openRouterModelId}`);
    }
    return { provider: openRouterProvider, modelId: route.openRouterModelId };
  }
  if (model.startsWith("qwen-") || model.startsWith("qwen3")) return { provider: qwenProvider, modelId: model };
  if (model.startsWith("mistral-") || model.startsWith("codestral-")) return { provider: mistralProvider, modelId: model };
  if (model.startsWith("moonshot-") || model.startsWith("kimi-")) return { provider: kimiProvider, modelId: model };
  return { provider: openaiProvider, modelId: model };
}

function hasExplicitVisualIntent(message: string): boolean {
  return /\b(give|show|generate|create|make|draw|design|render|produce)\b.{0,60}\b(visuals?|images?|pictures?|photos?|illustrations?|artwork|mockups?|screenshots?)\b/i.test(message)
    || /\b(visuals?|images?|pictures?|photos?|illustrations?|artwork|mockups?|screenshots?)\b.{0,30}\b(for|of|showing|depicting)\b/i.test(message);
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
  billing: { userId: string; requestId: string; enabled: boolean },
): Promise<"NEW_IMAGE" | "IMAGE_MODIFICATION" | "NORMAL_CHAT"> {
const systemPrompt = `You are an intent classifier for an AI assistant that can generate and edit images.
Given a user message, classify the intent as exactly one of these three labels:

NEW_IMAGE    — the user wants to generate a brand-new image from scratch.
               Examples: "generate an image of a car", "draw a sunset", "create a logo", "make a picture of Quaid e Azam".
               CRITICAL: Even if hasPreviousImage is true, if the user explicitly asks to "generate", "create", or "draw" a new image, classify as NEW_IMAGE. DO NOT classify as IMAGE_MODIFICATION just because a previous image exists.

IMAGE_MODIFICATION — the user wants to change, edit, or update a previously generated image.
               This includes: removing or adding elements, changing background, style, position, color, lighting, subject, cropping, or any visual modification.
               Examples: "change the suit of this image", "put the plane on the ground", "remove the background", "just the car", "without the flag".
               ONLY classify as IMAGE_MODIFICATION when the user is explicitly referring to or modifying the existing image. Do NOT use this for brand new requests.

NORMAL_CHAT  — the user is asking a question or having a normal text conversation.
               Examples: "what is Pakistan's capital?", "explain RAG".

Respond with ONLY the single label word: NEW_IMAGE, IMAGE_MODIFICATION, or NORMAL_CHAT. No other text.`;

  const userPrompt = `hasPreviousImage: ${hasPreviousImage}\nUser message: ${message.slice(0, 500)}`;
  const intentRequestId = `intent-${createHash("sha256").update(billing.requestId).digest("hex").slice(0, 32)}`;
  let reserved = false;

  try {
    if (billing.enabled) {
      const estimatedCredits = estimateRequestCredits("gpt-4o-mini", {
        inputTokens: Buffer.byteLength(systemPrompt + userPrompt, "utf8"),
        outputTokens: 10,
      });
      await reserveCredits({ userId: billing.userId, requestId: intentRequestId, modelId: "gpt-4o-mini", operation: "chat", estimatedCredits });
      reserved = true;
    }
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
    if (billing.enabled && res.usage) {
      try {
        await settleCredits(billing.userId, intentRequestId, normalizeOpenAIUsage(res.usage)!);
      } catch (error) {
        await markUsageUnpriced(billing.userId, intentRequestId, error instanceof Error ? error.name : "settlement-failure");
      }
    } else if (billing.enabled) {
      await markUsageUnpriced(billing.userId, intentRequestId, "classifier-usage-missing");
    }
    const label = (res.choices[0]?.message?.content ?? "").trim().toUpperCase();
    if (label === "NEW_IMAGE" || label === "IMAGE_MODIFICATION" || label === "NORMAL_CHAT") {
      return label as "NEW_IMAGE" | "IMAGE_MODIFICATION" | "NORMAL_CHAT";
    }
    // Unexpected output — safe fallback
    console.warn(`[INTENT] Unexpected classifier label: "${label}", falling back to NORMAL_CHAT`);
    return "NORMAL_CHAT";
  } catch (err) {
    if (reserved) await refundCredits(billing.userId, intentRequestId, "intent-classifier-failure").catch(() => {});
    console.error("[INTENT] classifyImageIntent failed, falling back to NORMAL_CHAT:", err);
    return "NORMAL_CHAT";
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
        if (!supportsVision(model) && !supportsImageEditing(model)) {
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
 * Upload a non-image file attachment (PDF, DOCX, XLSX, TXT, etc.) to Cloudinary
 * and return the persistent URL + original filename for storage in the message.
 *
 * Returns null if no non-image file is present so callers can skip the upload
 * without branching on file type themselves.
 */
async function buildDocumentAttachment(files: Express.Multer.File[] | undefined): Promise<{ url: string; name: string } | null> {
  if (!files || files.length === 0) return null;

  // Find the first non-image file
  const docFile = files.find((file) => {
    const mime = (file.mimetype || "").toLowerCase();
    const ext = (file.originalname || "").toLowerCase();
    const isImage =
      mime.startsWith("image/") ||
      ext.endsWith(".png") || ext.endsWith(".jpg") || ext.endsWith(".jpeg") ||
      ext.endsWith(".webp") || ext.endsWith(".gif");
    return !isImage;
  });

  if (!docFile) return null;

  const name = docFile.originalname || docFile.fieldname || "attachment";
  const url = await uploadDocumentToCloudinary(docFile.buffer, name, {
    folder: "omniai/documents",
  });

  console.log(`[ATTACHMENT] Uploaded document to Cloudinary: name=${name} size=${docFile.size}`);
  return { url, name };
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
async function editGeneratedImage(
  previousImageRef: string,
  prompt: string,
  selectedModel?: string,
  providerOverride?: ImageProvider,
  apiKeyOverride?: string,
): Promise<ImageResult> {
  const t0 = Date.now();
  console.log(`[IMAGE_EDIT] editImage START — imageRef="${previousImageRef.slice(0, 80)}" len=${previousImageRef.length}`);

  const t1 = Date.now();
  const { buffer, mime } = await resolveImageToBuffer(previousImageRef);
  console.log(`[IMAGE_EDIT] resolve image: ${Date.now() - t1}ms — mime=${mime} bufferBytes=${buffer.length}`);

  const requestConfig = resolveImageEditModel(selectedModel, providerOverride);
  if (requestConfig.provider === "qwen") {
    const apiKey = apiKeyOverride ?? env.QWEN_API_KEY;
    if (!apiKey) throw ApiError.internal("QWEN_API_KEY is not configured.");
    const imageContent = /^https?:\/\//i.test(previousImageRef)
      ? previousImageRef
      : `data:${mime};base64,${buffer.toString("base64")}`;
    const model = requestConfig.model === "qwen-image-plus" ? "qwen-image-edit-plus" : requestConfig.model;
    const response = await fetch(`${env.QWEN_API_BASE_URL.replace(/\/$/, "")}/services/aigc/multimodal-generation/generation`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: {
          messages: [{
            role: "user",
            content: [
              { image: imageContent },
              { text: prompt },
            ],
          }],
        },
        parameters: { n: 1, size: requestConfig.size, watermark: false, prompt_extend: true },
      }),
    });
    const responseText = await response.text();
    let body: any = {};
    try { body = responseText ? JSON.parse(responseText) : {}; } catch { body = { message: responseText }; }
    if (!response.ok) throw imageProviderError("edit", Object.assign(new Error(body.message || body.code || "Qwen image edit failed"), { status: response.status }));
    const imageUrl = body.output?.choices?.[0]?.message?.content?.find(
      (content: { image?: string }) => content.image,
    )?.image;
    if (!imageUrl) throw ApiError.internal("Qwen image edit returned no image URL");
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) throw ApiError.internal(`Qwen image download failed with status ${imageResponse.status}`);
    const editedBuffer = Buffer.from(await imageResponse.arrayBuffer());
    return {
      url: await uploadImageToCloudinary(editedBuffer, { folder: "omniai/generated" }),
      modelId: requestConfig.model,
      usage: { inputImages: 1, generatedImages: 1, imageQuality: "high" },
      outputImages: 1,
    };
  }
  if (requestConfig.provider === "wan") {
    throw new ApiError(501, "Wan image editing is not enabled in this phase.");
  }

  const client = getOpenAIClient(apiKeyOverride);
  const t2 = Date.now();
  const imageFile = await toFile(buffer, "reference.png", { type: mime });
  console.log(`[IMAGE_EDIT] toFile: ${Date.now() - t2}ms`);

  const t3 = Date.now();
  console.log(`[IMAGE_EDIT] provider API request START — model=gpt-image-2 prompt="${prompt.slice(0, 80)}"`);

  let response;
  try {
    response = await client.images.edit({
      model: requestConfig.model,
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

  const t5 = Date.now();
  const cloudinaryUrl = await uploadImageToCloudinary(rawBuffer, { folder: "omniai/generated" });
  console.log(`[IMAGE_EDIT] Cloudinary upload: ${Date.now() - t5}ms — url=${cloudinaryUrl}`);
  console.log(`[IMAGE_EDIT] COMPLETE: total=${Date.now() - t0}ms`);

  return { url: cloudinaryUrl, modelId: requestConfig.model, usage: normalizeOpenAIUsage(response.usage), outputImages: 1 };
}

async function generateImage(
  prompt: string,
  quality: ImageQuality = "medium",
  selectedModel?: string,
  providerOverride?: ImageProvider,
  apiKeyOverride?: string,
): Promise<ImageResult> {
  const requestConfig = resolveImageGenerationModel(selectedModel, quality, providerOverride);

  if (requestConfig.provider === "qwen") {
    const apiKey = apiKeyOverride ?? env.QWEN_API_KEY;
    if (!apiKey) throw ApiError.internal("QWEN_API_KEY is not configured.");
    const baseUrl = env.QWEN_API_BASE_URL.replace(/\/$/, "");

    async function qwenRequest(url: string, init?: RequestInit): Promise<any> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), IMAGE_PROVIDER_REQUEST_TIMEOUT_MS);
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
      clearTimeout(timeout);
      const responseText = await response.text();
      let body: any = {};
      try {
        body = responseText ? JSON.parse(responseText) : {};
      } catch {
        body = { message: responseText };
      }
      if (!response.ok) {
        const error = new Error(body.message || body.code || `Qwen request failed with status ${response.status}`) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }
      return body;
    }

    try {
      const usesQwenMultimodalImageApi = requestConfig.model === "qwen-image-3.0"
        || requestConfig.model === "qwen-image-3.0-pro";
      if (usesQwenMultimodalImageApi) {
        const response = await qwenRequest(`${baseUrl}/services/aigc/multimodal-generation/generation`, {
          method: "POST",
          body: JSON.stringify({
            model: requestConfig.model,
            input: {
              messages: [{ role: "user", content: [{ text: prompt.slice(0, 800) }] }],
            },
            parameters: { size: requestConfig.size, watermark: false, prompt_extend: true },
          }),
        });
        const imageUrl = response.output?.choices?.[0]?.message?.content?.find(
          (content: { image?: string }) => content.image,
        )?.image;
        if (!imageUrl) throw new Error("Qwen Image 3.0 returned no image URL");
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) throw new Error(`Qwen image download failed with status ${imageResponse.status}`);
        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        return {
          url: await uploadImageToCloudinary(imageBuffer, { folder: "omniai/generated" }),
          modelId: requestConfig.model ?? QWEN_IMAGE_MODELS[quality],
          usage: { generatedImages: 1, imageQuality: quality },
          outputImages: 1,
        };
      }

      const taskResponse = await qwenRequest(`${baseUrl}/services/aigc/text2image/image-synthesis`, {
        method: "POST",
        headers: { "X-DashScope-Async": "enable" },
        body: JSON.stringify({
          model: requestConfig.model,
          input: { prompt },
          parameters: { size: requestConfig.size, n: 1, watermark: false, prompt_extend: true },
        }),
      });

      const taskId = taskResponse.output?.task_id;
      if (!taskId) {
        throw new Error(taskResponse.message || "Qwen did not return an image task ID");
      }

      for (let poll = 0; poll < QWEN_IMAGE_MAX_POLLS; poll++) {
        await new Promise((resolve) => setTimeout(resolve, QWEN_IMAGE_POLL_INTERVAL_MS));
        const result = await qwenRequest(`${baseUrl}/tasks/${taskId}`);
        const output = result.output ?? {};
        if (poll === 0 || (poll + 1) % 6 === 0) {
          console.log(`[QWEN IMAGE] task=${taskId} status=${output.task_status ?? "UNKNOWN"} poll=${poll + 1}/${QWEN_IMAGE_MAX_POLLS}`);
        }
        if (output.task_status === "FAILED" || output.task_status === "CANCELED") {
          throw new Error(result.message || `Qwen image task ${output.task_status.toLowerCase()}`);
        }
        if (output.task_status !== "SUCCEEDED") continue;

        const imageUrl = output.results?.[0]?.url;
        if (!imageUrl) throw new Error("Qwen image task succeeded without an image URL");
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) throw new Error(`Qwen image download failed with status ${imageResponse.status}`);
        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        return {
          url: await uploadImageToCloudinary(imageBuffer, { folder: "omniai/generated" }),
          modelId: requestConfig.model ?? QWEN_IMAGE_MODELS[quality],
          usage: { generatedImages: 1, imageQuality: quality },
          outputImages: 1,
        };
      }
      throw new Error("Qwen image generation timed out while waiting for the task result");
    } catch (err: any) {
      console.error("[QWEN IMAGE GENERATION ERROR]", err?.message || err);
      throw imageProviderError("generation", err);
    }
  }

  if (requestConfig.provider === "wan") {
    throw new ApiError(501, "Wan image generation is not enabled in this phase.");
  }

  const client = getOpenAIClient(apiKeyOverride);

  let response: Awaited<ReturnType<typeof client.images.generate>>;
  try {
    response = await client.images.generate({
      model: requestConfig.model,
      prompt,
      n: 1,
      size: requestConfig.size,
      quality: requestConfig.quality,
      response_format: "b64_json",
    }, { timeout: IMAGE_PROVIDER_REQUEST_TIMEOUT_MS });
  } catch (err: any) {
    try {
      response = await client.images.generate({
        model: requestConfig.model,
        prompt,
        n: 1,
        size: requestConfig.size,
        quality: requestConfig.quality,
      }, { timeout: IMAGE_PROVIDER_REQUEST_TIMEOUT_MS });
    } catch (err2: any) {
      console.error("[IMAGE GENERATION ERROR]", err2?.message || err2);
      throw imageProviderError("generation", err2);
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
      return { url: item.url, modelId: requestConfig.model, usage: normalizeOpenAIUsage(response.usage), outputImages: 1 };
    }
  } else {
    throw ApiError.internal("Image generation returned no usable data");
  }

  const cloudinaryUrl = await uploadImageToCloudinary(rawBuffer, { folder: "omniai/generated" });
  return { url: cloudinaryUrl, modelId: requestConfig.model, usage: normalizeOpenAIUsage(response.usage), outputImages: 1 };
}

export async function chat(userId: string, input: ChatInput, files?: Express.Multer.File[], requestId: string = randomUUID()) {
  const timer = new LatencyTimer('chat');
  timer.start();
  const user = await User.findById(userId).select("subscription promptCount promptCount24h attachmentCount24h imageCount24h lastImageResetAt lastPromptResetAt preferences.memoryEnabled memories");
  if (!user) throw ApiError.unauthorized("User no longer exists");

  // Normalize legacy plan names (standard ? starter, ultra_pro ? ultra)
  // so all limit/access checks work for users who signed up before the plan rename.
  const plan = normalizePlan(user.subscription as string);

  // Enforce per-message character limit based on plan
  const charLimit = getPromptCharLimit(plan);
  if (input.message.length > charLimit) {
    throw new ApiError(403, `Your message exceeds the ${charLimit.toLocaleString()}-character limit for the ${capitalizePlan(plan)} plan. Upgrade your plan for a higher limit.`);
  }

  // Enforce model access based on subscription plan
  if (!isModelAccessible(input.model, plan)) {
    const required = getRequiredPlanForModel(input.model);
    const reqLabel = required ? capitalizePlan(required) : "higher";
    throw new ApiError(403, `MODEL_LOCKED:${reqLabel}|This model is not available on your ${capitalizePlan(plan)} plan. Upgrade to ${reqLabel} to access it.`);
  }

  const limit = getPromptLimit(plan);

  const now = new Date();
  const resetInterval = 30 * 24 * 60 * 60 * 1000; // 30-day rolling window
  const originalLastResetAt = user.lastPromptResetAt ? new Date(user.lastPromptResetAt) : null;
  const needsReset = !originalLastResetAt || (now.getTime() - originalLastResetAt.getTime() >= resetInterval);

  // After a reset, counters restart from 0 for limit-checking purposes
  const promptCount24h = needsReset ? 0 : (user.promptCount24h || 0);
  let attachmentCount24h = needsReset ? 0 : (user.attachmentCount24h || 0);

  const freePromptLimit = limit ?? 3;
  if (plan === "free") {
    // Free plan uses promptCount (all-time lifetime total) — 3 prompts forever, no reset
    if (user.promptCount >= freePromptLimit) {
      throw new ApiError(403, "Free prompt limit reached. Please upgrade your plan.");
    }
    if (files && files.length > 0) {
      throw new ApiError(403, "File attachments are not available on the Free plan. Upgrade your plan to attach files.");
    }
  } else {
    const attachmentLimit = getAttachmentLimit(plan);
    const attachmentsCount = files ? files.length : 0;
    if ((attachmentCount24h + attachmentsCount) > attachmentLimit) {
      throw new ApiError(403, `Monthly file attachment limit reached for your ${capitalizePlan(plan)} plan (${attachmentLimit} attachments/month). Upgrade your plan for more.`);
    }
  }

  // Parse attachments + find/create conversation
  const [attachmentContext, conversation] = await Promise.all([
    extractAttachmentContext(files, input.model),
    conversationService.findOrCreateConversation(userId, input.model, input.message, input.conversationId),
  ]);

  const memoryContext = buildMemoryContext(user);
  // dbUserMessage = only the user's typed prompt — no file content stored in DB.
  // File text is injected into aiPromptMessage for the AI only, never persisted,
  // so it never appears in the message bubble on reload.
  const dbUserMessage = input.message;
  const aiPromptMessage = [input.message, memoryContext, attachmentContext].filter(Boolean).join("\n\n");

  const imageParts = await buildImageContentParts(files);
  const hasAttachedImages = imageParts.length > 0;

  // ── Intent classification ────────────────────────────────────────────────
  // When the user attaches an image AND says something like "change the suit
  // color to gray", the attached image is their reference — classify as
  // IMAGE_MODIFICATION and route to editImage().
  // We still run the classifier (with hasPreviousImage=true for attached images)
  // so "describe this image" correctly stays as NORMAL_CHAT/IMAGE_ANALYSIS.
  let intent = hasAttachedImages && isImageGenerationModel(input.model)
    ? "IMAGE_MODIFICATION"
    : hasExplicitVisualIntent(input.message) ? "NEW_IMAGE" : "NORMAL_CHAT";

  if (intent === "NORMAL_CHAT" && hasAttachedImages) {
    // Attached image acts as the reference — always treat as hasPreviousImage=true
    intent = await classifyImageIntent(input.message, true, { userId, requestId, enabled: plan !== "free" });
    // If the classifier didn't detect a modification request, fall back to
    // vision analysis (the original behaviour for "describe this image" etc.)
    if (intent === "NORMAL_CHAT") intent = "IMAGE_ANALYSIS";
  } else if (intent === "NORMAL_CHAT") {
    const hasPrevImage = input.conversationId
      ? (await findPreviousGeneratedImage(input.conversationId)) !== null
      : false;
    intent = await classifyImageIntent(input.message, hasPrevImage, { userId, requestId, enabled: plan !== "free" });
  }

  console.log(`[INTENT] "${input.message.slice(0, 80)}" → ${intent}`);

  const wantsImage = intent === "NEW_IMAGE";
  const wantsModification = intent === "IMAGE_MODIFICATION";

  // For modification: prefer the attached image URL; fall back to the last
  // generated image in the conversation (existing behaviour).
  const attachedImageUrl = imageParts[0]?.image_url.url ?? null;
  const previousImageUrl = wantsModification
    ? (attachedImageUrl ?? (input.conversationId ? await findPreviousGeneratedImage(input.conversationId) : null))
    : null;

  const isModification = wantsModification && previousImageUrl !== null;
  const isImageOp = wantsImage || isModification;

  if (isImageOp && !canGenerateImages(plan)) {
    throw new ApiError(403, "Image generation is not available on the Free plan. Upgrade your plan to generate images.");
  }

  const userImageUrl = imageParts[0]?.image_url.url;

  // Upload non-image document to Cloudinary so it can be shown on reload
  const docAttachment = await buildDocumentAttachment(files);

  // Append clean user message to DB first, then fetch history for AI context
  await conversationService.appendMessage(
    conversation.id as string, "user", dbUserMessage, input.model,
    userImageUrl, docAttachment?.url, docAttachment?.name,
  );
  const history = isImageOp
    ? []
    : await conversationService.getRecentMessages(conversation.id as string, HISTORY_LIMIT);

  let replyText: string;
  let providerUsage: BillableUsage | undefined;
  let imageUrl: string | undefined;
  const chatModel = isImageGenerationModel(input.model) ? "gpt-5.6-sol" : input.model;
  const providerRoute = isImageOp ? undefined : getProvider(chatModel);
  let responseModel = isImageOp ? input.model : chatModel;

  if (isModification && previousImageUrl) {
    const editConfig = resolveImageEditModel(input.model, normalizeImageProvider(input.provider));
    const result = await runBillableImage(
      userId,
      requestId,
      editConfig.model,
      "image-edit",
      input.message,
      "high",
      true,
      () => editGeneratedImage(previousImageUrl, input.message, input.model, normalizeImageProvider(input.provider)),
    );
    imageUrl = result.url;
    replyText = "Here is your modified image.";
  } else if (wantsImage) {
    responseModel = resolveImageResponseModel(input.model, input.imageQuality);
    const quality = input.imageQuality ?? "medium";
    const providerOverride = normalizeImageProvider(input.provider) ?? (input.model ? resolveImageProvider(input.model) : undefined);
    const imageConfig = resolveImageGenerationModel(input.model, quality, providerOverride);
    const result = await runBillableImage(
      userId,
      requestId,
      imageConfig.model ?? OPENAI_IMAGE_MODEL,
      "image-generation",
      input.message,
      quality,
      false,
      () => generateImage(
      input.message,
      input.imageQuality,
      input.model,
      providerOverride,
      undefined,
      ),
    );
    imageUrl = result.url;
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
    if (plan !== "free") {
      const estimatedCredits = estimateRequestCredits(chatModel, {
        inputTokens: estimateInputTokens(providerMessages),
        outputTokens: 4096,
      });
      await reserveCredits({ userId, requestId, modelId: chatModel, operation: "chat", estimatedCredits });
    }
    let response;
    try {
      if (!providerRoute) throw ApiError.internal("Chat provider route was not resolved.");
      response = await providerRoute.provider.generateReply(providerRoute.modelId, providerMessages);
    } catch (error) {
      if (plan !== "free") await refundCredits(userId, requestId, "provider-failure");
      throw error;
    }
    replyText = response.text;
    providerUsage = response.usage;
    if (providerUsage && plan !== "free") {
      try {
        await settleCredits(userId, requestId, providerUsage);
      } catch (error) {
        await markUsageUnpriced(userId, requestId, error instanceof Error ? error.name : "settlement-failure");
      }
    } else if (plan !== "free") {
      await markUsageUnpriced(userId, requestId, "provider-usage-missing");
    }
  }

  // Append assistant reply + update user counters in parallel; touch conversation fire-and-forget
  const updateFields: Record<string, any> = {
    $inc: { promptCount: 1 },
  };

  if (plan !== "free") {
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
    conversationService.appendMessage(conversation.id as string, "assistant", replyText, responseModel, imageUrl),
    User.findByIdAndUpdate(userId, updateFields, { new: true }).select("promptCount promptCount24h attachmentCount24h imageCount24h"),
  ]);

  // Touch conversation timestamp — not in critical path, fire-and-forget
  void conversationService.touchConversation(conversation.id as string);

  const promptsUsed = updatedUser?.promptCount ?? user.promptCount + 1;
  const promptsUsed24h = updatedUser?.promptCount24h ?? (promptCount24h + 1);
  const attachmentsUsed = updatedUser?.attachmentCount24h ?? (attachmentCount24h + (files ? files.length : 0));
  const imagesUsed = isImageOp
    ? (updatedUser?.imageCount24h ?? ((user.imageCount24h ?? 0) + 1))
    : (user.imageCount24h ?? 0);

  // Build full usage object
  const promptLimit = getPromptLimit(plan);
  const attachmentLimit = getAttachmentLimit(plan);
  const imageLimit = getImageLimit(plan);
  const [creditSummary, dailyImageSummary] = await Promise.all([
    getCreditSummary(userId),
    getDailyImageSummary(userId),
  ]);

  const fullUsage = {
    prompts: {
      used: plan === "free" ? promptsUsed : promptsUsed24h,
      limit: promptLimit,
      unlimited: promptLimit === null,
    },
    attachments: {
      used: attachmentsUsed,
      limit: attachmentLimit,
      unlimited: false,
    },
    credits: {
      remaining: creditSummary.available,
      reserved: creditSummary.reserved,
      debt: creditSummary.debt,
      used: creditSummary.usedThisPeriod,
      allowance: creditSummary.allowance,
      periodStartAt: creditSummary.periodStartAt,
      periodEndAt: creditSummary.periodEndAt,
    },
    images: dailyImageSummary,
  };

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
    usage: fullUsage,
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
  requestId: string = randomUUID(),
): AsyncGenerator<import("./providers/provider.types").AIStreamChunk | { done: true; conversation: object; message: object; usage: object }> {
  const tTotal = new LatencyTimer("Total");
  tTotal.start();

  // ── 1. Auth + limits (throw before any yield — controller handles these) ──
  const tUser = new LatencyTimer("User lookup");
  tUser.start();
  const user = await User.findById(userId).select(
    "subscription promptCount promptCount24h attachmentCount24h imageCount24h lastImageResetAt lastPromptResetAt preferences.memoryEnabled memories",
  );
  tUser.stop();
  console.log(`[CHAT] ${tUser.report()}`);

  if (!user) throw ApiError.unauthorized("User no longer exists");

  // Normalize legacy plan names (standard → starter, ultra_pro → ultra)
  // so all limit/access checks work for users who signed up before the plan rename.
  const plan = normalizePlan(user.subscription as string);

  const charLimit = getPromptCharLimit(plan);
  if (input.message.length > charLimit) {
    throw new ApiError(403, `Your message exceeds the ${charLimit.toLocaleString()}-character limit for the ${capitalizePlan(plan)} plan. Upgrade your plan for a higher limit.`);
  }

  // Enforce model access based on subscription plan
  if (!isModelAccessible(input.model, plan)) {
    const required = getRequiredPlanForModel(input.model);
    const reqLabel = required ? capitalizePlan(required) : "higher";
    throw new ApiError(403, `MODEL_LOCKED:${reqLabel}|This model is not available on your ${capitalizePlan(plan)} plan. Upgrade to ${reqLabel} to access it.`);
  }

  const limit = getPromptLimit(plan);
  const now = new Date();
  const resetInterval = 30 * 24 * 60 * 60 * 1000;
  const originalLastResetAt = user.lastPromptResetAt ? new Date(user.lastPromptResetAt) : null;
  const needsReset = !originalLastResetAt || now.getTime() - originalLastResetAt.getTime() >= resetInterval;
  const promptCount24h = needsReset ? 0 : (user.promptCount24h || 0);
  const attachmentCount24h = needsReset ? 0 : (user.attachmentCount24h || 0);

  if (plan === "free") {
    const freeLimit = limit ?? 3;
    if (user.promptCount >= freeLimit)
      throw new ApiError(403, "Free prompt limit reached. Please upgrade your plan.");
    if (files && files.length > 0)
      throw new ApiError(403, "File attachments are not available on the Free plan. Upgrade your plan to attach files.");
  } else {
    const attachmentLimit = getAttachmentLimit(plan);
    const attachmentsCount = files ? files.length : 0;
    if (attachmentCount24h + attachmentsCount > attachmentLimit)
      throw new ApiError(403, `Monthly file attachment limit reached for your ${capitalizePlan(plan)} plan (${attachmentLimit} attachments/month). Upgrade your plan for more.`);
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
  // Attach a noop rejection handler so Node does not log
  // PromiseRejectionHandledWarning when the error is caught later via `await`.
  attachmentContextPromise.catch(() => {});

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
  let streamUsage: BillableUsage | undefined;
  let responseModel = isImageGenerationModel(input.model) ? "gpt-5.6-sol" : input.model;

  try {
    // Wait for attachment extraction (may already be done).
    const attachmentContext = await attachmentContextPromise;

    const memoryContext = buildMemoryContext(user);
    // dbUserMessage = only the user's typed prompt — no file content stored in DB.
    // File text is injected into aiPromptMessage for the AI only, never persisted,
    // so it never appears in the message bubble on reload.
    const dbUserMessage = input.message;
    // aiPromptMessage = full prompt sent to the AI (includes memory + attachment text)
    const aiPromptMessage = [input.message, memoryContext, attachmentContext].filter(Boolean).join("\n\n");

    const imageParts = await buildImageContentParts(files);
    const userImageUrl = imageParts[0]?.image_url.url;
    // Upload non-image document to Cloudinary so it can be shown on reload
    const docAttachment = await buildDocumentAttachment(files);
    const chatModel = isImageGenerationModel(input.model) ? "gpt-5.6-sol" : input.model;

    console.log(`[CHAT] model=${input.model} imageParts=${imageParts.length} hasFiles=${(files?.length ?? 0) > 0}`);

    const tContext = new LatencyTimer("Context construction");
    tContext.start();

    // ── Intent classification (LLM-based) ────────────────────────────────────
    // When the user attaches an image AND says something like "change the suit
    // color to gray", the attached image is their reference — classify as
    // IMAGE_MODIFICATION and route to editImage().
    // We still run the classifier (with hasPreviousImage=true for attached images)
    // so "describe this image" correctly stays as NORMAL_CHAT/IMAGE_ANALYSIS.
    const hasAttachedImages = imageParts.length > 0;

      let intent = hasAttachedImages && isImageGenerationModel(input.model)
        ? "IMAGE_MODIFICATION"
        : hasExplicitVisualIntent(input.message) ? "NEW_IMAGE" : "NORMAL_CHAT";

      if (intent === "NORMAL_CHAT" && hasAttachedImages) {
      // Attached image acts as the reference — always treat as hasPreviousImage=true
      const tClassify = Date.now();
      intent = await classifyImageIntent(input.message, true, { userId, requestId, enabled: plan !== "free" });
      console.log(`[IMAGE_EDIT] classifyImageIntent (attached): ${Date.now() - tClassify}ms`);
      // If no modification detected, fall back to vision analysis
      if (intent === "NORMAL_CHAT") intent = "IMAGE_ANALYSIS";
    } else if (intent === "NORMAL_CHAT") {
      // Only run the LLM classifier when no image file is attached.
      const tHasPrev = Date.now();
      const hasPrevImage = input.conversationId
        ? (await findPreviousGeneratedImage(input.conversationId)) !== null
        : false;
      console.log(`[IMAGE_EDIT] findPreviousGeneratedImage (hasPrev check): ${Date.now() - tHasPrev}ms — hasPrevImage=${hasPrevImage}`);

      const tClassify = Date.now();
      intent = await classifyImageIntent(input.message, hasPrevImage, { userId, requestId, enabled: plan !== "free" });
      console.log(`[IMAGE_EDIT] classifyImageIntent: ${Date.now() - tClassify}ms`);
    }

    console.log(`[INTENT] "${input.message.slice(0, 80)}" → ${intent} hasAttachedImages=${hasAttachedImages}`);

    const wantsImage = intent === "NEW_IMAGE";
    const wantsModification = intent === "IMAGE_MODIFICATION";

    // For modification: prefer the attached image URL; fall back to the last
    // generated image in the conversation (existing behaviour).
    const attachedImageUrl = imageParts[0]?.image_url.url ?? null;
    const tPrevUrl = Date.now();
    const previousImageUrl = wantsModification
      ? (attachedImageUrl ?? (input.conversationId ? await findPreviousGeneratedImage(input.conversationId) : null))
      : null;
    if (wantsModification) {
      console.log(`[IMAGE_EDIT] reference image: ${Date.now() - tPrevUrl}ms — fromAttachment=${!!attachedImageUrl} found=${previousImageUrl !== null}`);
    }

    const isModification = wantsModification && previousImageUrl !== null;
    const isImageOp = wantsImage || isModification;
    const providerRoute = isImageOp ? undefined : getProvider(chatModel);
    if (isImageOp) didImageOp = true;

    if (isImageOp && !canGenerateImages(plan)) {
      throw new ApiError(403, "Image generation is not available on the Free plan. Upgrade your plan to generate images.");
    }

    // Save clean user message to DB, fetch history in parallel
    const tHistory = new LatencyTimer("History fetch");
    tHistory.start();

    const [, history] = await Promise.all([
      conversationService.appendMessage(
        conversation.id as string, "user", dbUserMessage, input.model,
        userImageUrl, docAttachment?.url, docAttachment?.name,
      ),
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
      const editConfig = resolveImageEditModel(input.model, normalizeImageProvider(input.provider));
      const result = await runBillableImage(
        userId,
        requestId,
        editConfig.model,
        "image-edit",
        input.message,
        "high",
        true,
        () => editGeneratedImage(previousImageUrl, input.message, input.model, normalizeImageProvider(input.provider)),
      );
      generatedImageUrl = result.url;
      console.log(`[IMAGE_EDIT] editImage RETURNED — took=${Date.now() - tEditStart}ms resultLen=${generatedImageUrl.length}`);

      fullReply = "Here is your modified image.";
      yield { type: "token", content: fullReply } as unknown as AIStreamChunk;

    // ── Image generation path ────────────────────────────────────────────────
    } else if (wantsImage) {
      responseModel = resolveImageResponseModel(input.model, input.imageQuality);
      const quality = input.imageQuality ?? "medium";
      const providerOverride = normalizeImageProvider(input.provider) ?? (input.model ? resolveImageProvider(input.model) : undefined);
      const imageConfig = resolveImageGenerationModel(input.model, quality, providerOverride);
      const result = await runBillableImage(
        userId,
        requestId,
        imageConfig.model ?? OPENAI_IMAGE_MODEL,
        "image-generation",
        input.message,
        quality,
        false,
        () => generateImage(input.message, input.imageQuality, input.model, providerOverride, undefined),
      );
      generatedImageUrl = result.url;
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

      if (!providerRoute) throw ApiError.internal("Chat provider route was not resolved.");
      const provider = providerRoute.provider;
      const providerModel = providerRoute.modelId;
      const providerName = provider === openRouterProvider
        ? "OPENROUTER"
        : ((chatModel || "").split("-")[0] ?? "").toUpperCase();
      console.log(`\n[${providerName}] Request started`);

      if (plan !== "free") {
        const estimatedCredits = estimateRequestCredits(chatModel, {
          inputTokens: estimateInputTokens(providerMessages),
          outputTokens: 4096,
        });
        await reserveCredits({ userId, requestId, modelId: chatModel, operation: "chat", estimatedCredits });
      }

      const tProvider = new LatencyTimer("Provider stream");
      tProvider.start();

      const tTTFT = new LatencyTimer("TTFT");
      tTTFT.start();

      let firstToken = true;

      try {
        for await (const chunk of provider.generateStream(providerModel, providerMessages, undefined, signal)) {
          if (chunk.type === "start") continue;
          if (chunk.type === "usage") {
            streamUsage = chunk.usage;
            continue;
          }

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
      if (streamUsage && plan !== "free") {
        try {
          await settleCredits(userId, requestId, streamUsage);
        } catch (error) {
          await markUsageUnpriced(userId, requestId, error instanceof Error ? error.name : "settlement-failure");
        }
      } else if (streamError !== null && fullReply.length === 0 && plan !== "free") {
        await refundCredits(userId, requestId, "provider-stream-failure");
      } else if (plan !== "free") {
        await markUsageUnpriced(userId, requestId, "provider-stream-usage-missing");
      }
    } // end else (text streaming path)

  } catch (preStreamErr: any) {
    if (!streamError) {
      streamError = preStreamErr instanceof ApiError
        ? preStreamErr.message
        : (preStreamErr?.message || FALLBACK_ERROR);
    }
  }

  // ── 4. Persist assistant message ──────────────────────────────────────────
  // Persist the same sanitized application-level error shown to the user so a
  // reload does not replace a useful provider rejection with a generic message.
  const contentToSave = fullReply.trim() || (streamError !== null ? streamError : fullReply);

  const updateFields: Record<string, any> = { $inc: { promptCount: 1 } };
  if (plan !== "free") {
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
    User.findByIdAndUpdate(userId, updateFields, { new: true }).select("promptCount promptCount24h attachmentCount24h imageCount24h"),
  ]);
  void conversationService.touchConversation(conversation.id as string);

  console.log(`[IMAGE_EDIT] DB persist (appendMessage + user update): ${Date.now() - tPersist}ms`);

  const promptsUsed = updatedUser?.promptCount ?? user.promptCount + 1;
  const promptsUsed24h = updatedUser?.promptCount24h ?? promptCount24h + 1;
  const attachmentsUsed = updatedUser?.attachmentCount24h ?? (attachmentCount24h + (files ? files.length : 0));
  const imagesUsed = didImageOp
    ? (updatedUser?.imageCount24h ?? ((user.imageCount24h ?? 0) + 1))
    : (user.imageCount24h ?? 0);

  // Build full usage object
  const promptLimit = getPromptLimit(plan);
  const attachmentLimit = getAttachmentLimit(plan);
  const imageLimit = getImageLimit(plan);
  const [creditSummary, dailyImageSummary] = await Promise.all([
    getCreditSummary(userId),
    getDailyImageSummary(userId),
  ]);

  const fullUsage = {
    prompts: {
      used: plan === "free" ? promptsUsed : promptsUsed24h,
      limit: promptLimit,
      unlimited: promptLimit === null,
    },
    attachments: {
      used: attachmentsUsed,
      limit: attachmentLimit,
      unlimited: false,
    },
    credits: {
      remaining: creditSummary.available,
      reserved: creditSummary.reserved,
      debt: creditSummary.debt,
      used: creditSummary.usedThisPeriod,
      allowance: creditSummary.allowance,
      periodStartAt: creditSummary.periodStartAt,
      periodEndAt: creditSummary.periodEndAt,
    },
    images: dailyImageSummary,
  };

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
    usage: fullUsage,
  };

  tTotal.stop();
  console.log(`[CHAT] ${tTotal.report()}\n`);
}


async function performEditImage(
  userId: string,
  imageInput: Buffer | string,
  prompt: string,
  maskInput?: Buffer | string,
  model?: string,
  providerOverride?: ImageProvider,
  apiKeyOverride?: string,
  conversationId?: string,
  messageId?: string,
): Promise<ImageResult> {
  const user = await User.findById(userId).select("subscription imagePlan imageCount24h lastImageResetAt");
  if (!user) throw ApiError.unauthorized("User no longer exists");

  // No plan restrictions during testing phase — all users can edit images
  const requestConfig = resolveImageEditModel(model, providerOverride ?? undefined);

  const persistEditedImage = async (resultUrl: string): Promise<string> => {
    if (!conversationId || !messageId) return resultUrl;
    const existing = await Message.findOne({ _id: messageId, conversationId });
    if (!existing) throw ApiError.notFound("The image message could not be found");
    const { buffer } = await resolveImageToBuffer(resultUrl);
    const storedUrl = await uploadImageToCloudinary(buffer, { folder: "omniai/generated" });
    await Message.updateOne(
      { _id: messageId, conversationId },
      { $set: { imageUrl: storedUrl, originalImageUrl: existing.originalImageUrl || existing.imageUrl } },
    );
    return storedUrl;
  };

  if (requestConfig.provider === "qwen") {
    const apiKey = apiKeyOverride ?? env.QWEN_API_KEY;
    if (!apiKey) throw ApiError.internal("QWEN_API_KEY is not configured.");
    const baseUrl = env.QWEN_API_BASE_URL.replace(/\/$/, "");

    const toBuffer = async (input: Buffer | string): Promise<Buffer> => {
      if (Buffer.isBuffer(input)) return input;
      if (input.startsWith("data:")) {
        const base64Index = input.indexOf(";base64,");
        if (base64Index !== -1) return Buffer.from(input.slice(base64Index + 8), "base64");
      }
      if (input.startsWith("http://") || input.startsWith("https://")) {
        const fetchRes = await fetch(input);
        if (!fetchRes.ok) throw ApiError.badRequest(`Unable to download image for editing (HTTP ${fetchRes.status})`);
        return Buffer.from(await fetchRes.arrayBuffer());
      }
      const buffer = Buffer.from(input, "base64");
      if (buffer.length === 0) throw ApiError.badRequest("Invalid image input");
      return buffer;
    };

    try {
      const imageBuffer = await toBuffer(imageInput);
      const imageContent = typeof imageInput === "string" && /^https?:\/\//i.test(imageInput)
        ? imageInput
        : `data:image/png;base64,${imageBuffer.toString("base64")}`;
      const model = requestConfig.model === "qwen-image-plus" ? "qwen-image-edit-plus" : requestConfig.model;
      const response = await fetch(`${baseUrl}/services/aigc/multimodal-generation/generation`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: {
            messages: [{
              role: "user",
              content: [{ image: imageContent }, { text: prompt }],
            }],
          },
          parameters: { n: 1, size: requestConfig.size, watermark: false, prompt_extend: true },
        }),
      });
      const responseText = await response.text();
      let body: any = {};
      try { body = responseText ? JSON.parse(responseText) : {}; } catch { body = { message: responseText }; }
      if (!response.ok) {
        const error = new Error(body.message || body.code || `Qwen image edit failed with status ${response.status}`) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }
      const imageUrl = body.output?.choices?.[0]?.message?.content?.find(
        (content: { image?: string }) => content.image,
      )?.image;
      if (!imageUrl) throw new Error("Qwen image edit returned no image URL");
      return {
        url: await persistEditedImage(imageUrl),
        modelId: requestConfig.model,
        usage: { inputImages: 1, generatedImages: 1, imageQuality: "high" },
        outputImages: 1,
      };
    } catch (err: any) {
      console.error("[QWEN IMAGE EDIT ERROR]", err?.message || err);
      throw imageProviderError("edit", err);
    }
  }

  if (requestConfig.provider === "wan") {
    throw new ApiError(501, "Wan image editing is not enabled in this phase.");
  }

  const client = getOpenAIClient(apiKeyOverride);

  const toBuffer = async (input: Buffer | string): Promise<Buffer> => {
    if (Buffer.isBuffer(input)) return input;
    if (typeof input === "string") {
      if (input.startsWith("data:")) {
        const base64Index = input.indexOf(";base64,");
        if (base64Index !== -1) {
          const buffer = Buffer.from(input.slice(base64Index + 8), "base64");
          if (buffer.length === 0) throw ApiError.badRequest("Invalid base64 image data");
          return buffer;
        }
      }
      if (input.startsWith("http://") || input.startsWith("https://")) {
        const fetchRes = await fetch(input);
        if (!fetchRes.ok) {
          throw ApiError.badRequest(`Unable to download image for editing (HTTP ${fetchRes.status})`);
        }
        const arrayBuf = await fetchRes.arrayBuffer();
        return Buffer.from(arrayBuf);
      }
      const buffer = Buffer.from(input, "base64");
      if (buffer.length === 0) throw ApiError.badRequest("Invalid base64 image data");
      return buffer;
    }
    throw ApiError.badRequest("Invalid image input");
  };

  const imageBuffer = await toBuffer(imageInput);
  const maskBuffer = maskInput ? await toBuffer(maskInput) : undefined;

  const imageFile = await toFile(imageBuffer, "image.png", { type: "image/png" });
  const maskFile = maskBuffer ? await toFile(maskBuffer, "mask.png", { type: "image/png" }) : undefined;

  let response: Awaited<ReturnType<typeof client.images.edit>>;
  try {
    response = await client.images.edit({
      model: requestConfig.model,
      image: imageFile,
      ...(maskFile ? { mask: maskFile } : {}),
      prompt: prompt,
      n: 1,
      size: requestConfig.size,
    } as any);
  } catch (err: any) {
    console.error("[IMAGE EDIT ERROR]", err?.message || err);
    throw imageProviderError("edit", err);
  }

  const item = response.data?.[0];
  if (!item) throw ApiError.internal("Image edit returned no result");

  if (item.b64_json) {
    return {
      url: await persistEditedImage(`data:image/png;base64,${item.b64_json}`),
      modelId: requestConfig.model,
      usage: normalizeOpenAIUsage(response.usage),
      outputImages: 1,
    };
  }

  if (item.url) {
    try {
      const imgRes = await fetch(item.url);
      const arrayBuffer = await imgRes.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const contentType = imgRes.headers.get("content-type") || "image/png";
      return {
        url: `data:${contentType};base64,${base64}`,
        modelId: requestConfig.model,
        usage: normalizeOpenAIUsage(response.usage),
        outputImages: 1,
      };
    } catch (err) {
      return {
        url: await persistEditedImage(item.url),
        modelId: requestConfig.model,
        usage: normalizeOpenAIUsage(response.usage),
        outputImages: 1,
      };
    }
  }

  throw ApiError.internal("Image edit returned no usable image data");
}

export async function editImage(
  userId: string,
  imageInput: Buffer | string,
  prompt: string,
  maskInput?: Buffer | string,
  model?: string,
  providerOverride?: ImageProvider,
  apiKeyOverride?: string,
  conversationId?: string,
  messageId?: string,
  requestId: string = randomUUID(),
): Promise<string> {
  const requestConfig = resolveImageEditModel(model, providerOverride);
  const result = await runBillableImage(
    userId,
    requestId,
    requestConfig.model,
    "image-edit",
    prompt,
    "high",
    true,
    () => performEditImage(
      userId,
      imageInput,
      prompt,
      maskInput,
      model,
      providerOverride,
      apiKeyOverride,
      conversationId,
      messageId,
    ),
  );
  return result.url;
}
