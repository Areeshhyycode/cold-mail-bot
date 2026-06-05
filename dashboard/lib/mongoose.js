import mongoose from "mongoose";

// Next.js me connection cache karo (hot reload pe baar baar connect na ho)
let cached = global._mongoose;
if (!cached) cached = global._mongoose = { conn: null, promise: null };

export async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI missing");
  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
    });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}
