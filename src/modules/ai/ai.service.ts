import { ApiError } from "../../utils/ApiError";
import { getPromptLimit, canGenerateImages, getAttachmentLimit, getImageLimit, getPromptCharLimit } from "../../config/plans";
import { User } from "../user/user.model";
import * as conversationService from "../conversation/conversation.service";
import { openaiProvider } from "./providers/openai.provider";
import { anthropicProvider } from "./providers/anthropic.provider";
import { groqProvider } from "./providers/groq.provider";
import { deepseekProvider } from "./providers/deepseek.provider";
import { qwenProvider } from "./providers/qwen.provider";
import { mistralProvider } from "./providers/mistral.provider";
import { kimiProvider } from "./providers/kimi.provider";
import { getOpenAIClient } from "../../config/openai";
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

// Keywords that indicate the user wants an image generated.
const IMAGE_INTENT_PATTERNS = [
  /\b(generate|create|make|draw|paint|design|show|produce)\b.{0,40}\b(image|picture|photo|illustration|artwork|poster|logo|banner|icon)\b/i,
  /\b(image|picture|photo|illustration|artwork)\b.{0,20}\b(of|showing|depicting|with)\b/i,
  /\bdall[-\s]?e\b/i,
];

function buildMemoryContext(user: { preferences?: { memoryEnabled?: boolean }; memories?: Array<{ content: string }> }): string {
  if (user.preferences?.memoryEnabled === false || !Array.isArray(user.memories) || user.memories.length === 0) {
    return "";
  }
  const list = user.memories.map((m) => `- ${m.content}`).join("\n");
  return `\n\n[User Memory Context]\nOmniAI remembers the following details about the user across conversations:\n${list}\nUse this context to provide personalized and relevant responses naturally.`;
}

function isImageRequest(message: string): boolean {
  return IMAGE_INTENT_PATTERNS.some((pattern) => pattern.test(message));
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text: string }>;
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

      if (mime.startsWith("image/")) {
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
        // Fallback: try reading as UTF-8 string for general files
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

function buildImageContentParts(files: Express.Multer.File[] | undefined) {
  if (!files || files.length === 0) return [];

  return files
    .filter((file) => (file.mimetype || "").startsWith("image/"))
    .map((file) => {
      const base64 = file.buffer.toString("base64");
      const mime = file.mimetype || "image/png";
      return {
        type: "image_url" as const,
        image_url: {
          url: `data:${mime};base64,${base64}`,
          detail: "auto" as const,
        },
      };
    });
}

async function generateImage(prompt: string, apiKeyOverride?: string): Promise<string> {
  const client = getOpenAIClient(apiKeyOverride);
  const response = await client.images.generate({
    model: "gpt-image-2",
    prompt,
    n: 1,
    size: "1024x1024",
  });

  // gpt-image-2 returns base64 by default, dall-e returns URLs.
  // Handle both formats gracefully.
  const item = response.data?.[0];
  if (!item) throw ApiError.internal("Image generation returned no result");

  if (item.url) return item.url;

  if (item.b64_json) {
    return `data:image/png;base64,${item.b64_json}`;
  }

  throw ApiError.internal("Image generation returned no usable data");
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

  const wantsImage = isImageRequest(input.message);

  if (wantsImage && !canGenerateImages(user.imagePlan)) {
    throw new ApiError(403, "Image generation requires an Image Generation plan. Please subscribe to unlock it.");
  }

  if (wantsImage) {
    const imageLimit = getImageLimit(user.imagePlan);
    const lastImageReset = user.lastImageResetAt ? new Date(user.lastImageResetAt) : now;
    const imageCount = (now.getTime() - lastImageReset.getTime() >= resetInterval)
      ? 0
      : (user.imageCount24h ?? 0);
    if (imageCount >= imageLimit) {
      throw new ApiError(403, `Monthly image limit reached for your plan (${imageLimit} images/month). Upgrade your Image Generation plan for more.`);
    }
  }

  const imageParts = buildImageContentParts(files);
  const userImageUrl = imageParts[0]?.image_url.url;

  const provider = getProvider(input.model);

  // Append clean user message to DB first, then fetch history for AI context
  await conversationService.appendMessage(conversation.id as string, "user", dbUserMessage, input.model, userImageUrl);
  const history = wantsImage
    ? []
    : await conversationService.getRecentMessages(conversation.id as string, HISTORY_LIMIT);

  let replyText: string;
  let imageUrl: string | undefined;

  if (wantsImage) {
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

  if (wantsImage) {
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
 * Validates limits and sets up the conversation synchronously,
 * then yields tokens as they arrive from the AI provider.
 * Yields string tokens first, then a final object with conversation/usage metadata.
 */
export async function* chatStream(
  userId: string,
  input: ChatInput,
  files?: Express.Multer.File[],
  signal?: AbortSignal,
): AsyncGenerator<import("./providers/provider.types").AIStreamChunk | { done: true; conversation: object; message: object; usage: object }> {
  const tTotal = new LatencyTimer("Total");
  tTotal.start();

  const tUser = new LatencyTimer("User lookup");
  tUser.start();
  const user = await User.findById(userId).select(
    "subscription imagePlan promptCount promptCount24h attachmentCount24h imageCount24h lastImageResetAt lastPromptResetAt preferences.memoryEnabled memories",
  );
  tUser.stop();
  console.log(`[CHAT] ${tUser.report()}`);

  if (!user) throw ApiError.unauthorized("User no longer exists");

  // Enforce per-message character limit based on plan
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

  const freePromptLimit = limit ?? 3;
  if (user.subscription === "free") {
    // Free plan uses promptCount (all-time lifetime total) — 3 prompts forever, no reset
    if (user.promptCount >= freePromptLimit)
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

  const tAttachment = new LatencyTimer("Attachment processing");
  const tConversation = new LatencyTimer("Conversation lookup/create");

  tAttachment.start();
  const attachmentContextPromise = extractAttachmentContext(files, input.model).then(res => {
    tAttachment.stop();
    console.log(`[CHAT] ${tAttachment.report()}`);
    return res;
  });

  tConversation.start();
  const conversationPromise = conversationService.findOrCreateConversation(userId, input.model, input.message, input.conversationId).then(res => {
    tConversation.stop();
    console.log(`[CHAT] ${tConversation.report()}`);
    return res;
  });

  const [attachmentContext, conversation] = await Promise.all([
    attachmentContextPromise,
    conversationPromise,
  ]);

  const memoryContext = buildMemoryContext(user);
  const dbUserMessage = [input.message, attachmentContext].filter(Boolean).join("\n\n");
  const aiPromptMessage = [input.message, memoryContext, attachmentContext].filter(Boolean).join("\n\n");
  const imageParts = buildImageContentParts(files);
  const userImageUrl = imageParts[0]?.image_url.url;
  const provider = getProvider(input.model);

  const tContext = new LatencyTimer("Context construction");
  tContext.start();

  // Append user message and fetch history in parallel — history fetch doesn't
  // need the user message to exist yet since it was just created this turn.
  const tHistory = new LatencyTimer("History fetch");
  tHistory.start();

  const [, history] = await Promise.all([
    conversationService.appendMessage(conversation.id as string, "user", dbUserMessage, input.model, userImageUrl),
    conversationService.getRecentMessages(conversation.id as string, HISTORY_LIMIT).then(res => {
      tHistory.stop();
      console.log(`[CHAT] ${tHistory.report()}`);
      return res;
    }),
  ]);

  const providerMessages: ProviderChatMessage[] = history.map((m) => ({ role: m.role, content: m.content }));

  // Add the current user message (appended in parallel so may not be in history yet)
  providerMessages.push({ role: "user", content: aiPromptMessage });

  if (imageParts.length > 0) {
    // The last message is always the current user message we just pushed
    const lastUser = providerMessages[providerMessages.length - 1];
    if (lastUser && lastUser.role === "user") {
      const textContent = String(lastUser.content || "").trim();
      lastUser.content = textContent
        ? [{ type: "text", text: textContent }, ...imageParts]
        : [...imageParts];
    }
  }

  tContext.stop();
  console.log(`[CHAT] ${tContext.report()}`);

  const providerName = ((input.model || "").split('-')[0] ?? "").toUpperCase();
  console.log(`\n[${providerName}] Request started`);

  const tProvider = new LatencyTimer("Provider stream");
  tProvider.start();

  const tTTFT = new LatencyTimer("TTFT");
  tTTFT.start();

  // Stream tokens to the caller
  let fullReply = "";
  let firstToken = true;

  yield { type: "start", conversationId: conversation.id } as unknown as AIStreamChunk;

  for await (const chunk of provider.generateStream(input.model, providerMessages, undefined, signal)) {
    if (chunk.type === "start") continue;

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

  tProvider.stop();
  console.log(`[${providerName}] Total: ${tProvider.elapsed()}ms\n`);

  // Persist + update counters after streaming completes
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

  const [assistantMessage, updatedUser] = await Promise.all([
    conversationService.appendMessage(conversation.id as string, "assistant", fullReply, input.model),
    User.findByIdAndUpdate(userId, updateFields, { new: true }).select("promptCount promptCount24h attachmentCount24h"),
  ]);
  void conversationService.touchConversation(conversation.id as string);

  const promptsUsed = updatedUser?.promptCount ?? user.promptCount + 1;
  const promptsUsed24h = updatedUser?.promptCount24h ?? promptCount24h + 1;

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
      imageUrl: null,
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
