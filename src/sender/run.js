import dotenv from "dotenv";
import { connectDB, disconnectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";
import { sendEmail, randomDelay } from "./mailer.js";

dotenv.config();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// company/website ko normalize karke compare karte hain (www, https, trailing slash hata ke)
const norm = (s = "") =>
  s.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").trim();

// already-contacted statuses — agar isi company ko in me se kisi address pe bhej chuke hain to dobara mat bhejo
const CONTACTED = ["sent", "followup_1", "followup_2", "replied", "unsubscribed", "done", "bounced"];

/**
 * true agar is lead ki company (same naam ya same website) ko pehle se
 * kisi DOOSRE address pe contact kar chuke hain. Taaki ek company ko
 * uske multiple emails (info@, hr@...) pe alag-alag mail na jaye.
 */
async function alreadyContactedCompany(lead) {
  const site = norm(lead.website);
  const ors = [];
  if (lead.businessName) ors.push({ businessName: lead.businessName });
  if (site) ors.push({ website: new RegExp(`^https?://(www\\.)?${escapeRegex(site)}/?$`, "i") });
  if (!ors.length) return null;
  return Lead.findOne({
    _id: { $ne: lead._id },
    email: { $ne: lead.email },
    status: { $in: CONTACTED },
    $or: ors,
  });
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Aaj ke batch ka pehla email bhejta hai (status: ready -> sent).
 * Daily limit respect karta hai.
 */
async function main() {
  await connectDB();

  const dailyLimit = parseInt(process.env.DAILY_SEND_LIMIT || "40", 10);

  // aaj ab tak kitne first-emails bheje? (taaki workflow din me kai baar chale
  // tab bhi total daily limit se zyada na jaye — bas fail hone par retry ho)
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const sentToday = await Lead.countDocuments({
    currentStep: 0,
    lastSentAt: { $gte: startOfDay },
    status: { $in: ["sent", "followup_1", "followup_2", "replied", "unsubscribed", "done"] },
  });

  const remaining = Math.max(0, dailyLimit - sentToday);
  if (remaining === 0) {
    console.log(`✅ Aaj ka quota pura (${sentToday}/${dailyLimit}). Kuch nahi bhejna.`);
    await disconnectDB();
    return;
  }

  const leads = await Lead.find({ status: "ready" }).limit(remaining);
  console.log(`📤 ${leads.length} emails bhejne hain (aaj ${sentToday}/${dailyLimit} ho chuke, ${remaining} bacha)...`);

  let sent = 0;
  let dupSkipped = 0;
  for (const lead of leads) {
    try {
      // same company doosre address pe already contact ho chuki? to skip (no double-mailing)
      const twin = await alreadyContactedCompany(lead);
      if (twin) {
        lead.status = "done";
        await lead.save();
        dupSkipped++;
        console.log(`   ⏭️  ${lead.email} — same company (${lead.businessName}) already contacted on ${twin.email}, skip`);
        continue;
      }

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

  console.log(`\n📊 ${sent} emails bheje gaye${dupSkipped ? `, ${dupSkipped} duplicate company skip` : ""}`);
  await disconnectDB();
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
