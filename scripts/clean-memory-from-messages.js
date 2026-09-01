const { MongoClient } = require("mongodb");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/omniai";

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
        const cleanedContent = doc.content.replace(
            /\n\n\[User Memory Context\][\s\S]*?Use this context to provide personalized and relevant responses naturally\./,
            ""
        ).trim();

        await messages.updateOne(
            { _id: doc._id },
            { $set: { content: cleanedContent } }
        );
        cleanedCount++;
    }

    console.log(`✅ Successfully cleaned ${cleanedCount} messages in database.`);
    await client.close();
}

run().catch((err) => {
    console.error("Script failed:", err);
    process.exit(1);
});
