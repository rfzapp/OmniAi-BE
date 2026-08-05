import { ApiError } from "../../utils/ApiError";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../utils/jwt";
import { User } from "../user/user.model";
import type { LoginInput, RegisterInput } from "./auth.validation";

function issueTokens(user: { id: string; email: string; role: "user" | "admin" }) {
  const payload = { id: user.id, email: user.email, role: user.role };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
  };
}

export async function register(input: RegisterInput) {
  const existing = await User.findOne({ email: input.email });
  if (existing) throw ApiError.conflict("Email is already registered");

  const user = await User.create({
    fullName: input.fullName,
    email: input.email,
    password: input.password,
  });

  const tokens = issueTokens({ id: user.id, email: user.email, role: user.role });
  return { user, ...tokens };
}

export async function login(input: LoginInput) {
  const user = await User.findOne({ email: input.email }).select("+password");
  if (!user) throw ApiError.unauthorized("Invalid email or password");

  const isMatch = await user.comparePassword(input.password);
  if (!isMatch) throw ApiError.unauthorized("Invalid email or password");

  const tokens = issueTokens({ id: user.id, email: user.email, role: user.role });
  return { user, ...tokens };
}

export async function refresh(refreshToken: string) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized("Invalid or expired refresh token");
  }

  const user = await User.findById(payload.id);
  if (!user) throw ApiError.unauthorized("User no longer exists");

  return issueTokens({ id: user.id, email: user.email, role: user.role });
}
