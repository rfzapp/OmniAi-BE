import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { env } from "../../config/env";
import { User } from "../user/user.model";
import { signAccessToken, signRefreshToken } from "../../utils/jwt";

export function setupGoogleStrategy() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    console.warn("[auth] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set — Google OAuth disabled.");
    return;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${env.FRONTEND_URL.split(",")[0]!.trim().replace(/:\d+$/, ":5000")}/api/auth/google/callback`,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) return done(new Error("No email returned from Google"), false);

          // Find existing user or create one
          let user = await User.findOne({ email });

          if (!user) {
            user = await User.create({
              fullName: (profile.displayName || email.split("@")[0]) as string,
              email,
              password: `google-oauth-${profile.id}`,
              provider: "google" as const,
              emailVerified: true,
            });
          } else if (user.provider !== "google") {
            // Account exists with email/password — link it
            user.provider = "google";
            await user.save({ validateBeforeSave: false });
          }

          return done(null, user);
        } catch (err) {
          return done(err as Error, false);
        }
      },
    ),
  );
}

export function issueGoogleTokens(user: { id: string; email: string; role: "user" | "admin" }) {
  const payload = { id: user.id, email: user.email, role: user.role };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
  };
}
