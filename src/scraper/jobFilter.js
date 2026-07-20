/**
 * JOB FILTER + RANK — auto-find (npm run find-jobs) ke liye.
 *
 * Har raw job ko dekhta hai aur decide karta hai:
 *   keep  -> ye job tumhare liye worth hai? (remote + junior/mid + tumhara stack)
 *   score -> ranking (0-100) tumhari priority ke hisaab se:
 *            worldwide remote > internship > junior/fresh > MERN/Next/Nest stack
 *
 * intent.js ke helpers reuse karta hai (senior/junior/dev-role detection).
 */
import { isSeniorRole, isJuniorFriendly, isRelevantDevRole } from "../ai/intent.js";

// tumhara core stack — job me inme se jitne zyada, utna behtar fit
const STACK = [
  "react", "node", "next.js", "nextjs", "nest.js", "nestjs", "express",
  "mongodb", "mongo", "typescript", "javascript", "full stack", "full-stack",
  "fullstack", "mern", "graphql", "prisma", "postgres", "tailwind", "redux",
];

function stackHits(text = "") {
  const t = text.toLowerCase();
  return [...new Set(STACK.filter((s) => t.includes(s)))];
}

/**
 * Remote status samajho — worldwide hai? Pakistan-friendly lagta hai? koi
 * country-lock (US-only) to nahi? (short location strings pe best-effort.)
 */
function remoteInfo(loc = "", desc = "") {
  const t = `${loc} ${desc}`.toLowerCase();
  const isRemote = /remote|anywhere|worldwide|work from home|distributed|wfh/.test(t);
  const worldwide = /worldwide|anywhere in the world|\bglobal\b|any country|any timezone|fully remote/.test(t);
  // location string jo Pakistan ko exclude kar sakti hai
  const m =
    t.match(/\b(us|usa|united states|uk|united kingdom|canada|eu|europe|emea|latam|india)[- ]only\b/) ||
    t.match(/must be (?:located|based)[^.]{0,30}?\b(us|usa|united states|uk|canada|europe|eu)\b/);
  const restriction = m ? m[0] : "";
  const pkFriendly =
    worldwide || /pakistan|\basia\b|apac|any timezone|anywhere/.test(t) || (isRemote && !restriction);
  return { isRemote, worldwide, restriction, pkFriendly };
}

/**
 * Ek job ko evaluate karo.
 * @param {object} lead - { jobTitle, jobDescription, location, source, ... }
 * @returns {{ keep:boolean, score:number, stack:string[], remote:object, isIntern:boolean, isJunior:boolean }}
 */
export function evaluateJob(lead = {}) {
  const title = lead.jobTitle || "";
  const text = `${title} ${lead.jobDescription || ""}`;
  const senior = isSeniorRole(text);
  const junior = isJuniorFriendly(text);
  const relevant = isRelevantDevRole(title);
  const hits = stackHits(text);
  const rem = remoteInfo(lead.location, lead.jobDescription);
  // intern sirf TITLE se pakdo — description me "intern" (internal/interns) false
  // positive deta tha, jisse mid-level role galti se "Internship" mark ho jata tha.
  const isIntern = /\bintern(ship)?\b/i.test(title);

  // KEEP: dev-relevant title, senior nahi, remote, aur tumhara stack mile
  const keep = relevant && !senior && rem.isRemote && hits.length > 0;

  // RANK (tumhari priority)
  let score = 0;
  if (rem.worldwide) score += 30;
  else if (rem.pkFriendly) score += 18;
  else if (rem.isRemote) score += 8;
  if (isIntern) score += 20;
  if (junior) score += 20;
  if (/salary|compensation|\$|\busd\b|per year|per month|comp:/i.test(text)) score += 8; // paid signal
  score += Math.min(hits.length, 4) * 6; // stack depth
  if (/mern|next\.?js|nest\.?js/i.test(text)) score += 8; // exact target frameworks
  if (rem.restriction) score -= 15;

  return {
    keep,
    score: Math.max(0, Math.min(100, score)),
    stack: hits,
    remote: rem,
    isIntern,
    isJunior: junior,
  };
}
