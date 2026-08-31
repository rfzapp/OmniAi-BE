import { z } from "zod";

const notificationsSchema = z
  .object({
    emailUpdates: z.boolean().optional(),
    productAnnouncements: z.boolean().optional(),
    chatMentions: z.boolean().optional(),
  })
  .strict();

const privacySchema = z
  .object({
    improveModel: z.boolean().optional(),
    shareUsageAnalytics: z.boolean().optional(),
  })
  .strict();

export const updateSettingsSchema = z
  .object({
    defaultModel: z.string().min(1).optional(),
    theme: z.enum(["light", "dark"]).optional(),
    connectedModelIds: z.array(z.string().min(1)).min(1, "At least one model must stay connected").optional(),
    notifications: notificationsSchema.optional(),
    privacy: privacySchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
