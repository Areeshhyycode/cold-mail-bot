import dotenv from "dotenv";
import { connectDB, disconnectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";
import { sendEmail, randomDelay } from "./mailer.js";

dotenv.config();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 24 * 60 * 60 * 1000;

// follow-up messages (plain, short)
const FOLLOWUPS = {
  1: (lead) =>
    `Hi ${lead.ownerName || "there"},\n\nJust floating this back to the top of your inbox — did you get a chance to see my last email about ${lead.businessName}?\n\nHappy to keep it to a quick 10-min call.\n\n${process.env.SENDER_NAME || ""}`,
  2: (lead) =>
    `Hi ${lead.ownerName || "there"},\n\nLast one from me — if getting more clients for ${lead.businessName} isn't a priority right now, no worries at all.\n\nIf it is, just reply "yes" and I'll send a couple of times that work.\n\n${process.env.SENDER_NAME || ""}`,
};

/**
 * Follow-up bhejta hai un leads ko jinhone reply nahi kiya.
 *   sent (step 0)      + 3 din  -> followup_1
 *   followup_1 (step1) + 3 din  -> followup_2
 *   followup_2 (step2) + 4 din  -> done
 */
async function main() {
  await connectDB();
  const now = Date.now();

  // step 0 -> followup 1 (3 din baad)
  const stage1 = await Lead.find({
    status: "sent",
    lastSentAt: { $lte: new Date(now - 3 * DAY) },
  }).limit(30);

  // step 1 -> followup 2 (3 din baad)
  const stage2 = await Lead.find({
    status: "followup_1",
    lastSentAt: { $lte: new Date(now - 3 * DAY) },
  }).limit(30);

  // step 2 -> done (4 din baad, koi reply nahi)
  const stage3 = await Lead.find({
    status: "followup_2",
    lastSentAt: { $lte: new Date(now - 4 * DAY) },
  }).limit(50);

  console.log(`📨 followup_1: ${stage1.length}, followup_2: ${stage2.length}, close: ${stage3.length}`);

  await sendBatch(stage1, 1, "followup_1");
  await sendBatch(stage2, 2, "followup_2");

  // stage3 ko bas done mark karo
  for (const lead of stage3) {
    lead.status = "done";
    await lead.save();
  }

  console.log("\n📊 Follow-up cycle done");
  await disconnectDB();
}

async function sendBatch(leads, step, newStatus) {
  for (const lead of leads) {
    try {
      const body = FOLLOWUPS[step](lead);
      const subject = `Re: ${lead.subject}`;
      await sendEmail({ to: lead.email, subject, text: body, leadId: lead._id.toString() });

      lead.status = newStatus;
      lead.currentStep = step;
      lead.lastSentAt = new Date();
      lead.sentCount += 1;
      await lead.save();

      console.log(`   ✅ FU${step} -> ${lead.email}`);
      await sleep(randomDelay());
    } catch (err) {
      console.log(`   ❌ ${lead.email} — ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
