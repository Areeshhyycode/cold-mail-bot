/**
 * PHASE 2 — AI RESEARCH BEFORE OUTREACH.
 *
 * Kisi bhi message se PEHLE business ko research karta hai:
 *   Business name · Industry · Services · Website status · Website audit ·
 *   Socials · Google rating (jo mila) · Contact form · Online presence score ·
 *   AI summary + best pitch angle.
 *
 * Domain pe cache (Research collection, 30-din TTL). Ek company ke do leads
 * (info@ + sales@) dobara research nahi karwate.
 *
 * Reuse: websiteAudit.js (jaisa hai) + httpCache (wahi HTML jo audit uthata hai) +
 * emailExtractor. Kuch dobara nahi likha.
 */
import * as cheerio from "cheerio";
import { fetchText } from "../../core/httpCache.js";
import { auditWebsite } from "../../scraper/websiteAudit.js";
import { Research, toDomain, isStale } from "../../db/Research.js";
import { askJSON, MODEL, hasGroq } from "../ai.js";
import { log } from "../../core/logger.js";
import { extractSignals, detectTechStack, findContactForm } from "./signals.js";

/**
 * Ek lead ko research karo (cache-first).
 *
 * @param {object} lead - { businessName, website, niche, city, email, phone }
 * @param {object} [opts] - { force }
 * @returns {Promise<object>} plain Research object (lean)
 */
export async function researchBusiness(lead = {}, opts = {}) {
  const website = (lead.website || "").trim();
  const domain = website ? toDomain(website) : "";

  // website hi nahi → research collection me daalne layak kuch nahi. Minimal shape do.
  if (!domain) {
    return {
      domain: "",
      businessName: lead.businessName || lead.company || "",
      websiteStatus: "none",
      websiteQuality: "none",
      onlinePresenceScore: 5,
      presenceGaps: ["Koi website nahi"],
      emails: lead.email ? [lead.email] : [],
      phones: lead.phone ? [lead.phone] : [],
      socials: {},
      aiSummary: "",
      aiAngle: "Business ki koi website nahi — sabse bara gap yehi hai.",
    };
  }

  // cache hit?
  const cached = await Research.findOne({ domain }).lean();
  if (cached && !isStale(cached) && !opts.force) {
    log.debug("research.cache_hit", { domain });
    return cached;
  }

  const data = await doResearch(lead, website, domain);

  // upsert (do leads ek saath aayen to E11000 → phir se parh lo)
  try {
    await Research.updateOne({ domain }, { $set: data }, { upsert: true });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
  return (await Research.findOne({ domain }).lean()) || data;
}

async function doResearch(lead, website, domain) {
  const base = {
    domain,
    website,
    businessName: lead.businessName || lead.company || "",
    location: lead.city || lead.location || "",
    researchedAt: new Date(),
    aiModel: "",
    error: "",
  };

  // 1) website audit (reuse) — quality + reasons
  let audit = { quality: "unknown", reasons: [] };
  try {
    audit = await auditWebsite(website);
  } catch (err) {
    log.warn("research.audit_fail", { domain, err: err.message });
  }
  base.websiteQuality = audit.quality;
  base.auditReasons = audit.reasons || [];
  base.websiteStatus = audit.quality === "none" ? "broken" : "live";

  // 2) HTML se signals (socials, emails, phones, contact form, tech)
  let html = "";
  try {
    const res = await fetchText(website, { timeoutMs: 12000 });
    if (res.ok) html = res.html;
  } catch { /* audit ne already handle kiya */ }

  if (html) {
    const $ = cheerio.load(html);
    const sig = extractSignals($, html, website);
    base.socials = sig.socials;
    base.emails = [...new Set([...(lead.email ? [lead.email] : []), ...sig.emails])].slice(0, 5);
    base.phones = [...new Set([...(lead.phone ? [lead.phone] : []), ...sig.phones])].slice(0, 5);
    base.techStack = detectTechStack($, html);
    const form = findContactForm($, website);
    base.contactFormUrl = form.url;
    base.contactFormFields = form.fields;
    base._siteText = sig.text; // AI ke liye — save nahi hota (schema me nahi)
  } else {
    base.socials = {};
    base.emails = lead.email ? [lead.email] : [];
    base.phones = lead.phone ? [lead.phone] : [];
  }

  // 3) online presence score (rule-based — free)
  const presence = scorePresence(base);
  base.onlinePresenceScore = presence.score;
  base.presenceGaps = presence.gaps;

  // 4) AI summary + angle (Groq available ho to)
  if (hasGroq()) {
    try {
      const ai = await summarize(base, lead);
      base.industry = ai.industry || lead.niche || "";
      base.services = ai.services || [];
      base.companySize = ai.companySize || "";
      base.aiSummary = ai.summary || "";
      base.aiAngle = ai.angle || "";
      base.aiModel = MODEL;
    } catch (err) {
      log.warn("research.ai_fail", { domain, err: err.message });
      base.industry = lead.niche || "";
    }
  } else {
    base.industry = lead.niche || "";
  }

  delete base._siteText;
  return base;
}

/* --------------------- online presence score (0-100) --------------------- */
/** KAM score = kamzor presence = BEHTAR agency target (ulta feel hota hai par sahi) */
function scorePresence(r) {
  let score = 0;
  const gaps = [];

  if (r.websiteStatus === "live") score += 25;
  else gaps.push("Website live nahi / broken");

  if (r.websiteQuality === "ok") score += 20;
  else if (r.websiteQuality === "outdated") { score += 8; gaps.push("Website purani/kamzor lagti hai"); }

  const s = r.socials || {};
  if (s.linkedin) score += 12; else gaps.push("Koi LinkedIn page nahi");
  if (s.facebook) score += 8; else gaps.push("Koi Facebook page nahi");
  if (s.instagram) score += 8;
  if (r.googleRating != null) score += 15;
  else gaps.push("Google Business profile / rating nahi mili");
  if ((r.techStack || []).length) score += 4;
  if (/^https:/i.test(r.website)) score += 10; else gaps.push("Website pe HTTPS nahi");

  return { score: Math.max(0, Math.min(100, score)), gaps };
}

/* ------------------------------- AI summary ------------------------------ */
async function summarize(r, lead) {
  const siteText = (r._siteText || "").slice(0, 1400);
  const prompt = `Tum ek B2B sales researcher ho. Neeche ek business ka data hai. SIRF JSON return karo.

BUSINESS:
- Naam: ${r.businessName || lead.businessName || "(pata nahi)"}
- Niche/hint: ${lead.niche || "(pata nahi)"}
- Location: ${r.location || "(pata nahi)"}
- Website quality: ${r.websiteQuality} (${(r.auditReasons || []).join(", ") || "koi note nahi"})
- Socials mile: ${Object.entries(r.socials || {}).filter(([, v]) => v).map(([k]) => k).join(", ") || "koi nahi"}
- Website text (kaccha): ${siteText || "(nahi mila)"}

JSON format (EXACT). English. Jo maloom nahi uska guess mat karo — empty do:
{
  "industry": "2-4 word industry (e.g. 'dental clinic', 'real estate agency'). Guess mat karo agar clear na ho.",
  "services": ["business jo services deta hai — 2-4 short items, sirf jo text me dikhein"],
  "companySize": "agar clearly pata chale to '1-10' / '11-50' / '50+' warna empty string",
  "summary": "2-3 line neutral business summary — ye kaun hai, kya karte hain, online presence kaisi hai.",
  "angle": "1 line: agency pitch ke liye sabse strong angle kya hai (unki sabse bari online-presence kami)."
}`;

  const p = await askJSON(prompt, { temperature: 0.4, maxTokens: 500 });
  return {
    industry: (p.industry || "").trim(),
    services: Array.isArray(p.services) ? p.services.filter(Boolean).slice(0, 4) : [],
    companySize: (p.companySize || "").trim(),
    summary: (p.summary || "").trim(),
    angle: (p.angle || "").trim(),
  };
}
