import { ImapFlow } from "imapflow";
import dotenv from "dotenv";
import { connectDB, disconnectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";
import { notifyWhatsApp } from "../utils/notify.js";

dotenv.config();

const UNSUB_WORDS = ["unsubscribe", "stop", "remove me", "opt out", "opt-out", "take me off"];

// "Name <email@x.com>" se sirf email nikalo
function parseEmail(fromStr = "") {
  const m = fromStr.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m ? m[0].toLowerCase() : "";
}

/**
 * Gmail inbox check karta hai. Jis lead ka reply aaya:
 *   - agar unsubscribe word ho -> status "unsubscribed"
 *   - warna -> status "replied"  (dono case me follow-up ruk jata hai)
 *
 * Gmail me IMAP enable hona chahiye:
 *   Settings -> Forwarding and POP/IMAP -> Enable IMAP
 */
async function main() {
  await connectDB();

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    logger: false,
  });

  await client.connect();
  console.log("✅ Gmail IMAP connected");

  const lock = await client.getMailboxLock("INBOX");
  let replied = 0;
  let unsubscribed = 0;
  let bounced = 0;

  try {
    // last 7 din ke messages
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    for await (const msg of client.fetch(
      { since },
      { envelope: true, source: true }
    )) {
      const fromRaw = (msg.envelope?.from?.[0]?.address || "").toLowerCase();
      const subject = (msg.envelope?.subject || "").toLowerCase();
      const rawBody = msg.source ? msg.source.toString("utf-8") : "";
      const body = rawBody.toLowerCase();

      // ---- BOUNCE detection (address not found / delivery failed) ----
      const isBounce =
        fromRaw.includes("mailer-daemon") ||
        fromRaw.includes("postmaster") ||
        subject.includes("delivery status notification") ||
        subject.includes("undelivered mail") ||
        subject.includes("mail delivery failed") ||
        subject.includes("delivery has failed") ||
        subject.includes("address not found") ||
        subject.includes("returned mail");

      if (isBounce) {
        // bounce message me wo email dhoondo jo fail hui
        const emails = [
          ...new Set(
            (rawBody.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []).map((e) =>
              e.toLowerCase()
            )
          ),
        ];
        for (const e of emails) {
          const lead = await Lead.findOne({
            email: e,
            status: { $in: ["sent", "followup_1", "followup_2", "ready"] },
          });
          if (lead) {
            lead.status = "bounced";
            await lead.save();
            bounced++;
            console.log(`   ⚠️ Bounced: ${e} (${lead.businessName}) — address not found`);
          }
        }
        continue; // bounce ko reply mat samjho
      }

      // ---- REPLY / UNSUBSCRIBE detection ----
      const fromEmail = parseEmail(fromRaw || msg.envelope?.from?.[0]?.name);
      if (!fromEmail) continue;

      const lead = await Lead.findOne({
        email: fromEmail,
        status: { $in: ["sent", "followup_1", "followup_2"] },
      });
      if (!lead) continue;

      const isUnsub = UNSUB_WORDS.some((w) => body.includes(w));
      lead.status = isUnsub ? "unsubscribed" : "replied";
      await lead.save();

      if (isUnsub) {
        unsubscribed++;
        console.log(`   🚫 Unsubscribed: ${fromEmail}`);
        await notifyWhatsApp(`🚫 Unsubscribe: ${lead.businessName} (${fromEmail})`);
      } else {
        replied++;
        console.log(`   💬 Replied: ${fromEmail} (sequence rok di)`);
        // 🎉 reply aaya — turant batao!
        await notifyWhatsApp(
          `🎉 NEW REPLY!\n\n${lead.businessName}\n📧 ${fromEmail}\n\nKisi ne tumhari cold email ka reply diya hai. Gmail check karo!`
        );
      }
    }
  } finally {
    lock.release();
    await client.logout();
  }

  console.log(`\n📊 ${replied} replies, ${unsubscribed} unsubscribes, ${bounced} bounced process hue`);
  await disconnectDB();
}

main().catch((err) => {
  // daily pipeline na ruke isliye exit 0 (sirf warning)
  console.error("⚠️ Reply checker skip (IMAP issue?):", err.message);
  process.exit(0);
});
