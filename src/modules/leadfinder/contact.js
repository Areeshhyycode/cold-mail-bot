/**
 * CONTACT DISCOVERY (Phase 6).
 *
 * ASLI BAAT jo design badal deti hai:
 *   Jis business ki WEBSITE HI NAHI, uska email crawl karne ki koi jagah nahi.
 *   Un ke liye contact ka EK HI asli source hai — Google Maps ka PHONE.
 *   Aur Pakistan me mobile number = WhatsApp. Isi liye:
 *
 *      no website → phone → +92 normalize → mobile? → wa.me link  ✅ HIGH PRIORITY
 *      has website → crawl → email + socials (+ phone bhi)
 *
 * Har contact ke saath SOURCE aur CONFIDENCE store hoti hai, taake baad me pata ho
 * ke ye number kahan se aaya aur kitna bharosemand hai.
 */
import * as cheerio from "cheerio";
import { fetchText } from "../../core/httpCache.js";
import { extractEmail } from "../../scraper/emailExtractor.js";

/**
 * Pakistani phone number ko E.164 (+92XXXXXXXXXX) me badlo.
 * "+92 301 1832653" → +923011832653
 * "0300 1234567"    → +923001234567
 * "021 34380862"    → +922134380862
 * @returns {string} "" agar samajh na aaye
 */
export function normalizePhone(raw = "") {
  let d = String(raw).replace(/[^\d+]/g, "");
  if (!d) return "";

  if (d.startsWith("+92")) d = d.slice(1);          // +92... → 92...
  else if (d.startsWith("0092")) d = d.slice(2);
  else if (d.startsWith("92") && d.length >= 12) { /* already 92... */ }
  else if (d.startsWith("0")) d = "92" + d.slice(1); // 0300... → 92300...
  else if (d.startsWith("+")) return "+" + d.slice(1); // koi aur mulk — jaisa hai waisa

  if (!d.startsWith("92")) return "";
  // PK: 92 + 10 digits (mobile 3XXXXXXXXX) ya 92 + 9-10 (landline)
  if (d.length < 11 || d.length > 13) return "";
  return "+" + d;
}

/**
 * Ye number WhatsApp pe hoga? PK me MOBILE numbers hi WhatsApp pe hote hain,
 * aur PK mobile hamesha +923... se shuru hota hai (10 digits: 3XXXXXXXXX).
 * Landline (+9221... Karachi) pe WhatsApp nahi hota — usko whatsapp mat kaho.
 */
export function isWhatsappable(e164 = "") {
  return /^\+923\d{9}$/.test(e164);
}

/** wa.me link — "+" ke bina digits chahiye hote hain */
export function waLink(e164 = "") {
  return isWhatsappable(e164) ? `https://wa.me/${e164.replace(/^\+/, "")}` : "";
}

/** business ki website se social profile links nikalo (unki APNI site se — safe) */
function socialsFromHtml(html = "") {
  const $ = cheerio.load(html);
  const found = {};
  const pat = {
    facebook: /facebook\.com\/(?!sharer|share)/i,
    instagram: /instagram\.com\//i,
    linkedin: /linkedin\.com\/(company|in)\//i,
  };
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    for (const [k, re] of Object.entries(pat)) {
      if (!found[k] && re.test(href)) found[k] = href.split("?")[0];
    }
  });
  return found;
}

/**
 * Ek business ke saare contacts dhoondo (priority order me).
 * @param {object} biz - { website, phone }
 * @returns {Promise<Array<{type,value,source,confidence}>>}
 */
export async function findContacts(biz = {}) {
  const out = [];
  const seen = new Set();
  const add = (type, value, source, confidence) => {
    if (!value) return;
    const k = `${type}:${value}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ type, value, source, confidence });
  };

  // ── 1. PHONE (Google Maps) — no-website leads ke liye YEHI sab kuch hai ──
  const e164 = normalizePhone(biz.phone);
  if (e164) {
    add("phone", e164, "google_maps", 0.95); // Maps ka phone bohat reliable hota hai

    // ── 2. WHATSAPP — phone se DERIVE hota hai (confirm nahi kiya, isliye 0.7)
    const wa = waLink(e164);
    if (wa) add("whatsapp", wa, "derived_from_phone", 0.7);
  }

  // ── 3. WEBSITE hai to email + socials ──
  if (biz.website) {
    try {
      const { email } = await extractEmail(biz.website);
      if (email) add("email", email, "website", 0.9);
    } catch {
      /* site down — koi baat nahi */
    }

    const res = await fetchText(biz.website); // cached — audit bhi yehi HTML use karega
    if (res.ok) {
      const soc = socialsFromHtml(res.html);
      for (const [k, v] of Object.entries(soc)) add(k, v, "website", 0.8);
    }
  }

  return out;
}
