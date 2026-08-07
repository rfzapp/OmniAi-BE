export type UserRole = "user" | "admin";
export type AuthProvider = "local" | "google" | "github";
export type SubscriptionPlan = "free" | "pro" | "enterprise";
export type ImagePlan = "none" | "basic" | "pro";
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
