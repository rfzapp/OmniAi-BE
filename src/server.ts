import app from "./app";
import { env } from "./config/env";
import { connectDB } from "./database/connect";

// Connect to DB once (cached across serverless invocations)
connectDB().catch((err: unknown) => {
  console.error("[server] Failed to connect to DB:", err);
});

// For Vercel serverless — export the app directly
export default app;

// For local development — only call listen when run directly
if (process.env.VERCEL !== "1") {
  const server = app.listen(env.PORT, () => {
    console.log(`[server] OmniAI backend listening on port ${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = (signal: string) => {
    console.log(`[server] Received ${signal}, shutting down gracefully`);
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
