/**
 * DISPATCHER — `npm run outreach:send`.
 *
 * Approved/ready messages ko un ke channel se bhejta hai. EMAIL channel auto-send
 * hota hai; baaki channels sirf "ready" hote hain (manual — tum bhejte ho).
 *
 * PARALLEL PATH: ye sender/run.js ki JAGAH nahi leta. Dono Lead.status likhte hain
 * (delivered→"sent", bounce→"bounced"), isliye replyChecker/report/followup dono
 * cases me pehle jaisa chalte hain. daily.js OUTREACH_V2 flag dekh ke ek chunta hai.
 *
 * Phase 11 guards har send se pehle: unsubscribe/bounce suppression, per-channel
 * rate limit, MX verify. withLock("sender") — purane sender ke saath race nahi.
 */
import dotenv from "dotenv";
import { connectDB, disconnectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";
import { Message } from "../db/Message.js";
import { Campaign, isSendable, inSendWindow } from "../db/Campaign.js";
import { sendViaChannel } from "./channels.js";
import { canSend, buildSuppression } from "./guards.js";
import { randomDelay, verifyConnection } from "../sender/mailer.js";
import { withLock } from "../core/lock.js";
import { alertEmptyQueue, alertSmtpDown } from "../core/alerts.js";
import { log } from "../core/logger.js";

dotenv.config();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await connectDB();

  // email bhejni ho to SMTP pehle verify (jaisa sender/run.js karta hai)
  const needEmail = await Message.exists({ channel: "email", status: { $in: ["approved", "queued"] } });
  if (needEmail && !(await verifyConnection())) {
    log.error("dispatch.smtp_down");
    await alertSmtpDown("outreach dispatch — verifyConnection() fail");
    await disconnectDB();
    return;
  }

  const suppression = await buildSuppression();
  const counts = {};   // per-channel sent-this-run (rate limit ke against)

  // EMAIL: approved + auto-approved (requiresApproval:false wale bhi approved status
  // me aate hain compose se). MANUAL channels: sirf explicitly "approved".
  const messages = await Message.find({
    status: { $in: ["approved", "queued"] },
  })
    .sort({ channel: 1, createdAt: 1 })
    .limit(500);

  if (!messages.length) {
    log.warn("dispatch.queue_empty");
    await alertEmptyQueue();
    await disconnectDB();
    return;
  }

  log.info("dispatch.start", { queued: messages.length });

  // campaign cache (pause/window check)
  const campaigns = new Map();
  const getCampaign = async (name) => {
    if (campaigns.has(name)) return campaigns.get(name);
    const c = await Campaign.findOne({ name });
    campaigns.set(name, c);
    return c;
  };

  let sent = 0, manual = 0, skipped = 0, failed = 0, emailsSent = 0;

  for (const msg of messages) {
    try {
      const lead = await Lead.findById(msg.leadId);
      if (!lead) { await mark(msg, "skipped", "lead nahi mili"); skipped++; continue; }

      // campaign paused / window ke bahar?
      const campaign = await getCampaign(msg.campaign);
      const sendable = isSendable(campaign);
      if (campaign && !sendable.ok) { await mark(msg, "skipped", sendable.reason); skipped++; continue; }
      if (campaign && msg.channel === "email") {
        const win = inSendWindow(campaign);
        if (!win.ok) { log.debug("dispatch.window", { reason: win.reason }); continue; } // baad me
      }

      // Phase 11 guards
      const guard = await canSend(msg, lead, suppression, counts);
      if (!guard.ok) { await mark(msg, "skipped", guard.reason); skipped++; continue; }

      // bhejo
      const result = await sendViaChannel(msg, lead);

      if (result.manual) {
        // manual channel — "ready to send by you". sent nahi karte; tum dashboard se
        // "Mark sent" karoge. Yahan sirf queued→approved rehne dete hain.
        manual++;
        counts[msg.channel] = (counts[msg.channel] || 0) + 1;
        log.info("dispatch.manual_ready", { channel: msg.channel, lead: String(lead._id) });
        continue;
      }

      if (result.error) { await mark(msg, "failed", result.error); failed++; continue; }

      const delivered = result.delivered !== false;
      const now = new Date();
      msg.status = delivered ? "delivered" : "bounced";
      msg.sentAt = now;
      msg.sentHour = now.getHours();
      if (delivered) msg.deliveredAt = now;
      msg.providerMessageId = result.providerMessageId || "";
      await msg.save();

      // BACKWARD COMPAT: Lead.status bhi update — taake purana replyChecker/report/
      // followup (jo Lead pe chalte hain) ko ye send dikhe. Yehi wo cheez hai jo
      // dono paths ko compatible rakhti hai.
      lead.status = delivered ? "sent" : "bounced";
      lead.currentStep = msg.step;
      lead.lastSentAt = now;
      lead.sentCount = (lead.sentCount || 0) + 1;
      // purane fields bhi bhar do (dashboard/report inhe parhte hain)
      if (!lead.subject) lead.subject = msg.subject;
      if (!lead.body) lead.body = msg.body;
      await lead.save();

      sent++;
      counts[msg.channel] = (counts[msg.channel] || 0) + 1;
      if (msg.channel === "email") emailsSent++;
      log.info("dispatch.sent", { channel: msg.channel, delivered, lead: String(lead._id) });

      // email pe human-like delay (mailer.js jaisa) — baaki channels pe zaroorat nahi
      if (msg.channel === "email" && emailsSent < messages.length) {
        await sleep(randomDelay());
      }
    } catch (err) {
      failed++;
      log.error("dispatch.error", { msg: String(msg._id), err: err.message });
      if (/Invalid login|auth/i.test(err.message)) {
        log.error("dispatch.smtp_auth_stop");
        break;
      }
    }
  }

  log.info("dispatch.done", { sent, manual, skipped, failed });
  await disconnectDB();
}

async function mark(msg, status, reason) {
  msg.status = status;
  if (reason) msg.skipReason = reason;
  await msg.save();
}

withLock("sender", main).catch((err) => {
  log.error("dispatch.fatal", { error: err.message });
  process.exit(1);
});
