// Run with: npx tsx scripts/clean-memory-from-messages.ts
import dotenv from "dotenv";
import path from "path";

// Load .env from backend root — must happen before any other imports
dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

import mongoose from "mongoose";
import { env } from "../src/config/env";

const MEMORY_REGEX = /(\n\n)?\[User Memory Context\][\s\S]*?Use this context to provide personalized and relevant responses naturally\./g;

async function run() {
    console.log("Connecting to MongoDB at:", env.MONGO_URI.replace(/:\/\/[^@]+@/, "://***@")); // mask password
    await mongoose.connect(env.MONGO_URI);
    console.log("Connected.\n");

    const collection = mongoose.connection.collection("messages");

    const dirty = await collection.find({ content: { $regex: "\\[User Memory Context\\]" } }).toArray();
    console.log(`Found ${dirty.length} dirty message(s).\n`);

    let cleaned = 0;
    for (const doc of dirty) {
        const original = doc.content as string;
        const fixed = original.replace(MEMORY_REGEX, "").trim();

        if (fixed === original.trim()) {
            console.log(`  SKIP ${doc._id} — regex did not match`);
            console.log(`  Content preview: ${original.slice(0, 120)}\n`);
            continue;
        }

        await collection.updateOne({ _id: doc._id }, { $set: { content: fixed } });
        console.log(`  ✅ Cleaned ${doc._id}`);
        console.log(`  Before: ${original.slice(0, 80).replace(/\n/g, "\\n")}...`);
        console.log(`  After:  ${fixed.slice(0, 80).replace(/\n/g, "\\n")}...\n`);
        cleaned++;
    }

    console.log(`\nDone. ${cleaned} / ${dirty.length} messages cleaned.`);
    await mongoose.disconnect();
}

run().catch((err) => {
    console.error("Script failed:", err);
    process.exit(1);
});
