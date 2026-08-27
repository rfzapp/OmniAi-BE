import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import cookieParser from "cookie-parser";
import passport from "passport";
import { env, isProduction } from "./config/env";
import { setupGoogleStrategy } from "./modules/auth/google.strategy";
import { notFoundMiddleware } from "./middlewares/notFound.middleware";
import { errorMiddleware } from "./middlewares/error.middleware";
import authRoutes from "./modules/auth/auth.routes";
import userRoutes from "./modules/user/user.routes";
import aiRoutes from "./modules/ai/ai.routes";
import conversationRoutes from "./modules/conversation/conversation.routes";
import settingsRoutes from "./modules/settings/settings.routes";

const app = express();

app.use(helmet());
const allowedOrigins = env.FRONTEND_URL.split(",").map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());
// Initialize passport and Google OAuth strategy
setupGoogleStrategy();
app.use(passport.initialize());
app.use(compression({
  // Skip compression for SSE streaming routes — compression buffers the
  // entire response before sending, which kills token-by-token delivery.
  filter: (req, res) => {
    if (req.path.includes("/chat/stream")) return false;
    return compression.filter(req, res);
  },
}));
app.use(morgan(isProduction ? "combined" : "dev"));

app.get("/api/health", (_req, res) => {
  res.status(200).json({ success: true, message: "OmniAI backend is running", data: null });
});

app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/settings", settingsRoutes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
