const { MongoClient } = require("mongodb");

// Backend uses MONGO_URI, but support MONGODB_URI as fallback
const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/omniai";

async function run() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db();
    const messages = db.collection("messages");

    const cursor = messages.find({ content: { $regex: "\\[User Memory Context\\]" } });
    const docs = await cursor.toArray();

    console.log(`Found ${docs.length} messages containing [User Memory Context].`);

    let cleanedCount = 0;
    for (const doc of docs) {
        // Strip the entire memory block wherever it appears (beginning, middle, or end)
        let cleaned = doc.content
            // Case: memory at the start or in the middle (preceded by \n\n)
            .replace(/\n\n\[User Memory Context\][\s\S]*?Use this context to provide personalized and relevant responses naturally\./g, "")
            // Case: memory at the very start of the string
            .replace(/^\[User Memory Context\][\s\S]*?Use this context to provide personalized and relevant responses naturally\.\n*/g, "")
            .trim();

        if (cleaned === doc.content.trim()) {
            console.log(`  Skipping message ${doc._id} — no change after cleaning`);
            continue;
        }

        await messages.updateOne(
            { _id: doc._id },
            { $set: { content: cleaned } }
        );
        cleanedCount++;
        console.log(`  Cleaned message ${doc._id}`);
    }

    console.log(`\n✅ Done. Cleaned ${cleanedCount} / ${docs.length} messages.`);
    await client.close();
}

run().catch((err) => {
    console.error("Script failed:", err);
    process.exit(1);
});
