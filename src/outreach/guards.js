/**
 * PHASE 11 — SAFETY & COMPLIANCE, per channel.
 *
 * Ye NAYA compliance nahi bana raha — mojooda guards ko naye channels pe LAGA raha
 * hai. Purana sender/run.js already ye sab karta hai (email ke liye). Yahan wahi
 * usool har channel pe:
 *
 *   - Unsubscribe suppression : unsub kar chuke lead ko KISI channel pe nahi
 *     (email se unsub → WhatsApp bhi ruk jata hai)
 *   - Bounce suppression      : jis email-domain pe bounce hua, us pe dobara nahi
 *   - Duplicate prevention    : Message ka unique index (leadId+campaign+step+variant)
 *   - Rate limiting           : per-channel daily cap (email 40, whatsapp 15…)
 *   - Domain reputation       : email pe MX verify (verifyEmail reuse)
 *
 * Dispatcher har message bhejne se PEHLE ye guards check karta hai.
 */
import { Lead } from "../db/Lead.js";
import { Message } from "../db/Message.js";
import { verifyEmail } from "../scraper/verifyEmail.js";
import { log } from "../core/logger.js";

const domainOf = (email = "") => (email.split("@")[1] || "").toLowerCase();

/* per-channel daily caps — WhatsApp jaan-boojh ke kam (bulk nahi, manual review) */
export const CHANNEL_DAILY_CAP = {
  email: parseInt(process.env.DAILY_SEND_LIMIT || "40", 10),
  whatsapp: parseInt(process.env.WHATSAPP_DAILY_LIMIT || "15", 10),
  contact_form: parseInt(process.env.FORM_DAILY_LIMIT || "20", 10),
  linkedin: parseInt(process.env.LINKEDIN_DAILY_LIMIT || "20", 10),
  facebook: 20,
  instagram: 20,
};

/**
 * Suppression set ek dafa bana lo (per-run) — har message pe DB hit na ho.
 * @returns {Promise<{unsubEmails:Set, bouncedDomains:Set}>}
 */
export async function buildSuppression() {
  const [unsub, bounced] = await Promise.all([
    Lead.distinct("email", { status: "unsubscribed" }),
    Lead.distinct("email", { status: "bounced" }),
  ]);
  return {
    unsubEmails: new Set(unsub.filter(Boolean).map((e) => e.toLowerCase())),
    bouncedDomains: new Set(bounced.map(domainOf).filter(Boolean)),
  };
}

/**
 * Aaj is channel pe kitne ja chuke — cap ke against.
 * @returns {Promise<number>}
 */
export async function sentTodayOnChannel(channel) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return Message.countDocuments({
    channel,
    sentAt: { $gte: start },
    status: { $in: ["sent", "delivered", "opened", "replied"] },
  });
}

/**
 * Ek message bhejne se pehle ka faisla. Send-time pe chalta hai (compose-time pe
 * nahi — taake draft to ban jaye par send guard pe ruke).
 *
 * @param {object} message - Message doc
 * @param {object} lead    - us ka Lead
 * @param {object} suppression - buildSuppression() ka natija
 * @param {object} counts  - { [channel]: sentSoFarThisRun } mutable counter
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
export async function canSend(message, lead, suppression, counts = {}) {
  const ch = message.channel;

  // 1) unsubscribe — kisi bhi channel pe nahi (email se unsub sabko rokta hai)
  const email = (lead?.email || "").toLowerCase();
  if (email && suppression.unsubEmails.has(email)) {
    return { ok: false, reason: "lead ne unsubscribe kiya hua hai" };
  }
  if (lead?.status === "unsubscribed") {
    return { ok: false, reason: "lead unsubscribed" };
  }

  // 2) rate limit — per channel daily cap
  const cap = CHANNEL_DAILY_CAP[ch] ?? 20;
  const already = counts[ch] ?? 0;
  if (already >= cap) {
    return { ok: false, reason: `${ch} ka aaj ka cap pura (${cap})` };
  }

  // 3) email-only guards
  if (ch === "email") {
    if (!email) return { ok: false, reason: "email channel par lead ka email nahi" };

    // bounce suppression — domain reputation bachao
    if (suppression.bouncedDomains.has(domainOf(email))) {
      return { ok: false, reason: "is domain pe pehle bounce ho chuka" };
    }
    // MX verify (agar pehle na hui ho) — reuse verifyEmail
    if (!lead.emailStatus || lead.emailStatus === "unknown") {
      try {
        lead.emailStatus = await verifyEmail(email);
        await Lead.updateOne({ _id: lead._id }, { $set: { emailStatus: lead.emailStatus } });
      } catch (err) {
        log.warn("guard.mx_check_fail", { email, err: err.message });
      }
    }
    if (lead.emailStatus === "invalid") {
      return { ok: false, reason: "email MX verify pe invalid" };
    }
  }

  return { ok: true };
}
