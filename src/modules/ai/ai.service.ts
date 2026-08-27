import { ApiError } from "../../utils/ApiError";
import { getPromptLimit, canGenerateImages, getAttachmentLimit, getImageLimit, getPromptCharLimit } from "../../config/plans";
import { decrypt } from "../../utils/encryption";
import { User } from "../user/user.model";
import * as userService from "../user/user.service";
import * as conversationService from "../conversation/conversation.service";
import { openaiProvider } from "./providers/openai.provider";
import { anthropicProvider } from "./providers/anthropic.provider";
import { groqProvider } from "./providers/groq.provider";
import { deepseekProvider } from "./providers/deepseek.provider";
import { qwenProvider } from "./providers/qwen.provider";
import { mistralProvider } from "./providers/mistral.provider";
import { kimiProvider } from "./providers/kimi.provider";
import { getOpenAIClient } from "../../config/openai";
import { supportsVision } from "../../config/capabilities";
import type { ChatInput } from "./ai.validation";
import type { ProviderChatMessage } from "./providers/provider.types";

const HISTORY_LIMIT = 20;
const BYOK_PROVIDER_OPENAI = "OpenAI";
const BYOK_PROVIDER_ANTHROPIC = "Anthropic";
const BYOK_PROVIDER_GROQ = "Groq";
const BYOK_PROVIDER_DEEPSEEK = "DeepSeek";
const BYOK_PROVIDER_QWEN = "Qwen";
const BYOK_PROVIDER_MISTRAL = "Mistral";
const BYOK_PROVIDER_KIMI = "Kimi";

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

/** Pick the right BYOK provider name based on model. */
function getByokProvider(model: string): string {
  if (model.startsWith("claude-")) return BYOK_PROVIDER_ANTHROPIC;
  if (model.startsWith("grok-")) return BYOK_PROVIDER_GROQ;
  if (model.startsWith("deepseek-")) return BYOK_PROVIDER_DEEPSEEK;
  if (model.startsWith("qwen-")) return BYOK_PROVIDER_QWEN;
  if (model.startsWith("mistral-") || model.startsWith("codestral-")) return BYOK_PROVIDER_MISTRAL;
  if (model.startsWith("moonshot-") || model.startsWith("kimi-")) return BYOK_PROVIDER_KIMI;
  return BYOK_PROVIDER_OPENAI;
}

// Keywords that indicate the user wants an image generated.
const IMAGE_INTENT_PATTERNS = [
  /\b(generate|create|make|draw|paint|design|show|produce)\b.{0,40}\b(image|picture|photo|illustration|artwork|poster|logo|banner|icon)\b/i,
  /\b(image|picture|photo|illustration|artwork)\b.{0,20}\b(of|showing|depicting|with)\b/i,
  /\bdall[-\s]?e\b/i,
];

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
        text = await extractPdfText(file.buffer);
      } else if (
        mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        mime === "application/msword" ||
        lower.endsWith(".docx") ||
        lower.endsWith(".doc")
      ) {
        text = await extractDocxText(file.buffer);
      } else if (
        mime === "application/vnd.ms-excel" ||
        mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        lower.endsWith(".xls") ||
        lower.endsWith(".xlsx")
      ) {
        text = extractXlsxText(file.buffer);
      } else {
        throw ApiError.badRequest(`Unsupported attachment type: ${name}`);
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

// ─── Shared setup ─────────────────────────────────────────────────────────────

interface PreparedChat {
  user: Awaited<ReturnType<typeof User.findById>> & NonNullable<unknown>;
  usingOwnKey: boolean;
  limit: number | null;
  now: Date;
  resetInterval: number;
  needsReset: boolean;
  promptCount24h: number;
  attachmentCount24h: number;
  conversation: Awaited<ReturnType<typeof conversationService.findOrCreateConversation>>;
  combinedMessage: string;
  imageParts: ReturnType<typeof buildImageContentParts>;
  userImageUrl: string | undefined;
  apiKeyOverride: string | undefined;
  provider: ReturnType<typeof getProvider>;
  wantsImage: boolean;
}

/**
 * Validates limits, fetches user, creates/finds conversation, and prepares all
 * context needed to generate a reply. Shared between chat() and chatStream().
 */
async function prepareChat(
  userId: string,
  input: ChatInput,
  files?: Express.Multer.File[],
): Promise<PreparedChat> {
  const user = await User.findById(userId).select(
    "subscription imagePlan promptCount promptCount24h attachmentCount24h imageCount24h lastImageResetAt lastPromptResetAt apiKeys.provider",
  );
  if (!user) throw ApiError.unauthorized("User no longer exists");

  const byokProvider = getByokProvider(input.model);
  const usingOwnKey = user.apiKeys.some((entry) => entry.provider === byokProvider);
  const limit = getPromptLimit(user.subscription);

  const now = new Date();
  const resetInterval = 30 * 24 * 60 * 60 * 1000;
  const originalLastResetAt = user.lastPromptResetAt ? new Date(user.lastPromptResetAt) : null;
  const needsReset = !originalLastResetAt || now.getTime() - originalLastResetAt.getTime() >= resetInterval;
  const promptCount24h = needsReset ? 0 : (user.promptCount24h || 0);
  const attachmentCount24h = needsReset ? 0 : (user.attachmentCount24h || 0);

  if (!usingOwnKey) {
    if (user.subscription === "free") {
      if (user.promptCount >= (limit ?? 3))
        throw new ApiError(403, "Free prompt limit reached. Please upgrade your plan.");
      if (files && files.length > 0)
        throw new ApiError(403, "File attachments are not allowed on the Free plan. Please upgrade to Standard or higher.");
    } else {
      if (limit !== null && promptCount24h + 1 > limit)
        throw new ApiError(403, `Monthly prompt limit reached for your ${user.subscription} plan (${limit} prompts/month). Limit resets every 30 days.`);
      const attachmentLimit = getAttachmentLimit(user.subscription);
      if (attachmentCount24h + (files?.length ?? 0) > attachmentLimit)
        throw new ApiError(403, `Monthly file attachment limit reached for your ${user.subscription} plan (${attachmentLimit} attachments).`);
    }
  }

  const [attachmentContext, conversation, encryptedKey] = await Promise.all([
    extractAttachmentContext(files, input.model),
    conversationService.findOrCreateConversation(userId, input.model, input.message, input.conversationId),
    usingOwnKey ? userService.getEncryptedApiKey(userId, byokProvider) : Promise.resolve(null),
  ]);

  const combinedMessage = [input.message, attachmentContext].filter(Boolean).join("\n\n");
  const wantsImage = isImageRequest(input.message);
  const imageParts = buildImageContentParts(files);
  const userImageUrl = imageParts[0]?.image_url.url;
  const apiKeyOverride = encryptedKey ? decrypt(encryptedKey) : undefined;
  const provider = getProvider(input.model);

  if (wantsImage && !canGenerateImages(user.imagePlan) && !usingOwnKey)
    throw new ApiError(403, "Image generation requires an Image Generation plan. Please subscribe to unlock it.");

  if (wantsImage && !usingOwnKey) {
    const imageLimit = getImageLimit(user.imagePlan);
    const lastImageReset = user.lastImageResetAt ? new Date(user.lastImageResetAt) : now;
    const imageCount = now.getTime() - lastImageReset.getTime() >= resetInterval ? 0 : (user.imageCount24h ?? 0);
    if (imageCount >= imageLimit)
      throw new ApiError(403, `Daily image limit reached for your plan (${imageLimit} images/day). Upgrade your Image Generation plan for more.`);
  }

  return {
    user: user as NonNullable<typeof user>,
    usingOwnKey, limit, now, resetInterval, needsReset,
    promptCount24h, attachmentCount24h,
    conversation, combinedMessage, imageParts, userImageUrl,
    apiKeyOverride, provider, wantsImage,
  };
}

/** Builds the counter update fields — shared between chat() and chatStream(). */
function buildUpdateFields(
  usingOwnKey: boolean,
  subscription: string,
  needsReset: boolean,
  promptCount24h: number,
  files?: Express.Multer.File[],
  wantsImage = false,
  lastImageResetAt?: Date,
  now?: Date,
  resetInterval?: number,
  imageCount24h?: number,
): Record<string, any> {
  const updateFields: Record<string, any> = { $inc: { promptCount: 1 } };

  if (!usingOwnKey) {
    if (needsReset) {
      updateFields.$set = {
        promptCount24h: subscription === "free" ? (promptCount24h ?? 0) : 1,
        attachmentCount24h: subscription === "free" ? 0 : (files?.length ?? 0),
        lastPromptResetAt: now,
      };
    } else if (subscription !== "free") {
      updateFields.$inc.promptCount24h = 1;
      updateFields.$inc.attachmentCount24h = files?.length ?? 0;
    }
  }

  if (wantsImage && !usingOwnKey && now && resetInterval !== undefined && lastImageResetAt !== undefined) {
    const imageIsReset = now.getTime() - lastImageResetAt.getTime() >= resetInterval;
    if (imageIsReset) {
      updateFields.$set = { ...(updateFields.$set ?? {}), imageCount24h: 1, lastImageResetAt: now };
    } else {
      updateFields.$inc.imageCount24h = 1;
    }
  }

  return updateFields;
}

export async function chat(userId: string, input: ChatInput, files?: Express.Multer.File[]) {
  const user = await User.findById(userId).select("subscription imagePlan promptCount promptCount24h attachmentCount24h imageCount24h lastImageResetAt lastPromptResetAt apiKeys.provider");
  if (!user) throw ApiError.unauthorized("User no longer exists");

  // Enforce per-message character limit based on plan
  const charLimit = getPromptCharLimit(user.subscription);
  if (input.message.length > charLimit) {
    throw new ApiError(403, `Message exceeds the ${charLimit.toLocaleString()}-character limit for your plan. Upgrade to Ultra Pro for up to 8,000 characters per message.`);
  }

  const byokProvider = getByokProvider(input.model);
  const usingOwnKey = user.apiKeys.some((entry) => entry.provider === byokProvider);
  const limit = getPromptLimit(user.subscription);

  const now = new Date();
  const resetInterval = 30 * 24 * 60 * 60 * 1000; // 30-day monthly window
  const originalLastResetAt = user.lastPromptResetAt ? new Date(user.lastPromptResetAt) : null;
  const needsReset = !originalLastResetAt || (now.getTime() - originalLastResetAt.getTime() >= resetInterval);

  let promptCount24h = needsReset ? 0 : (user.promptCount24h || 0);
  let attachmentCount24h = needsReset ? 0 : (user.attachmentCount24h || 0);

  if (!usingOwnKey) {
    if (user.subscription === "free") {
      const freePromptLimit = limit ?? 3;
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
  }

  // Parse attachments + find/create conversation + fetch BYOK key — all in parallel
  const [attachmentContext, conversation, encryptedKey] = await Promise.all([
    extractAttachmentContext(files, input.model),
    conversationService.findOrCreateConversation(userId, input.model, input.message, input.conversationId),
    usingOwnKey ? userService.getEncryptedApiKey(userId, byokProvider) : Promise.resolve(null),
  ]);

  const combinedMessage = [input.message, attachmentContext].filter(Boolean).join("\n\n");

  const wantsImage = isImageRequest(input.message);

  if (wantsImage && !canGenerateImages(user.imagePlan) && !usingOwnKey) {
    throw new ApiError(403, "Image generation requires an Image Generation plan. Please subscribe to unlock it.");
  }

  if (wantsImage && !usingOwnKey) {
    const imageLimit = getImageLimit(user.imagePlan);
    const lastImageReset = user.lastImageResetAt ? new Date(user.lastImageResetAt) : now;
    const imageCount = (now.getTime() - lastImageReset.getTime() >= resetInterval)
      ? 0
      : (user.imageCount24h ?? 0);
    if (imageCount >= imageLimit) {
      throw new ApiError(403, `Daily image limit reached for your plan (${imageLimit} images/day). Upgrade your Image Generation plan for more.`);
    }
  }

  const imageParts = buildImageContentParts(files);
  const userImageUrl = imageParts[0]?.image_url.url;

  const apiKeyOverride = encryptedKey ? decrypt(encryptedKey) : undefined;
  const provider = getProvider(input.model);

  // Append user message first, then fetch history for AI context
  await conversationService.appendMessage(conversation.id as string, "user", combinedMessage, input.model, userImageUrl);
  const history = wantsImage
    ? []
    : await conversationService.getRecentMessages(conversation.id as string, HISTORY_LIMIT);

  let replyText: string;
  let imageUrl: string | undefined;

  if (wantsImage) {
    imageUrl = await generateImage(input.message, apiKeyOverride);
    replyText = "Here is your generated image.";
  } else {
    const providerMessages: ProviderChatMessage[] = history.map((m) => ({ role: m.role, content: m.content }));
    if (imageParts.length > 0) {
      const lastUser = [...providerMessages].reverse().find((m) => m.role === "user");
      if (lastUser) {
        const textContent = String(lastUser.content || "").trim();
        lastUser.content = textContent
          ? [{ type: "text", text: textContent }, ...imageParts]
          : [...imageParts];
      }
    }
    replyText = await provider.generateReply(input.model, providerMessages, apiKeyOverride);
  }

  // Append assistant reply + update user counters in parallel; touch conversation fire-and-forget
  const updateFields: Record<string, any> = {
    $inc: { promptCount: 1 },
  };

  if (!usingOwnKey) {
    if (needsReset) {
      updateFields.$set = {
        promptCount24h: user.subscription === "free" ? (user.promptCount24h ?? 0) : 1,
        attachmentCount24h: user.subscription === "free" ? 0 : (files ? files.length : 0),
        lastPromptResetAt: now,
      };
    } else if (user.subscription !== "free") {
      updateFields.$inc.promptCount24h = 1;
      updateFields.$inc.attachmentCount24h = files ? files.length : 0;
    }
  }

  if (wantsImage && !usingOwnKey) {
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

  const promptsUsed = usingOwnKey
    ? user.promptCount
    : updatedUser?.promptCount ?? user.promptCount + 1;

  const promptsUsed24h = usingOwnKey
    ? (user.promptCount24h ?? 0)
    : updatedUser?.promptCount24h ?? (promptCount24h + 1);

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
      promptsLimit: usingOwnKey ? null : limit,
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
): AsyncGenerator<string | { done: true; conversation: object; message: object; usage: object }> {
  const user = await User.findById(userId).select(
    "subscription imagePlan promptCount promptCount24h attachmentCount24h imageCount24h lastImageResetAt lastPromptResetAt apiKeys.provider",
  );
  if (!user) throw ApiError.unauthorized("User no longer exists");

  // Enforce per-message character limit based on plan
  const charLimit = getPromptCharLimit(user.subscription);
  if (input.message.length > charLimit) {
    throw new ApiError(403, `Message exceeds the ${charLimit.toLocaleString()}-character limit for your plan. Upgrade to Ultra Pro for up to 8,000 characters per message.`);
  }

  const byokProvider = getByokProvider(input.model);
  const usingOwnKey = user.apiKeys.some((entry) => entry.provider === byokProvider);
  const limit = getPromptLimit(user.subscription);

  const now = new Date();
  const resetInterval = 30 * 24 * 60 * 60 * 1000;
  const originalLastResetAt = user.lastPromptResetAt ? new Date(user.lastPromptResetAt) : null;
  const needsReset = !originalLastResetAt || now.getTime() - originalLastResetAt.getTime() >= resetInterval;

  const promptCount24h = needsReset ? 0 : (user.promptCount24h || 0);
  const attachmentCount24h = needsReset ? 0 : (user.attachmentCount24h || 0);

  if (!usingOwnKey) {
    if (user.subscription === "free") {
      const freePromptLimit = limit ?? 3;
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
  }

  const [attachmentContext, conversation, encryptedKey] = await Promise.all([
    extractAttachmentContext(files, input.model),
    conversationService.findOrCreateConversation(userId, input.model, input.message, input.conversationId),
    usingOwnKey ? userService.getEncryptedApiKey(userId, byokProvider) : Promise.resolve(null),
  ]);

  const combinedMessage = [input.message, attachmentContext].filter(Boolean).join("\n\n");
  const imageParts = buildImageContentParts(files);
  const userImageUrl = imageParts[0]?.image_url.url;
  const apiKeyOverride = encryptedKey ? decrypt(encryptedKey) : undefined;
  const provider = getProvider(input.model);

  // Append user message and fetch history in parallel — history fetch doesn't
  // need the user message to exist yet since it was just created this turn.
  const [, history] = await Promise.all([
    conversationService.appendMessage(conversation.id as string, "user", combinedMessage, input.model, userImageUrl),
    conversationService.getRecentMessages(conversation.id as string, HISTORY_LIMIT),
  ]);

  const providerMessages: ProviderChatMessage[] = history.map((m) => ({ role: m.role, content: m.content }));

  // Add the current user message (appended in parallel so may not be in history yet)
  providerMessages.push({ role: "user", content: combinedMessage });

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

  // Stream tokens to the caller
  let fullReply = "";
  for await (const token of provider.generateStream(input.model, providerMessages, apiKeyOverride)) {
    fullReply += token;
    yield token;
  }

  // Persist + update counters after streaming completes
  const updateFields: Record<string, any> = { $inc: { promptCount: 1 } };
  if (!usingOwnKey) {
    if (needsReset) {
      updateFields.$set = {
        promptCount24h: user.subscription === "free" ? (user.promptCount24h ?? 0) : 1,
        attachmentCount24h: user.subscription === "free" ? 0 : (files ? files.length : 0),
        lastPromptResetAt: now,
      };
    } else if (user.subscription !== "free") {
      updateFields.$inc.promptCount24h = 1;
      updateFields.$inc.attachmentCount24h = files ? files.length : 0;
    }
  }

  const [assistantMessage, updatedUser] = await Promise.all([
    conversationService.appendMessage(conversation.id as string, "assistant", fullReply, input.model),
    User.findByIdAndUpdate(userId, updateFields, { new: true }).select("promptCount promptCount24h attachmentCount24h"),
  ]);
  void conversationService.touchConversation(conversation.id as string);

  const promptsUsed = usingOwnKey ? user.promptCount : (updatedUser?.promptCount ?? user.promptCount + 1);
  const promptsUsed24h = usingOwnKey ? (user.promptCount24h ?? 0) : (updatedUser?.promptCount24h ?? promptCount24h + 1);

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
      promptsLimit: usingOwnKey ? null : limit,
    },
  };
}
