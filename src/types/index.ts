export type UserRole = "user" | "admin";
export type AuthProvider = "local" | "google" | "github";
export type SubscriptionPlan = "free" | "standard" | "pro" | "ultra_pro";
export type ImagePlan = "none" | "basic" | "pro" | "ultra_pro";
export type MessageRole = "user" | "assistant" | "system";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface JwtPayload {
  id: string;
  email: string;
  role: UserRole;
}
