import dotenv from "dotenv";
import { connectDB, disconnectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";
import { generateEmail } from "./personalizer.js";
import { getOffer } from "./offers.js";

dotenv.config();

const OFFER = getOffer();

/**
 * Un sab leads ka message DOBARA banata hai jo abhi bheje NAHI gaye
 * (status: "new" ya "ready") — taaki purane template wale bodies ki jagah
 * naya "Digital Presence" agency message aa jaye.
 *
 * Already-sent leads (sent/followup/replied/done/bounced/unsubscribed) ko
 * HAATH NAHI lagata — un ko kuch nahi hota, na resend hota hai.
 *
 * Run: node src/ai/repersonalize.js
 */
async function main() {
  console.log(`📣 Offer: ${OFFER.type} — re-personalizing pending leads`);
  await connectDB();

  const leads = await Lead.find({ status: { $in: ["new", "ready"] } });
  console.log(`✍️  ${leads.length} pending leads ka naya message banana hai...\n`);

  let done = 0, failed = 0;
  for (const lead of leads) {
    try {
      const { subject, body, ownerName } = await generateEmail(lead, OFFER);
      lead.subject = subject;
      lead.body = body;
      if (ownerName && !lead.ownerName) lead.ownerName = ownerName;
      lead.status = "ready"; // ab bhejne ke liye taiyar (naye message ke saath)
      await lead.save();
      done++;
      console.log(`   ✅ ${lead.businessName} — "${subject}"`);
    } catch (err) {
      failed++;
      console.log(`   ⚠️  ${lead.businessName} — ${err.message}`);
    }
  }

  console.log(`\n📊 Re-personalize done: ${done} updated${failed ? `, ${failed} failed` : ""}`);
  await disconnectDB();
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
