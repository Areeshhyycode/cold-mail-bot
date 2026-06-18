import dotenv from "dotenv";
import { connectDB, disconnectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";
import { buildEmailForLead } from "./router.js";

dotenv.config();

/**
 * Personalization step (HYBRID).
 * status:"new" wale leads uthata hai, router se decide karta hai JOB ya SERVICE,
 * sahi generator se email banata hai, aur leadType save karke status "ready" karta hai.
 */
async function main() {
  await connectDB();

  const leads = await Lead.find({ status: "new" }).sort({ score: -1 }).limit(50);
  console.log(`✍️  ${leads.length} leads ke liye email banani hai...`);

  let job = 0;
  let service = 0;

  for (const lead of leads) {
    try {
      const { subject, body, leadType, ownerName } = await buildEmailForLead(lead);

      lead.subject = subject;
      lead.body = body;
      lead.leadType = leadType;
      if (ownerName && !lead.ownerName) lead.ownerName = ownerName;
      lead.status = "ready";
      await lead.save();

      if (leadType === "JOB") job++;
      else service++;

      const who = lead.company || lead.businessName || lead.email;
      console.log(`   ✅ [${leadType}] ${who} — "${subject}"`);
    } catch (err) {
      console.log(`   ⚠️  ${lead.company || lead.businessName || lead.email} — ${err.message}`);
    }
  }

  console.log(`\n📊 Personalization done | JOB: ${job}, SERVICE: ${service}`);
  await disconnectDB();
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
