/**
 * ALERTS — jab kuch GHALAT ho to turant pata chale.
 *
 * MASLA: bot 7 din tak chup-chaap 0 emails bhejta raha aur kisi ko pata nahi chala.
 * Workflow "success" dikhata raha (continue-on-error), aur notify sirf tab bhejta
 * tha jab koi REPLY aati. Yaani failure ka koi signal hi nahi tha — pata Gmail
 * dekh kar chala, ek hafte baad.
 *
 * Ab ye cheezein alert karti hain (Telegram + self-email, notify.js ke through):
 *   - send queue khali (bhejne ko kuch nahi)
 *   - sourcing ne 0 naye leads diye
 *   - SMTP login fail
 *   - bounce rate 5% se upar (deliverability khatre me)
 */
import mongoose from "mongoose";
import { notify } from "../utils/notify.js";
import { log } from "./logger.js";

/**
 * THROTTLE — workflow din me 5 baar chalta hai. Bina iske wahi alert 5 baar aata
 * aur tum use ignore karne lagti (alert fatigue). Ek alert per 20 ghante.
 */
async function shouldSend(key, minHours = 20) {
  try {
    const c = mongoose.connection.collection("alerts");
    const now = new Date();
    const prev = await c.findOne({ _id: key });
    if (prev && now - new Date(prev.lastSentAt) < minHours * 3600 * 1000) return false;
    await c.updateOne({ _id: key }, { $set: { lastSentAt: now } }, { upsert: true });
    return true;
  } catch {
    return true; // DB masla -> alert bhej do (chup rehne se behtar)
  }
}

/**
 * @param {string} title   - chhota title (Telegram/subject me dikhega)
 * @param {string} message - detail
 */
export async function alert(title, message = "") {
  log.warn("alert", { title });
  try {
    await notify(`🚨 ${title}\n\n${message}`, `🚨 Cold Mail Bot — ${title}`);
  } catch (err) {
    log.warn("alert.deliver_fail", { error: err.message });
  }
}

/** Bhejne ke liye koi lead hi nahi bachi (7-din wali khamoshi ka asli signal). */
export async function alertEmptyQueue() {
  if (!(await shouldSend("empty_queue"))) return;
  await alert(
    "Send queue is EMPTY",
    "Koi 'ready' lead nahi bachi — isi liye emails ruk jati hain.\n" +
      "Sourcing naye leads nahi de raha. `npm run scrape` chala ke dekho."
  );
}

/** Sourcing chala par 0 naye leads mile (sab duplicate/skip). */
export async function alertNoNewLeads(source, stats = {}) {
  if (!(await shouldSend(`no_new_leads:${source}`))) return;
  await alert(
    "Sourcing found 0 NEW leads",
    `Source: ${source}\n` +
      `saved=${stats.created ?? 0} duplicate=${stats.dup ?? 0} skipped=${stats.skipped ?? 0}\n\n` +
      "Lead pool khatam ho raha hai — queries/geography expand karni paregi."
  );
}

/** SMTP login hi fail — kuch bhi nahi ja sakta. */
export async function alertSmtpDown(reason = "") {
  if (!(await shouldSend("smtp_down", 4))) return; // ye zyada urgent hai — 4 ghante
  await alert(
    "SMTP login FAILED",
    `Gmail App Password reject ho gaya ya server reachable nahi.\n${reason}\n\n` +
      "Jab tak ye theek nahi hota, ek bhi email nahi jayegi."
  );
}

/** Bounce rate khatre ke nishan se upar. */
export async function alertHighBounce(rate, bounced, sent) {
  if (!(await shouldSend("high_bounce"))) return;
  await alert(
    `Bounce rate ${rate}% — TOO HIGH`,
    `${bounced} bounced / ${sent} sent.\n\n` +
      "5% se upar bounce pe Gmail sender reputation gira deta hai — asli emails bhi spam me jane lagti hain. " +
      "Bhejne se pehle verification zaroori hai."
  );
}
