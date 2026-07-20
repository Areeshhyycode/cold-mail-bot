/**
 * SHARED LEAD INGEST — har source (job boards, Google Maps) yahi use karta hai.
 *
 * Ek raw lead leta hai, intent + score compute karta hai, aur DB me save karta hai.
 * Dedupe DB ke partial-unique indexes (email+campaign, jobUrl+campaign) se hoti hai:
 * agar duplicate ho to create() E11000 throw karta hai jise hum "dup" gin lete hain.
 */
import { Lead } from "../db/Lead.js";
import { classify, isRelevantDevRole } from "../ai/intent.js";
import { normalizeEmail, isJobSeekerPost } from "./targetFilter.js";

const CAMPAIGN = process.env.CAMPAIGN || "default";

/**
 * @param {object} raw - {
 *   leadType?, source?, company?, businessName?, jobTitle?, jobUrl?,
 *   jobDescription?, email?, website?, niche?, location?, city?, phone?, datePosted?
 * }
 * @returns {Promise<"created"|"dup"|"skipped">}
 */
export async function saveLead(raw = {}) {
  // glued phone/junk digits saaf karo ("9343393info@x.com" -> "info@x.com")
  const email = normalizeEmail(raw.email || "");

  // text jisse intent/score nikaalte hain
  const text = [raw.jobTitle, raw.jobDescription, raw.company, raw.businessName, raw.niche, raw.title]
    .filter(Boolean)
    .join(" ");

  // koi useful identity hi nahi -> skip
  if (!email && !raw.jobUrl) return "skipped";

  // JOB-SEEKER post (HN "Who wants to be hired?" wale log) -> hum employer nahi
  // dhoond rahe inse; inhe DB me daalna hi waste hai.
  if (isJobSeekerPost(text, raw.company || raw.businessName)) return "skipped";

  const { intent, score } = classify(text, { hasEmail: Boolean(email) });
  const leadType =
    raw.leadType === "JOB" || raw.leadType === "SERVICE"
      ? raw.leadType
      : intent === "JOB"
      ? "JOB"
      : intent === "SERVICE"
      ? "SERVICE"
      : undefined; // HYBRID -> router baad me decide karega (default schema: SERVICE)

  // FIELD FILTER: job-board JOB leads jinka title software/web-dev role NAHI hai
  // (AI engineer, data, devops, designer, assistant, etc.) -> skip. Speculative
  // software-house leads (koi jobTitle nahi) exempt — woh general application hai.
  if (leadType === "JOB" && (raw.jobTitle || "").trim() && !isRelevantDevRole(raw.jobTitle)) {
    return "skipped";
  }

  const doc = {
    leadType, // undefined ho to schema default (SERVICE) lag jata hai; router phir bhi re-resolve karta hai
    intent,
    score,
    source: raw.source || "",
    company: raw.company || "",
    businessName: raw.businessName || raw.company || "",
    jobTitle: raw.jobTitle || "",
    jobUrl: raw.jobUrl || undefined, // "" mat — warna partial index me aa jayega
    jobDescription: (raw.jobDescription || "").slice(0, 4000),
    website: raw.website || "",
    niche: raw.niche || "",
    location: raw.location || "",
    city: raw.city || "",
    phone: raw.phone || "",
    datePosted: raw.datePosted,
    // website audit ka natija (pehle compute hota tha par kabhi save nahi hota tha)
    websiteQuality: raw.websiteQuality || "unknown",
    auditReasons: raw.auditReasons || [],
    campaign: CAMPAIGN,
    status: "new",
  };
  if (email) doc.email = email;

  try {
    await Lead.create(doc);
    return "created";
  } catch (err) {
    if (err && err.code === 11000) return "dup"; // duplicate (email ya jobUrl already hai)
    throw err;
  }
}

/**
 * Bahut saare leads save karta hai aur summary deta hai.
 * @param {object[]} rawLeads
 * @param {string} [label] - logging ke liye source ka naam
 */
export async function saveLeads(rawLeads = [], label = "") {
  let created = 0;
  let dup = 0;
  let skipped = 0;

  for (const raw of rawLeads) {
    try {
      const r = await saveLead(raw);
      if (r === "created") created++;
      else if (r === "dup") dup++;
      else skipped++;
    } catch (err) {
      skipped++;
      console.log(`   ⚠️  save fail: ${err.message}`);
    }
  }

  console.log(
    `   📥 ${label || "ingest"} → saved: ${created}, duplicate: ${dup}, skipped: ${skipped}`
  );
  return { created, dup, skipped };
}
