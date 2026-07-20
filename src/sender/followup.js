import dotenv from "dotenv";
import { connectDB, disconnectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";
import { sendEmail, randomDelay } from "./mailer.js";
import { getCvAttachment } from "../ai/profile.js";
import { withLock } from "../core/lock.js";
import { log } from "../core/logger.js";

dotenv.config();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 24 * 60 * 60 * 1000;
const SENDER_NAME = process.env.SENDER_NAME || "Areesha Rafiq";

/**
 * FOLLOW-UP BODIES — leadType ke hisaab se ALAG.
 *
 * Pehle sirf SERVICE (agency) wala template tha, aur wahi JOB leads ko bhi chala
 * jata tha — yaani jis company me job apply ki thi, use 3 din baad pooch rahe the
 * "kya aapko aur clients chahiye?" (CV attached ke saath). Ab dono alag hain.
 */

// JOB application ka follow-up — sirf ek polite nudge. Koi agency pitch NAHI.
function jobFollowup(lead) {
  const company = lead.company || lead.businessName || "";
  const greeting = company ? `Hi ${company} team,` : "Hello,";
  const role = lead.jobTitle ? `the ${lead.jobTitle} role` : "a developer role";
  return `${greeting}

I wanted to follow up on my application for ${role}${company ? ` at ${company}` : ""}. I'm still very interested, and I'd be glad to share more about my work if that would help.

I've re-attached my CV for convenience. Thank you for your time.

Best regards,
${SENDER_NAME}`;
}

// SERVICE (agency) ka follow-up — jaisa pehle tha, waisa hi.
function serviceFollowup(lead) {
  return `Hi ${lead.ownerName || "there"},

Just floating this back to the top of your inbox — did you get a chance to see my last email about ${lead.businessName}?

Happy to keep it to a quick 10-min call.

${SENDER_NAME}`;
}

/**
 * Follow-up bhejta hai un leads ko jinhone reply nahi kiya.
 *   sent (step 0)      + 3 din  -> followup_1  (SIRF EK reminder)
 *   followup_1 (step1) + 4 din  -> done        (koi doosra reminder nahi)
 */
async function main() {
  await connectDB();
  const now = Date.now();

  const stage1 = await Lead.find({
    status: "sent",
    lastSentAt: { $lte: new Date(now - 3 * DAY) },
  }).limit(30);

  // followup_1 ho chuke + 4 din -> bas "done" mark karo
  const stage3 = await Lead.find({
    status: "followup_1",
    lastSentAt: { $lte: new Date(now - 4 * DAY) },
  }).limit(50);

  log.info("followup.plan", { reminders: stage1.length, closing: stage3.length });

  await sendBatch(stage1);

  for (const lead of stage3) {
    lead.status = "done";
    await lead.save();
  }

  log.info("followup.done", { closed: stage3.length });
  await disconnectDB();
}

async function sendBatch(leads) {
  if (!leads.length) return;

  // CV ek hi baar resolve karo — JOB follow-ups ke saath jati hai
  const cv = getCvAttachment();

  let sent = 0;
  for (const lead of leads) {
    try {
      const isJob = lead.leadType === "JOB";
      const body = isJob ? jobFollowup(lead) : serviceFollowup(lead);

      await sendEmail({
        to: lead.email,
        subject: `Re: ${lead.subject}`,
        text: body,
        leadId: lead._id.toString(),
        // leadType pass karna ZAROORI hai — warna mailer JOB application pe bhi
        // unsubscribe footer + tracking pixel laga deta hai (unprofessional).
        leadType: lead.leadType,
        attachments: isJob ? cv : [],
      });

      lead.status = "followup_1";
      lead.currentStep = 1;
      lead.lastSentAt = new Date();
      lead.sentCount += 1;
      await lead.save();

      sent++;
      log.info("followup.sent", { to: lead.email, leadType: lead.leadType || "SERVICE" });

      await sleep(randomDelay());
    } catch (err) {
      log.warn("followup.fail", { to: lead.email, error: err.message });
    }
  }
  log.info("followup.batch", { sent, total: leads.length });
}

// LOCK: 5 scheduled runs overlap kar sakte the -> ek hi lead ko do baar follow-up
// ja sakta tha. Ab ek waqt me sirf ek follow-up run chalega.
withLock("sender", main)
  .catch((err) => {
    log.error("followup.error", { error: err.message });
    process.exit(1);
  });
