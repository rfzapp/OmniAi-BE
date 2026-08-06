import { ApiError } from "../../utils/ApiError";
import { getPromptLimit } from "../../config/plans";
import { decrypt } from "../../utils/encryption";
import { User } from "../user/user.model";
import * as userService from "../user/user.service";
import * as conversationService from "../conversation/conversation.service";
import { openaiProvider } from "./providers/openai.provider";
import type { ChatInput } from "./ai.validation";

const HISTORY_LIMIT = 20;
const BYOK_PROVIDER = "OpenAI";

export async function chat(userId: string, input: ChatInput) {
  const user = await User.findById(userId).select("subscription promptCount apiKeys.provider");
  if (!user) throw ApiError.unauthorized("User no longer exists");

  // BYOK: if the user has connected their own OpenAI key, use it and skip
  // the shared-quota limit entirely — they're spending their own budget.
  const usingOwnKey = user.apiKeys.some((entry) => entry.provider === BYOK_PROVIDER);

  const limit = getPromptLimit(user.subscription);
  if (!usingOwnKey && limit !== null && user.promptCount >= limit) {
    throw new ApiError(403, "Free prompt limit reached. Upgrade to Pro for unlimited prompts.");
  }

  const conversation = await conversationService.findOrCreateConversation(userId, input.model, input.message, input.conversationId);

  await conversationService.appendMessage(conversation.id as string, "user", input.message, input.model);

  const history = await conversationService.getRecentMessages(conversation.id as string, HISTORY_LIMIT);
  const providerMessages = history.map((m) => ({ role: m.role, content: m.content }));

  const encryptedKey = usingOwnKey ? await userService.getEncryptedApiKey(userId, BYOK_PROVIDER) : null;
  const apiKeyOverride = encryptedKey ? decrypt(encryptedKey) : undefined;
  const replyText = await openaiProvider.generateReply(input.model, providerMessages, apiKeyOverride);

  const assistantMessage = await conversationService.appendMessage(conversation.id as string, "assistant", replyText, input.model);
  await conversationService.touchConversation(conversation.id as string);

  const promptsUsed = usingOwnKey
    ? user.promptCount
    : (
        await User.findByIdAndUpdate(userId, { $inc: { promptCount: 1 } }, { new: true }).select("promptCount")
      )?.promptCount ?? user.promptCount + 1;

  return {
    conversation,
    message: assistantMessage,
    usage: {
      promptsUsed,
      promptsLimit: usingOwnKey ? null : limit,
    },
  };
}
