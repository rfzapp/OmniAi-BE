import { z } from "zod";

export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(2, "Full name must be at least 2 characters").optional(),
    // Accept both https URLs and base64 data URLs (for file uploads)
    avatar: z.string().optional().refine(
      (v) => !v || v.startsWith("data:image/") || /^https?:\/\/.+/.test(v),
      { message: "Avatar must be a valid URL or image" }
    ),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "New password must be at least 8 characters"),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from current password",
    path: ["newPassword"],
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
