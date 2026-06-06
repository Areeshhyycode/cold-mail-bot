import dotenv from "dotenv";
import { connectDB, disconnectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";
import { generateEmail } from "./personalizer.js";
import { getOffer } from "./offers.js";

dotenv.config();

// CAMPAIGN env se offer choose hota hai: "dev" (default) ya "website"
const OFFER = getOffer();

async function main() {
  console.log(`📣 Campaign: ${OFFER.type}`);
  await connectDB();

  // sirf wo leads jinki email abhi nahi bani (status: new)
  const leads = await Lead.find({ status: "new" }).limit(50);
  console.log(`✍️  ${leads.length} leads ke liye email banani hai...`);

  for (const lead of leads) {
    try {
      const { subject, body, ownerName } = await generateEmail(lead, OFFER);
      lead.subject = subject;
      lead.body = body;
      if (ownerName && !lead.ownerName) lead.ownerName = ownerName;
      lead.status = "ready";
      await lead.save();
      const who = lead.ownerName ? ` (👤 ${lead.ownerName})` : "";
      console.log(`   ✅ ${lead.businessName}${who} — "${subject}"`);
    } catch (err) {
      console.log(`   ⚠️  ${lead.businessName} — ${err.message}`);
    }
  }

  console.log("\n📊 Personalization done");
  await disconnectDB();
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
