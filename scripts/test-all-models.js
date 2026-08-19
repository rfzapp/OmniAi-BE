const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
require("dotenv").config();

async function testOpenAI() {
  try {
    const client = new OpenAI.OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await client.chat.completions.create({
      model: "gpt-5.6-luna", messages: [{ role: "user", content: "Say: I am GPT-5.6 Luna" }], max_tokens: 20,
    });
    console.log("✅ GPT-5.6 Luna:", res.choices[0]?.message?.content?.trim());
  } catch (e) { console.error("❌ GPT:", e.message); }
}

async function testClaude() {
  try {
    const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001", max_tokens: 30,
      messages: [{ role: "user", content: "Say: I am Claude Haiku 4.5" }],
    });
    console.log("✅ Claude Haiku 4.5:", res.content[0]?.text?.trim());
  } catch (e) { console.error("❌ Claude:", e.message); }
}

async function testDeepSeek() {
  try {
    const client = new OpenAI.OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: "https://api.deepseek.com/v1" });
    const res = await client.chat.completions.create({
      model: "deepseek-chat", messages: [{ role: "user", content: "Say: I am DeepSeek V3" }], max_tokens: 20,
    });
    console.log("✅ DeepSeek V3:", res.choices[0]?.message?.content?.trim());
  } catch (e) { console.error("❌ DeepSeek:", e.message); }
}

async function testGrok() {
  try {
    const client = new OpenAI.OpenAI({ apiKey: process.env.XAI_API_KEY, baseURL: "https://api.x.ai/v1" });
    const res = await client.chat.completions.create({
      model: "grok-4", messages: [{ role: "user", content: "Say: I am Grok 4" }], max_tokens: 20,
    });
    console.log("✅ Grok 4:", res.choices[0]?.message?.content?.trim());
  } catch (e) { console.error("❌ Grok:", e.message); }
}

async function testQwen() {
  try {
    const client = new OpenAI.OpenAI({ apiKey: process.env.QWEN_API_KEY, baseURL: "https://dashscope-intl.openai.aliyuncs.com/compatible-mode/v1" });
    const res = await client.chat.completions.create({
      model: "qwen-turbo", messages: [{ role: "user", content: "Say: I am Qwen Turbo" }], max_tokens: 20,
    });
    console.log("✅ Qwen Turbo:", res.choices[0]?.message?.content?.trim());
  } catch (e) { console.error("❌ Qwen:", e.message); }
}

async function testMistral() {
  try {
    const client = new OpenAI.OpenAI({ apiKey: process.env.MISTRAL_API_KEY, baseURL: "https://api.mistral.ai/v1" });
    const res = await client.chat.completions.create({
      model: "mistral-small-latest", messages: [{ role: "user", content: "Say: I am Mistral Small" }], max_tokens: 20,
    });
    console.log("✅ Mistral Small:", res.choices[0]?.message?.content?.trim());
  } catch (e) { console.error("❌ Mistral:", e.message); }
}

async function testKimi() {
  try {
    const client = new OpenAI.OpenAI({ apiKey: process.env.KIMI_API_KEY, baseURL: "https://api.moonshot.cn/v1" });
    const res = await client.chat.completions.create({
      model: "moonshot-v1-8k", messages: [{ role: "user", content: "Say: I am Kimi" }], max_tokens: 20,
    });
    console.log("✅ Kimi:", res.choices[0]?.message?.content?.trim());
  } catch (e) { console.error("❌ Kimi:", e.message); }
}

console.log("Testing all providers...\n");
Promise.all([testOpenAI(), testClaude(), testDeepSeek(), testGrok(), testQwen(), testMistral(), testKimi()])
  .then(() => { console.log("\nDone."); process.exit(0); });
