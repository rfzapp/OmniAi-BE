import { z } from "zod";

export const chatSchema = z.object({
  model: z.string().min(1, "model is required"),
  provider: z.enum(["openai", "qwen", "wan"]).optional(),
  message: z
    .string()
    .trim()
    .max(8000, "message is too long")
    .optional()
    .default(""),
  conversationId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "Invalid conversation id")
    .optional(),
  imageQuality: z.enum(["low", "medium", "high"]).optional().default("medium"),
});

export type ChatInput = z.infer<typeof chatSchema>;

export const editImageSchema = z.object({
  image: z.string().optional(),
  prompt: z.string().trim().min(1, "prompt is required"),
  mask: z.string().optional(),
  model: z.string().optional(),
  provider: z.enum(["openai", "qwen", "wan"]).optional(),
  conversationId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  messageId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
});

export type EditImageInput = z.infer<typeof editImageSchema>;

