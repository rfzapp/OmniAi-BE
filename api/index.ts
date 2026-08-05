import app from "../src/app";
import { connectDB } from "../src/database/connect";

// Cache DB connection across serverless invocations
let isConnected = false;

const handler = async (req: any, res: any) => {
  if (!isConnected) {
    await connectDB();
    isConnected = true;
  }
  app(req, res);
};

export default handler;
