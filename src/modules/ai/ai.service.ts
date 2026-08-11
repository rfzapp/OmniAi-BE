import { ApiError } from "../../utils/ApiError";
import { getPromptLimit, canGenerateImages, getAttachmentLimit } from "../../config/plans";
import { decrypt } from "../../utils/encryption";
import { User } from "../user/user.model";
import * as userService from "../user/user.service";
import * as conversationService from "../conversation/conversation.service";
import { openaiProvider } from "./providers/openai.provider";
import { getOpenAIClient } from "../../config/openai";
import { supportsVision } from "../../config/capabilities";
import type { ChatInput } from "./ai.validation";
import type { ProviderChatMessage } from "./providers/provider.types";
const HISTORY_LIMIT = 20;
const BYOK_PROVIDER = "OpenAI";
const { PDFParse } = require("pdf-parse");
const mammoth = require("mammoth");
const XLSX = require("xlsx");

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
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.text?.trim() || "";
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value?.trim() || "";
}

function extractXlsxText(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const rows: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
    rows.push(`Worksheet: ${sheetName}`);
    rows.push(JSON.stringify(data).slice(0, 8000));
  }

  return rows.join("\n\n");
}

async function extractAttachmentContext(files: Express.Multer.File[] | undefined, model: string): Promise<string> {
  if (!files || files.length === 0) return "";

  const sections: string[] = [];

  for (const file of files) {
    const name = file.originalname || file.filename || file.fieldname || "attached file";
    const lower = name.toLowerCase();
    const mime = file.mimetype || "application/octet-stream";

    if (mime.startsWith("image/")) {
      if (!supportsVision(model)) {
        throw ApiError.badRequest("This model does not support image attachments. Please select a vision-capable model.");
      }
      // For vision-capable models, we skip textual fallbacks so the model
      // receives the absolute image payload via buildImageContentParts.
      continue;
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
      sections.push(`Attachment file ${name} (${mime}, ${file.size} bytes) was received but did not yield readable text.`);
    } else {
      sections.push(`Attachment file ${name} (${mime}, ${file.size} bytes) content:\n${text}`);
    }
  }

  return sections.join("\n\n");
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
  const user = await User.findById(userId).select("subscription imagePlan promptCount promptCount24h attachmentCount24h lastPromptResetAt apiKeys.provider");
  if (!user) throw ApiError.unauthorized("User no longer exists");

  const usingOwnKey = user.apiKeys.some((entry) => entry.provider === BYOK_PROVIDER);
  const limit = getPromptLimit(user.subscription);

  const now = new Date();
  const resetInterval = 24 * 60 * 60 * 1000;
  let promptCount24h = user.promptCount24h || 0;
  let attachmentCount24h = user.attachmentCount24h || 0;
  let lastPromptResetAt = user.lastPromptResetAt ? new Date(user.lastPromptResetAt) : now;

  if (now.getTime() - lastPromptResetAt.getTime() >= resetInterval) {
    promptCount24h = 0;
    attachmentCount24h = 0;
    lastPromptResetAt = now;
  }

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
        throw new ApiError(403, `Daily prompt limit reached for your ${user.subscription} plan (${promptLimit} prompts).`);
      }

      const attachmentLimit = getAttachmentLimit(user.subscription);
      const attachmentsCount = files ? files.length : 0;
      if ((attachmentCount24h + attachmentsCount) > attachmentLimit) {
        throw new ApiError(403, `Daily file attachment limit reached for your ${user.subscription} plan (${attachmentLimit} attachments).`);
      }
    }
  }

  const attachmentContext = await extractAttachmentContext(files, input.model);
  const combinedMessage = [input.message, attachmentContext].filter(Boolean).join("\n\n");

  const wantsImage = isImageRequest(input.message);

  if (wantsImage && !canGenerateImages(user.imagePlan) && !usingOwnKey) {
    throw new ApiError(403, "Image generation requires an Image Generation plan. Please subscribe to unlock it.");
  }

  const imageParts = buildImageContentParts(files);
  const userImageUrl = imageParts[0]?.image_url.url;

  const conversation = await conversationService.findOrCreateConversation(userId, input.model, combinedMessage, input.conversationId);
  await conversationService.appendMessage(conversation.id as string, "user", combinedMessage, input.model, userImageUrl);

  const encryptedKey = usingOwnKey ? await userService.getEncryptedApiKey(userId, BYOK_PROVIDER) : null;
  const apiKeyOverride = encryptedKey ? decrypt(encryptedKey) : undefined;

  let replyText: string;
  let imageUrl: string | undefined;

  if (wantsImage) {
    imageUrl = await generateImage(input.message, apiKeyOverride);
    replyText = "Here is your generated image.";
  } else {
    const history = await conversationService.getRecentMessages(conversation.id as string, HISTORY_LIMIT);
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

    replyText = await openaiProvider.generateReply(input.model, providerMessages, apiKeyOverride);
  }

  const assistantMessage = await conversationService.appendMessage(conversation.id as string, "assistant", replyText, input.model, imageUrl);
  await conversationService.touchConversation(conversation.id as string);

  const updateFields: any = {
    $inc: { promptCount: 1 }
  };

  if (!usingOwnKey && user.subscription !== "free") {
    const isReset = now.getTime() - lastPromptResetAt.getTime() >= resetInterval;
    if (isReset || !user.lastPromptResetAt) {
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

  const updatedUser = await User.findByIdAndUpdate(userId, updateFields, { new: true })
    .select("promptCount promptCount24h attachmentCount24h");

  const promptsUsed = usingOwnKey
    ? user.promptCount
    : updatedUser?.promptCount ?? user.promptCount + 1;

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
    // Return plaintext content — the stored version is encrypted at rest.
    // The controller sends this directly to the frontend.
    message: assistantPayload,
    imageUrl,
    usage: {
      promptsUsed,
      promptsLimit: usingOwnKey ? null : limit,
    },
  };
}
