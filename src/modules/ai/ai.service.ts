import { ApiError } from "../../utils/ApiError";
import { getPromptLimit, canGenerateImages } from "../../config/plans";
import { decrypt } from "../../utils/encryption";
import { User } from "../user/user.model";
import * as userService from "../user/user.service";
import * as conversationService from "../conversation/conversation.service";
import { openaiProvider } from "./providers/openai.provider";
import { getOpenAIClient } from "../../config/openai";
import type { ChatInput } from "./ai.validation";
const HISTORY_LIMIT = 20;
const BYOK_PROVIDER = "OpenAI";

// Keywords that indicate the user wants an image generated.
const IMAGE_INTENT_PATTERNS = [
  /\b(generate|create|make|draw|paint|design|show|produce)\b.{0,40}\b(image|picture|photo|illustration|artwork|poster|logo|banner|icon)\b/i,
  /\b(image|picture|photo|illustration|artwork)\b.{0,20}\b(of|showing|depicting|with)\b/i,
  /\bdall[-\s]?e\b/i,
];

function isImageRequest(message: string): boolean {
  return IMAGE_INTENT_PATTERNS.some((pattern) => pattern.test(message));
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

export async function chat(userId: string, input: ChatInput) {
  const user = await User.findById(userId).select("subscription imagePlan promptCount apiKeys.provider");
  if (!user) throw ApiError.unauthorized("User no longer exists");

  const usingOwnKey = user.apiKeys.some((entry) => entry.provider === BYOK_PROVIDER);
  const limit = getPromptLimit(user.subscription);

  if (!usingOwnKey && limit !== null && user.promptCount >= limit) {
    throw new ApiError(403, "Free prompt limit reached. Upgrade to Pro for unlimited prompts.");
  }

  const wantsImage = isImageRequest(input.message);

  if (wantsImage && !canGenerateImages(user.imagePlan) && !usingOwnKey) {
    throw new ApiError(403, "Image generation requires an Image Generation plan. Please subscribe to unlock it.");
  }

  const conversation = await conversationService.findOrCreateConversation(userId, input.model, input.message, input.conversationId);
  await conversationService.appendMessage(conversation.id as string, "user", input.message, input.model);

  const encryptedKey = usingOwnKey ? await userService.getEncryptedApiKey(userId, BYOK_PROVIDER) : null;
  const apiKeyOverride = encryptedKey ? decrypt(encryptedKey) : undefined;

  let replyText: string;
  let imageUrl: string | undefined;

  if (wantsImage) {
    imageUrl = await generateImage(input.message, apiKeyOverride);
    replyText = "Here is your generated image.";
  } else {
    const history = await conversationService.getRecentMessages(conversation.id as string, HISTORY_LIMIT);
    const providerMessages = history.map((m) => ({ role: m.role, content: m.content }));
    replyText = await openaiProvider.generateReply(input.model, providerMessages, apiKeyOverride);
  }

  const assistantMessage = await conversationService.appendMessage(conversation.id as string, "assistant", replyText, input.model, imageUrl);
  await conversationService.touchConversation(conversation.id as string);

  const promptsUsed = usingOwnKey
    ? user.promptCount
    : (
        await User.findByIdAndUpdate(userId, { $inc: { promptCount: 1 } }, { new: true }).select("promptCount")
      )?.promptCount ?? user.promptCount + 1;

  return {
    conversation,
    message: assistantMessage,
    imageUrl,
    usage: {
      promptsUsed,
      promptsLimit: usingOwnKey ? null : limit,
    },
  };
}
