/**
 * CV/format verify karne ke liye: top ready JOB lead ki email APNE inbox me bhejta
 * hai (asli company ko NAHI), CV attach karke. Lead ka status change NAHI hota.
 *
 *   node src/sender/testSend.js
 * (apne aap ko bhejta hai: TEST_EMAIL ya SMTP_USER pe)
 */
import dotenv from "dotenv";
import { connectDB, disconnectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";
import { sendEmail } from "./mailer.js";
import { getCvAttachment } from "../ai/profile.js";

dotenv.config();

async function main() {
  await connectDB();
  const to = process.env.TEST_EMAIL || process.env.SMTP_USER;
  const lead = await Lead.findOne({
    status: "ready",
    leadType: "JOB",
    email: { $exists: true, $nin: [null, ""] },
  }).sort({ score: -1 });

  if (!lead) {
    console.log("Koi ready JOB lead nahi mila.");
    await disconnectDB();
    return;
  }

  const cv = getCvAttachment();
  console.log(`📧 Test bhej rahe hain APNE inbox (${to}) me — asli recipient (${lead.email}) ko NAHI`);
  console.log(`   subject: ${lead.subject}`);
  console.log(`   CV: ${cv.length ? cv[0].filename : "(file nahi mili!)"}`);

  await sendEmail({
    to,
    subject: `[TEST] ${lead.subject}`,
    text: lead.body,
    attachments: cv,
    leadType: "JOB",
  });

  console.log("✅ Test email bhej di — apna inbox check karo (CV attach honi chahiye).");
  await disconnectDB();
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
