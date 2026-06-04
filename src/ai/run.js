import dotenv from "dotenv";
import { connectDB, disconnectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";
import { generateEmail } from "./personalizer.js";

dotenv.config();

// Yahan apni service/offer define karo
const OFFER = {
  service:
    "Main businesses ke liye AI-powered cold email system chalata hun jo har month 20-30 qualified meetings book karta hai. Pehle kuch meetings free.",
  senderName: process.env.SENDER_NAME || "Your Name",
  senderTitle: process.env.SENDER_TITLE || "Founder, Your Agency",
};

async function main() {
  await connectDB();

  // sirf wo leads jinki email abhi nahi bani (status: new)
  const leads = await Lead.find({ status: "new" }).limit(50);
  console.log(`✍️  ${leads.length} leads ke liye email banani hai...`);

  for (const lead of leads) {
    try {
      const { subject, body } = await generateEmail(lead, OFFER);
      lead.subject = subject;
      lead.body = body;
      lead.status = "ready";
      await lead.save();
      console.log(`   ✅ ${lead.businessName} — "${subject}"`);
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
