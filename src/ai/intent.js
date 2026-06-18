/**
 * INTENT DETECTION + LEAD SCORING (rule-based, fast, no API cost).
 *
 * Har raw text (job post / business blurb) ko classify karta hai:
 *   JOB     -> koi hire kar raha hai / hum job apply karna chahte hain
 *   SERVICE -> business jise website/SEO/AI service chahiye
 *   HYBRID  -> dono signals (ya koi clear signal nahi) -> AI/router decide karega
 *
 * Yahi module router.js (final leadType) aur scraper ingest (scoring) dono use karte hain.
 */

/* ---- ROLE / NICHE keywords ---- */
// JOB side: developer roles jo hum target karte hain
export const ROLE_KEYWORDS = [
  "full stack",
  "full-stack",
  "mern",
  "next.js",
  "nextjs",
  "nest.js",
  "nestjs",
  "react native",
  "react",
  "node.js",
  "nodejs",
  "frontend",
  "front-end",
  "backend",
  "back-end",
  "software engineer",
  "web developer",
  "javascript",
  "typescript",
];

// SERVICE side: agency niches
export const SERVICE_NICHES = [
  "web development",
  "web design",
  "website",
  "seo",
  "mobile app",
  "real estate website",
  "ecommerce",
  "shopify",
  "digital marketing",
  "branding",
];

/* ---- INTENT phrase keywords ---- */
const JOB_PHRASES = [
  "we are hiring",
  "we're hiring",
  "now hiring",
  "is hiring",
  "hiring",
  "looking for a developer",
  "looking for developer",
  "looking to hire",
  "need a developer",
  "need developer",
  "job opening",
  "job opportunity",
  "open position",
  "open role",
  "vacancy",
  "we are looking for",
  "join our team",
  "join the team",
  "apply now",
  "software house",
  "software company",
  "careers",
];

const SERVICE_PHRASES = [
  "seo services",
  "website design",
  "need a website",
  "need help with",
  "want to build",
  "redesign",
  "looking for an agency",
  "need marketing",
  "grow my business",
  "improve our website",
];

const LOCATION_KEYWORDS = ["karachi", "lahore", "islamabad", "pakistan", "remote"];

function normalize(text = "") {
  return String(text).toLowerCase();
}

function anyHit(haystack, needles) {
  return needles.some((n) => haystack.includes(n));
}

/**
 * @param {string} text
 * @returns {"JOB"|"SERVICE"|"HYBRID"}
 */
export function detectIntent(text = "") {
  const t = normalize(text);
  const isJob = anyHit(t, JOB_PHRASES) || anyHit(t, ROLE_KEYWORDS);
  const isService = anyHit(t, SERVICE_PHRASES);

  if (isJob && !isService) return "JOB";
  if (isService && !isJob) return "SERVICE";
  return "HYBRID"; // dono ya koi nahi -> router/AI decide
}

/**
 * Lead quality score (0-100). Zyada score = pehle bhejna chahiye.
 * @param {object} opts
 * @param {string} opts.text     - post/business ka text
 * @param {string} [opts.intent] - pehle se computed intent (warna detect)
 * @param {boolean} [opts.hasEmail] - direct email mila? (outreach-ready)
 * @returns {number}
 */
export function scoreLead({ text = "", intent, hasEmail = false } = {}) {
  const t = normalize(text);
  let score = 0;

  // role/niche match
  if (anyHit(t, ROLE_KEYWORDS) || anyHit(t, SERVICE_NICHES)) score += 40;

  // clear intent (JOB ya SERVICE, HYBRID nahi)
  const finalIntent = intent || detectIntent(t);
  if (finalIntent !== "HYBRID") score += 25;

  // location relevance (karachi/remote etc.)
  if (anyHit(t, LOCATION_KEYWORDS)) score += 15;

  // direct email = ready to outreach (sabse valuable)
  if (hasEmail) score += 20;

  return Math.min(score, 100);
}

/**
 * Convenience: ek hi call me intent + score.
 * @param {string} text
 * @param {object} [opts] - { hasEmail }
 * @returns {{ intent: string, score: number }}
 */
export function classify(text = "", opts = {}) {
  const intent = detectIntent(text);
  const score = scoreLead({ text, intent, hasEmail: opts.hasEmail });
  return { intent, score };
}
