/**
 * REPLY SCANNER — `npm run outreach:replies`.
 *
 * Gmail inbox parhta hai (last 7 din), aur jo bhi reply kisi contacted lead se
 * aayi hai use Phase 8 classifier (replies.js) me daal deta hai → Reply doc banta
 * hai (classification + suggested reply, status:"new").
 *
 * Ye purane tracker/replyChecker.js ka POORAK hai:
 *   - replyChecker  → Lead.status update karta hai (replied/bounced/unsubscribed)
 *     + turant notify. Wo chalta rehta hai, chhua nahi.
 *   - replyScan     → us reply ka AI analysis + suggested jawab tayyar karta hai.
 * Dono ek hi inbox parhte hain par alag kaam karte hain; saath chal sakte hain.
 * Idempotent — Gmail message-id (externalId) pe dedupe, dobara process nahi hota.
 */
import { ImapFlow } from "imapflow";
import dotenv from "dotenv";
import { connectDB, disconnectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";
import { handleReply } from "./replies.js";
import { log } from "../core/logger.js";

dotenv.config();

function parseEmail(fromStr = "") {
  const m = String(fromStr).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m ? m[0].toLowerCase() : "";
}

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
  log.info("replyscan.connected");

  const lock = await client.getMailboxLock("INBOX");
  let classified = 0;

  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    for await (const msg of client.fetch({ since }, { envelope: true, source: true })) {
      const fromRaw = (msg.envelope?.from?.[0]?.address || "").toLowerCase();

      // bounce/daemon messages ko skip — wo replyChecker handle karta hai
      if (/mailer-daemon|postmaster|noreply|no-reply/.test(fromRaw)) continue;

      const fromEmail = parseEmail(fromRaw);
      if (!fromEmail) continue;

      // sirf un logon ke reply jinhe humne contact kiya (koi bhi random inbox mail nahi)
      const lead = await Lead.findOne({
        email: fromEmail,
        status: { $in: ["sent", "followup_1", "followup_2", "replied"] },
      });
      if (!lead) continue;

      const externalId = msg.envelope?.messageId || `${fromEmail}:${msg.uid}`;
      const text = extractText(msg.source ? msg.source.toString("utf-8") : "");

      const reply = await handleReply(
        {
          leadId: lead._id,
          from: fromEmail,
          subject: msg.envelope?.subject || "",
          text,
          receivedAt: msg.envelope?.date || new Date(),
          externalId,
          campaign: lead.campaign || "default",
        },
        lead
      );
      if (reply) classified++;
    }
  } finally {
    lock.release();
    await client.logout();
  }

  log.info("replyscan.done", { classified });
  await disconnectDB();
}

/** raw MIME se sirf parhne-layak text nikaalo (best-effort — headers/HTML hata ke) */
function extractText(raw = "") {
  // headers ke baad ka hissa
  const bodyStart = raw.indexOf("\r\n\r\n");
  let body = bodyStart >= 0 ? raw.slice(bodyStart + 4) : raw;
  // HTML tags hata do
  body = body.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  // quoted-printable ka thoda cleanup
  body = body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16))
  );
  return body.replace(/\s+/g, " ").trim().slice(0, 4000);
}

main().catch((err) => {
  // daily pipeline na ruke — exit 0
  log.warn("replyscan.skip", { err: err.message });
  process.exit(0);
});
