/**
 * One-time fix script: reset promptCount24h for all users whose 30-day window
 * has already expired but whose counts were never cleared due to the old bug.
 *
 * Run once with: node scripts/fix-prompt-resets.js
 *
 * Requires MONGODB_URI in environment (or set it inline below).
 */

const { MongoClient } = require("mongodb");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/omniai";
const RESET_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

async function run() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();
    const users = db.collection("users");

    const now = new Date();
    const cutoff = new Date(now.getTime() - RESET_INTERVAL_MS);

    // Find paid users whose lastPromptResetAt is older than 30 days (window has expired)
    const staleFilter = {
        subscription: { $ne: "free" },
        $or: [
            { lastPromptResetAt: { $exists: false } },
            { lastPromptResetAt: null },
            { lastPromptResetAt: { $lt: cutoff } },
        ],
    };

    const staleUsers = await users.find(staleFilter, {
        projection: { email: 1, subscription: 1, promptCount24h: 1, lastPromptResetAt: 1 },
    }).toArray();

    console.log(`Found ${staleUsers.length} users with expired prompt windows:`);
    staleUsers.forEach((u) => {
        console.log(
            `  ${u.email} | plan=${u.subscription} | promptCount24h=${u.promptCount24h} | lastReset=${u.lastPromptResetAt ?? "never"}`
        );
    });

    if (staleUsers.length === 0) {
        console.log("Nothing to fix.");
        await client.close();
        return;
    }

    // Reset their 24h counters — note: we do NOT reset lastPromptResetAt here
    // because the code will set it to `now` on their next prompt naturally.
    const result = await users.updateMany(staleFilter, {
        $set: {
            promptCount24h: 0,
            attachmentCount24h: 0,
        },
    });

    console.log(`\n✅ Reset promptCount24h=0 for ${result.modifiedCount} users.`);
    console.log("Their window will officially restart on their next prompt send.");

    await client.close();
}

run().catch((err) => {
    console.error("Script failed:", err);
    process.exit(1);
});
