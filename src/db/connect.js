import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

let connected = false;

export async function connectDB() {
  if (connected) return mongoose.connection;
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI .env me missing hai");
  }
  await mongoose.connect(process.env.MONGODB_URI);
  connected = true;
  console.log("✅ MongoDB connected");
  return mongoose.connection;
}

export async function disconnectDB() {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}
