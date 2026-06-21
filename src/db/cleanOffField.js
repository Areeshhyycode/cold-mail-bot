/**
 * One-off: jo JOB leads software/web-development field ke NAHI (AI engineer, data,
 * devops, designer, assistant, manager, etc.) unhe "skipped" mark karta hai taaki
 * sender unpe apply na kare. Speculative software-house leads (koi jobTitle nahi)
 * safe rehte hain.
 *
 *   node src/db/cleanOffField.js
 */
import { connectDB, disconnectDB } from "./connect.js";
import { Lead } from "./Lead.js";
import { isRelevantDevRole } from "../ai/intent.js";

async function main() {
  await connectDB();
  const leads = await Lead.find({
    status: { $in: ["new", "ready"] },
    leadType: "JOB",
    jobTitle: { $exists: true, $nin: [null, ""] },
  });

  let skipped = 0;
  for (const l of leads) {
    if (!isRelevantDevRole(l.jobTitle)) {
      l.status = "skipped";
      await l.save();
      skipped++;
      console.log(`   🚫 off-field: ${(l.jobTitle || "").slice(0, 55)} (${l.company || "—"})`);
    }
  }

  console.log(`\n✅ ${skipped} off-field JOB leads "skipped" (checked: ${leads.length}). Sirf software/web-dev roles bachenge.`);
  await disconnectDB();
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
