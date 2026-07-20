/**
 * DISTRIBUTED LOCK (MongoDB) — race condition ka ilaaj.
 *
 * MASLA: "Daily Cold Mails" workflow din me 5 baar chalta hai (4,5,6,7,9 UTC —
 * ek ghanta faasla). Lekin ek run 40 emails × 45-120s delay = 80 MINUTE tak le
 * sakta hai. Yaani 9:00 wala run abhi chal raha hota hai jab 10:00 wala shuru ho
 * jata hai -> DO sender ek saath wahi "ready" leads uthate hain -> ek hi lead ko
 * do baar email ja sakti hai aur daily limit toot sakti hai.
 *
 * HAL: ek Mongo-backed lock. Ek waqt me sirf ek sender chalega. Doosra run
 * chup-chaap (exit 0) skip kar dega — workflow "fail" nahi hoga, kyunki ye koi
 * error nahi, bas "abhi zaroorat nahi".
 *
 * Lock me expiry (TTL) hai — agar koi run crash ho jaye to lock hamesha ke liye
 * atka na rahe.
 */
import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../db/connect.js";
import { log } from "./logger.js";

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 min — sabse lamba run bhi itne me khatam

const locks = () => mongoose.connection.collection("locks");

/**
 * Lock lene ki koshish. true = mil gaya, false = koi aur chala raha hai.
 */
export async function acquireLock(name, ttlMs = DEFAULT_TTL_MS) {
  const now = new Date();
  const c = locks();

  // expire ho chuka lock (crashed run ka) hata do
  await c.deleteOne({ _id: name, expiresAt: { $lte: now } });

  try {
    await c.insertOne({
      _id: name,
      acquiredAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
      pid: process.pid,
    });
    return true;
  } catch (err) {
    if (err && err.code === 11000) return false; // _id unique -> koi aur hold kar raha hai
    throw err;
  }
}

export async function releaseLock(name) {
  try {
    await locks().deleteOne({ _id: name });
  } catch {
    /* release fail ho to TTL khud saaf kar dega */
  }
}

/**
 * fn ko lock ke andar chalao. Lock na mile to gracefully exit(0).
 *
 * NOTE: fn (main) khud connectDB/disconnectDB karta hai, isliye release se pehle
 * dobara connect karte hain — connectDB idempotent hai.
 */
export async function withLock(name, fn, ttlMs = DEFAULT_TTL_MS) {
  await connectDB();

  const got = await acquireLock(name, ttlMs);
  if (!got) {
    log.warn("lock.busy", { name, note: "another run is active — skipping (not an error)" });
    await disconnectDB();
    process.exit(0); // graceful skip -> workflow success rahega
  }

  log.debug("lock.acquired", { name });
  try {
    await fn();
  } finally {
    await connectDB(); // fn ne disconnect kiya ho to wapas connect
    await releaseLock(name);
    log.debug("lock.released", { name });
    await disconnectDB();
  }
}
