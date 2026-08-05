import mongoose from "mongoose";
import { env } from "../config/env";

mongoose.set("strictQuery", true);

export async function connectDB(): Promise<void> {
  mongoose.connection.on("connected", () => {
    console.log("[database] MongoDB connected");
  });

  mongoose.connection.on("error", (err) => {
    console.error("[database] MongoDB connection error:", err);
  });

  mongoose.connection.on("disconnected", () => {
    console.warn("[database] MongoDB disconnected");
  });

  await mongoose.connect(env.MONGO_URI);
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
}
