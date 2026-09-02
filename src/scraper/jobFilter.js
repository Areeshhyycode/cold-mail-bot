/**
 * JOB FILTER + RANK — auto-find (npm run find-jobs) ke liye. PAKISTAN-FIRST.
 *
 * User ki priority (is order me):
 *   1. Karachi (onsite/hybrid) internship/junior — MERN/web
 *   2. Baaki Pakistan (Lahore/Islamabad/remote-PK)
 *   3. Worldwide remote (PK se apply ho sakti)
 *   4. Baaki remote (PK-friendly)
 *
 * PEHLE KYA GHALAT THA: filter sirf REMOTE jobs rakhta tha
 * (`keep = ... && rem.isRemote`), isliye Karachi ki ONSITE internships poori tarah
 * DROP ho jati thi — jabke wahi user ki #1 priority hain. Ab Pakistan-local jobs
 * first-class hain: onsite bhi keep hoti hain aur top pe rank karti hain.
 *
 * Experience: rozee cards "X Years" dete hain (lead.minYears) — us se senior
 * (>=4 yr) filter aur junior (<=2 yr) boost karte hain, sirf title/JD text pe nahi.
 */
import { isSeniorRole, isJuniorFriendly, isRelevantDevRole } from "../ai/intent.js";

// tumhara core stack — job me inme se jitne zyada, utna behtar fit
const STACK = [
  "react", "node", "next.js", "nextjs", "nest.js", "nestjs", "express",
  "mongodb", "mongo", "typescript", "javascript", "full stack", "full-stack",
  "fullstack", "mern", "graphql", "prisma", "postgres", "tailwind", "redux",
];

const PK_CITIES = ["karachi", "lahore", "islamabad", "rawalpindi", "peshawar", "multan", "faisalabad"];

function stackHits(text = "") {
  const t = text.toLowerCase();
  return [...new Set(STACK.filter((s) => t.includes(s)))];
}

/** Pakistan/Karachi location detection (location string + JD text). */
function pakistanInfo(loc = "", text = "", source = "") {
  const t = `${loc} ${text}`.toLowerCase();
  const inKarachi = /\bkarachi\b/.test(t);
  const inPakistan = inKarachi || /\bpakistan\b/.test(t) || PK_CITIES.some((c) => t.includes(c));
  // rozee = Pakistan board — agar location "Remote" bhi ho to PK company hi hai
  const pkSource = source === "rozee";
  return { inKarachi, inPakistan: inPakistan || pkSource, pkSource };
}

/**
 * Remote status — worldwide? PK-friendly? koi country-lock (US-only)?
 */
function remoteInfo(loc = "", desc = "") {
  const t = `${loc} ${desc}`.toLowerCase();
  const isRemote = /remote|anywhere|worldwide|work from home|distributed|wfh/.test(t);
  const worldwide = /worldwide|anywhere in the world|\bglobal\b|any country|any timezone|fully remote/.test(t);
  const m =
    t.match(/\b(us|usa|united states|uk|united kingdom|canada|eu|europe|emea|latam|india)[- ]only\b/) ||
    t.match(/must be (?:located|based)[^.]{0,30}?\b(us|usa|united states|uk|canada|europe|eu)\b/);
  const restriction = m ? m[0] : "";
  const pkFriendly =
    worldwide || /pakistan|\basia\b|apac|any timezone|anywhere/.test(t) || (isRemote && !restriction);
  return { isRemote, worldwide, restriction, pkFriendly };
}

/**
 * Ek job ko evaluate karo (Pakistan-first).
 * @param {object} lead - { jobTitle, jobDescription, location, source, minYears, salary }
 * @returns {{ keep, score, stack, remote, pakistan, isIntern, isJunior, tier }}
 */
export function evaluateJob(lead = {}) {
  const title = lead.jobTitle || "";
  const text = `${title} ${lead.jobDescription || ""}`;
  const hasYears = lead.minYears != null && Number.isFinite(lead.minYears);

  // senior: title/JD keywords YA minYears >= 4 (rozee experience field)
  const senior = isSeniorRole(text) || (hasYears && lead.minYears >= 4);
  // junior: keywords YA minYears <= 2
  const junior = isJuniorFriendly(text) || (hasYears && lead.minYears <= 2);
  const relevant = isRelevantDevRole(title);
  const hits = stackHits(text);
  const rem = remoteInfo(lead.location, lead.jobDescription);
  const pk = pakistanInfo(lead.location, text, lead.source);
  const isIntern = /\bintern(ship)?\b/i.test(title);

  // KEEP: dev-relevant title, senior nahi, aur (Pakistan me HO — onsite bhi theek —
  // YA remote ho). Pakistan-local jobs ke liye stack-keyword optional (rozee ke
  // short snippet me tags na hon, phir bhi relevant title kaafi hai).
  const reachable = pk.inPakistan || rem.isRemote;
  const keep = relevant && !senior && reachable && (hits.length > 0 || pk.inPakistan);

  // TIER (report grouping) + base score — Pakistan-first
  let tier, base;
  if (pk.inKarachi) { tier = "karachi"; base = 40; }
  else if (pk.inPakistan) { tier = "pakistan"; base = 30; }
  else if (rem.worldwide) { tier = "worldwide-remote"; base = 22; }
  else if (rem.pkFriendly) { tier = "remote-pk-friendly"; base = 13; }
  else { tier = "remote"; base = 6; }

  let score = base;
  if (isIntern) score += 22;
  if (junior) score += 18;
  if (hasYears && lead.minYears <= 1) score += 8; // exactly ~fresh/1yr = perfect fit
  if (lead.salary || /salary|compensation|\$|\busd\b|per year|per month|\bpkr\b|\bk\b/i.test(text)) score += 6;
  score += Math.min(hits.length, 4) * 5; // stack depth
  if (/mern|next\.?js|nest\.?js/i.test(text)) score += 8; // exact target frameworks
  if (rem.restriction && !pk.inPakistan) score -= 15; // country-lock (PK jobs par lagu nahi)
  if (senior) score -= 20;

  return {
    keep,
    score: Math.max(0, Math.min(100, score)),
    stack: hits,
    remote: rem,
    pakistan: pk,
    isIntern,
    isJunior: junior,
    minYears: hasYears ? lead.minYears : null,
    tier,
  };
}
