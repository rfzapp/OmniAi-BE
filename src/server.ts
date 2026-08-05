import app from "./app";
import { env } from "./config/env";
import { connectDB } from "./database/connect";

async function bootstrap() {
  await connectDB();

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

bootstrap().catch((err: unknown) => {
  console.error("[server] Failed to start:", err);
  process.exit(1);
});
