/**
 * PHASE 1 — COMMUNICATION DECISION ENGINE.
 *
 * Har business ke liye BEHTAREEN channel choose karta hai, aur ye bhi batata hai
 * ke KYUN. Priority (user ki di hui):
 *
 *   1. Business Email     → auto-send ho sakta hai
 *   2. Contact Form       → draft, tum submit karo
 *   3. WhatsApp           → draft + wa.me link, tum bhejo
 *   4. LinkedIn           → draft
 *   5. Facebook Messenger → draft
 *   6. Instagram DM       → draft
 *   7. (kuch nahi mila)   → manual outreach ke liye save
 *
 * FAISLA RULE-BASED HAI, AI-BASED NAHI — jaan-boojh ke. Ye project pehle se isi
 * usool pe chalta hai (intent.js / jobFilter.js / targetFilter.js sab rules hain;
 * LLM sirf copy likhta hai). Channel ka faisla deterministic, free aur reproducible
 * hona chahiye — LLM se poochne ka koi faida nahi, sirf kharcha aur ghair-yaqeeni pan.
 *
 * SIRF EMAIL auto-send hota hai. Baaki har channel `requiresApproval: true` hai —
 * WhatsApp/LinkedIn/DM kabhi khud-ba-khud nahi jayega.
 */
import { isGenericInbox, normalizeEmail } from "../scraper/targetFilter.js";

/* Channel → kya isse khud bheja ja sakta hai? */
export const AUTO_SEND = new Set(["email"]);

export const CHANNEL_PRIORITY = [
  "email",
  "contact_form",
  "whatsapp",
  "linkedin",
  "facebook",
  "instagram",
];

/* ---------------------------- phone → WhatsApp ---------------------------- */
/**
 * Pakistani mobile number ko E.164 (923xxxxxxxxx) me badalta hai — wa.me isi
 * format ko samajhta hai. Landline (021-xxx) WhatsApp pe nahi hota, isliye reject.
 *
 * Accept: 03001234567 · +92 300 1234567 · 0092-300-1234567 · 3001234567
 * Reject: 02134567890 (landline) · 12345 (junk)
 *
 * @returns {string} "923001234567" ya "" agar WhatsApp-able na ho
 */
export function toWhatsAppNumber(phone = "") {
  let d = String(phone).replace(/[^\d]/g, "");
  if (!d) return "";

  if (d.startsWith("0092")) d = d.slice(4);
  else if (d.startsWith("92")) d = d.slice(2);
  else if (d.startsWith("0")) d = d.slice(1);

  // PK mobile = 3 se shuru, total 10 digits (3XX XXXXXXX). Landline (21/42/51…) nahi.
  if (!/^3\d{9}$/.test(d)) return "";
  return `92${d}`;
}

/** Non-PK international number bhi chalega agar plausible ho (10-15 digits) */
function toIntlNumber(phone = "") {
  const d = String(phone).replace(/[^\d]/g, "");
  return /^\d{10,15}$/.test(d) ? d : "";
}

/* ------------------------------ email quality ----------------------------- */
/**
 * Business email bhejne layak hai?
 *
 * NOTE: generic inbox (info@ / contact@) yahan REJECT NAHI hota. Job applications
 * ke liye wo bekaar hai (targetFilter.js wahan block karta hai) — lekin AGENCY
 * pitch ke liye info@ bilkul sahi address hai, wahi to business ka inbox hai.
 * Ye farq is poore engine ka bunyadi usool hai.
 */
function emailReason(lead) {
  const raw = (lead.email || "").trim();
  if (!raw) return { ok: false, text: "Koi business email nahi mili" };

  const email = normalizeEmail(raw);
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) {
    return { ok: false, text: `Email ka format kharab hai (${raw})` };
  }
  // verifyEmail() ne pehle MX check kiya hoga (scraper/sender me) — us ka natija maano
  if (lead.emailStatus === "invalid") {
    return { ok: false, text: `Email verify pe fail hui (MX record nahi) — ${email}` };
  }
  if (lead.status === "unsubscribed") {
    return { ok: false, text: "Is business ne unsubscribe kiya hua hai" };
  }

  const generic = isGenericInbox(email);
  return {
    ok: true,
    text: generic
      ? `Business inbox mila (${email}) — agency pitch ke liye bilkul sahi`
      : `Direct email mila (${email})`,
  };
}

/**
 * Har business ke liye channel choose karo.
 *
 * @param {object} lead      - Lead doc ({ email, phone, website, status, ... })
 * @param {object} [research]- Research doc (Phase 2) — socials + contact form yahan se
 * @param {string[]} [allowed] - campaign.style.channels (jo campaign allow karti hai)
 * @returns {{
 *   channel: string,               // chuna gaya channel ("manual" agar kuch na ho)
 *   requiresApproval: boolean,
 *   reasons: Array<{ok:boolean,text:string}>,   // HAR channel ka faisla + wajah
 *   fallbacks: string[],           // jo aur channels mumkin the (priority order me)
 *   target: string,                // email / URL / wa number — jahan bhejna hai
 * }}
 */
export function decideChannel(lead = {}, research = null, allowed = null) {
  const allow = (c) => !allowed || allowed.includes(c);
  const socials = research?.socials || {};
  const reasons = [];
  const available = [];   // [{channel, target, reason}] priority order me

  /* ---------------------------- 1. EMAIL ---------------------------------- */
  const em = emailReason(lead);
  if (em.ok && allow("email")) {
    available.push({ channel: "email", target: normalizeEmail(lead.email), reason: em.text });
    reasons.push({ ok: true, text: `✅ Email — ${em.text}` });
  } else {
    reasons.push({
      ok: false,
      text: `❌ Email — ${em.ok ? "campaign me email channel off hai" : em.text}`,
    });
  }

  /* ------------------------- 2. CONTACT FORM ------------------------------ */
  const form = research?.contactFormUrl || "";
  if (form && allow("contact_form")) {
    const n = research?.contactFormFields?.length || 0;
    available.push({ channel: "contact_form", target: form, reason: `Contact form mila (${n} fields)` });
    reasons.push({ ok: true, text: `✅ Contact form — website pe form mila (${form})` });
  } else {
    reasons.push({
      ok: false,
      text: form ? "❌ Contact form — campaign me off hai" : "❌ Contact form — website pe koi form nahi mila",
    });
  }

  /* --------------------------- 3. WHATSAPP -------------------------------- */
  // pehle site pe mila hua wa.me link dekho, warna lead ka phone number
  const waFromSite = (socials.whatsapp || "").replace(/[^\d]/g, "");
  const wa = waFromSite || toWhatsAppNumber(lead.phone) || "";
  if (wa && allow("whatsapp")) {
    available.push({
      channel: "whatsapp",
      target: wa,
      reason: waFromSite ? "Website pe WhatsApp link mila" : `Mobile number mila (+${wa})`,
    });
    reasons.push({ ok: true, text: `✅ WhatsApp — +${wa}` });
  } else if (lead.phone && !wa) {
    // ye khaas case batana zaroori hai — warna lagta hai number tha hi nahi
    reasons.push({
      ok: false,
      text: `❌ WhatsApp — number (${lead.phone}) mobile nahi lagta (landline WhatsApp pe nahi hota)`,
    });
  } else {
    reasons.push({ ok: false, text: "❌ WhatsApp — koi mobile number nahi mila" });
  }

  /* ---------------------- 4/5/6. LINKEDIN / FB / IG ----------------------- */
  for (const [ch, url, label] of [
    ["linkedin", socials.linkedin, "LinkedIn page"],
    ["facebook", socials.facebook, "Facebook page"],
    ["instagram", socials.instagram, "Instagram profile"],
  ]) {
    if (url && allow(ch)) {
      available.push({ channel: ch, target: url, reason: `${label} mila` });
      reasons.push({ ok: true, text: `✅ ${label} — ${url}` });
    } else {
      reasons.push({ ok: false, text: `❌ ${label} — nahi mila` });
    }
  }

  /* ----------------------------- FAISLA ----------------------------------- */
  available.sort(
    (a, b) => CHANNEL_PRIORITY.indexOf(a.channel) - CHANNEL_PRIORITY.indexOf(b.channel)
  );

  if (!available.length) {
    return {
      channel: "manual",
      requiresApproval: true,
      target: "",
      fallbacks: [],
      reasons: [
        ...reasons,
        { ok: false, text: "→ Koi channel nahi mila. Manual outreach ke liye save kiya." },
      ],
    };
  }

  const pick = available[0];
  const auto = AUTO_SEND.has(pick.channel);

  reasons.push({
    ok: true,
    text: `→ ${pick.channel.toUpperCase()} chuna gaya (priority #${
      CHANNEL_PRIORITY.indexOf(pick.channel) + 1
    }) — ${pick.reason}. ${
      auto ? "Auto-send ho sakta hai." : "Tumhari approval ke bagair NAHI jayega."
    }`,
  });

  return {
    channel: pick.channel,
    target: pick.target,
    requiresApproval: !auto,
    fallbacks: available.slice(1).map((a) => a.channel),
    reasons,
  };
}

/** Sirf pass/fail reasons ki text list (logs/CLI ke liye) */
export function explainChannel(decision) {
  return decision.reasons.map((r) => r.text).join("\n");
}
