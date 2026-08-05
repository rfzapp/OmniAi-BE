import { ApiError } from "../../utils/ApiError";
import { getPromptLimit } from "../../config/plans";
import { User } from "../user/user.model";
import * as conversationService from "../conversation/conversation.service";
import { openaiProvider } from "./providers/openai.provider";
import type { ChatInput } from "./ai.validation";

const HISTORY_LIMIT = 20;

export async function chat(userId: string, input: ChatInput) {
  const user = await User.findById(userId).select("subscription promptCount");
  if (!user) throw ApiError.unauthorized("User no longer exists");

  const limit = getPromptLimit(user.subscription);
  if (limit !== null && user.promptCount >= limit) {
    throw new ApiError(403, "Free prompt limit reached. Upgrade to Pro for unlimited prompts.");
  }

  const conversation = await conversationService.findOrCreateConversation(userId, input.model, input.message, input.conversationId);

  await conversationService.appendMessage(conversation.id as string, "user", input.message, input.model);

  const history = await conversationService.getRecentMessages(conversation.id as string, HISTORY_LIMIT);
  const providerMessages = history.map((m) => ({ role: m.role, content: m.content }));

  const replyText = await openaiProvider.generateReply(input.model, providerMessages);

  const assistantMessage = await conversationService.appendMessage(conversation.id as string, "assistant", replyText, input.model);
  await conversationService.touchConversation(conversation.id as string);

  const updatedUser = await User.findByIdAndUpdate(userId, { $inc: { promptCount: 1 } }, { new: true }).select(
    "promptCount",
  );

  return {
    conversation,
    message: assistantMessage,
    usage: {
      promptsUsed: updatedUser?.promptCount ?? user.promptCount + 1,
      promptsLimit: limit,
    },
  };
}
