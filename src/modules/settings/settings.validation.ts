import { z } from "zod";

export const updateSettingsSchema = z
  .object({
    defaultModel: z.string().min(1).optional(),
    theme: z.enum(["light", "dark"]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
