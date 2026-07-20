/**
 * BATCH SENDER — ek campaign ke "ready" leads ko BATCHES me bhejta hai:
 *   BATCH_SIZE emails -> BATCH_GAP_MIN minute wait -> agla batch -> ...
 *
 *   node src/sender/batchSend.js <campaign> [batchSize] [gapMinutes]
 *   node src/sender/batchSend.js ksa-recruiters 10 20     (default: 10 / 20min)
 *
 * run.js (rozana cron sender) ki saari safety yahan bhi hai:
 *   - SMTP preflight, MX/syntax verify, invalid skip
 *   - bounced-domain suppression
 *   - same-company double-mail se bachao
 *   - JOB leads pe CV attach + jobLeadSendable quality gate
 * Farq sirf itna: DAILY_SEND_LIMIT ke bajaye batch-size + inter-batch gap, aur
 * campaign-scoped (poore DB ke ready leads nahi).
 */
import dotenv from "dotenv";
import { connectDB, disconnectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";
import { sendEmail, randomDelay, verifyConnection } from "./mailer.js";
import { getCvAttachment } from "../ai/profile.js";
import { jobLeadSendable } from "../scraper/targetFilter.js";
import { verifyEmail } from "../scraper/verifyEmail.js";
import { log } from "../core/logger.js";

dotenv.config();

const domainOf = (email = "") => (email.split("@")[1] || "").toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s = "") =>
  s.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").trim();
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const CONTACTED = ["sent", "followup_1", "followup_2", "replied", "unsubscribed", "done", "bounced"];

async function alreadyContactedCompany(lead) {
  const site = norm(lead.website);
  const ors = [];
  if (lead.businessName) ors.push({ businessName: lead.businessName });
  if (lead.company) ors.push({ company: lead.company });
  if (site) ors.push({ website: new RegExp(`^https?://(www\\.)?${escapeRegex(site)}/?$`, "i") });
  if (!ors.length) return null;
  return Lead.findOne({
    _id: { $ne: lead._id },
    email: { $ne: lead.email },
    status: { $in: CONTACTED },
    $or: ors,
  });
}

/** Ek lead bhejo — run.js jaisi hi checks. return: "sent"|"bounced"|"skipped" */
async function sendOne(lead, cv, bouncedDomains) {
  // MX/syntax verify
  if (!lead.emailStatus || lead.emailStatus === "unknown") {
    lead.emailStatus = await verifyEmail(lead.email);
  }
  if (lead.emailStatus === "invalid") {
    lead.status = "skipped";
    await lead.save();
    console.log(`   ⏭️  ${lead.email} — invalid (MX/syntax), skip`);
    return "skipped";
  }
  if (bouncedDomains.has(domainOf(lead.email))) {
    lead.status = "skipped";
    await lead.save();
    console.log(`   ⏭️  ${lead.email} — domain previously bounced, skip`);
    return "skipped";
  }
  if (lead.leadType === "JOB") {
    const q = jobLeadSendable(lead);
    if (!q.ok) {
      lead.status = "skipped";
      await lead.save();
      console.log(`   ⏭️  ${lead.email} — ${q.reason}, skip`);
      return "skipped";
    }
  }
  const twin = await alreadyContactedCompany(lead);
  if (twin) {
    lead.status = "done";
    await lead.save();
    console.log(`   ⏭️  ${lead.email} — same company already contacted on ${twin.email}, skip`);
    return "skipped";
  }

  const attachments = lead.leadType === "JOB" ? cv : [];
  const result = await sendEmail({
    to: lead.email,
    subject: lead.subject,
    text: lead.body,
    leadId: lead._id.toString(),
    attachments,
    leadType: lead.leadType,
  });

  const delivered = result?.delivered !== false;
  lead.status = delivered ? "sent" : "bounced";
  lead.currentStep = 0;
  lead.lastSentAt = new Date();
  lead.sentCount += 1;
  await lead.save();
  console.log(`   ${delivered ? "✅" : "⚠️ "} ${lead.email}`);
  return delivered ? "sent" : "bounced";
}

async function main() {
  const campaign = process.argv[2] || "ksa-recruiters";
  const batchSize = parseInt(process.argv[3] || "10", 10);
  const gapMin = parseInt(process.argv[4] || "20", 10);

  await connectDB();

  if (!(await verifyConnection())) {
    log.error("batchSend.smtp_down", { note: "Gmail App Password (.env SMTP_PASS) check karo" });
    await disconnectDB();
    process.exit(1);
  }

  const total = await Lead.countDocuments({ campaign, status: "ready", email: { $nin: [null, ""] } });
  if (total === 0) {
    console.log(`✅ Campaign "${campaign}" me koi 'ready' lead nahi. Kuch nahi bhejna.`);
    await disconnectDB();
    return;
  }

  const cv = getCvAttachment();
  if (!cv.length) console.log("⚠️  CV file nahi mili — job emails bina attachment jayengi.");

  console.log(
    `📮 Campaign "${campaign}" — ${total} ready. Batch ${batchSize} / gap ${gapMin}min.\n`
  );

  let sent = 0, bounced = 0, skipped = 0, batchNo = 0;

  while (true) {
    // har batch fresh query kare (taaki dubara skip/sent hue leads dobara na aayen)
    const bouncedDomains = new Set(
      (await Lead.distinct("email", { status: "bounced" })).map(domainOf).filter(Boolean)
    );
    const batch = await Lead.find({
      campaign,
      status: "ready",
      email: { $nin: [null, ""] },
    })
      .sort({ score: -1 })
      .limit(batchSize);

    if (batch.length === 0) break;
    batchNo++;
    console.log(`\n── Batch ${batchNo} (${batch.length}) ──────────────────────────`);

    for (let i = 0; i < batch.length; i++) {
      const lead = batch[i];
      try {
        const r = await sendOne(lead, cv, bouncedDomains);
        if (r === "sent") sent++;
        else if (r === "bounced") bounced++;
        else skipped++;
      } catch (err) {
        console.log(`   ❌ ${lead.email} — ${err.message}`);
        if (err.message.includes("Invalid login") || err.message.includes("auth")) {
          console.log("   🛑 SMTP auth problem — ruk raha hun. App Password check karo.");
          await disconnectDB();
          process.exit(1);
        }
      }
      // batch ke andar human-like chhota delay (aakhri ke baad nahi)
      if (i < batch.length - 1) {
        const d = randomDelay();
        console.log(`   ⏳ ${Math.round(d / 1000)}s...`);
        await sleep(d);
      }
    }

    const left = await Lead.countDocuments({ campaign, status: "ready", email: { $nin: [null, ""] } });
    console.log(
      `   Batch ${batchNo} done | sent:${sent} bounced:${bounced} skipped:${skipped} | ${left} ready left`
    );
    if (left === 0) break;

    console.log(`   🕒 ${gapMin} min gap before next batch...`);
    await sleep(gapMin * 60 * 1000);
  }

  console.log(`\n📊 All done | sent:${sent} bounced:${bounced} skipped:${skipped}`);
  log.info("batchSend.done", { campaign, sent, bounced, skipped });
  await disconnectDB();
}

main().catch((err) => {
  log.error("batchSend.error", { error: err.message });
  console.error("❌ Error:", err.message);
  process.exit(1);
});
