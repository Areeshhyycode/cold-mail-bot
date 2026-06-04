import { connectDB, disconnectDB } from "./connect.js";
import { Lead } from "./Lead.js";

// Quick test: DB connect + ek dummy lead insert + count + delete
async function main() {
  await connectDB();

  const count = await Lead.countDocuments();
  console.log(`📊 Abhi DB me ${count} leads hain`);

  await disconnectDB();
  console.log("👋 Done");
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
