import dotenv from "dotenv";
import { connectDB, disconnectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";
import { sendEmail, randomDelay } from "./mailer.js";

dotenv.config();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Aaj ke batch ka pehla email bhejta hai (status: ready -> sent).
 * Daily limit respect karta hai.
 */
async function main() {
  await connectDB();

  const dailyLimit = parseInt(process.env.DAILY_SEND_LIMIT || "40", 10);

  const leads = await Lead.find({ status: "ready" }).limit(dailyLimit);
  console.log(`📤 ${leads.length} pehle emails bhejne hain (limit ${dailyLimit})...`);

  let sent = 0;
  for (const lead of leads) {
    try {
      await sendEmail({ to: lead.email, subject: lead.subject, text: lead.body, leadId: lead._id.toString() });

      lead.status = "sent";
      lead.currentStep = 0;
      lead.lastSentAt = new Date();
      lead.sentCount += 1;
      await lead.save();

      sent++;
      console.log(`   ✅ ${lead.email} (${sent}/${leads.length})`);

      // human-like random delay (aakhri ke baad nahi)
      if (sent < leads.length) {
        const d = randomDelay();
        console.log(`   ⏳ ${Math.round(d / 1000)}s wait...`);
        await sleep(d);
      }
    } catch (err) {
      console.log(`   ❌ ${lead.email} — ${err.message}`);
      // agar bounce/auth error baar baar aaye to ruk jao
      if (err.message.includes("Invalid login") || err.message.includes("auth")) {
        console.log("   🛑 SMTP auth problem — ruk raha hun. App Password check karo.");
        break;
      }
    }
  }

  console.log(`\n📊 ${sent} emails bheje gaye`);
  await disconnectDB();
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
