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

// Karachi onsite AUR remote dono chalte hain (user: Karachi me onsite, baqi remote)
const LOCATION_KEYWORDS = ["karachi", "lahore", "islamabad", "pakistan", "remote"];

// SENIOR roles (user ~1 saal experience hai, inhe avoid karna hai)
const SENIOR_KEYWORDS = [
  "senior",
  "sr.",
  "sr ",
  "lead ",
  " lead",
  "principal",
  "staff ",
  "architect",
  "manager",
  "director",
  "head of",
  " vp",
  "vp ",
  "5+ years",
  "6+ years",
  "7+ years",
  "8+ years",
  "9+ years",
  "10+ years",
  "5+ yrs",
  "6+ yrs",
  "7+ yrs",
];

// JUNIOR / ~1-year roles (user ke level ke — inhe boost karna hai)
const JUNIOR_KEYWORDS = [
  "junior",
  "jr.",
  "jr ",
  "entry level",
  "entry-level",
  "graduate",
  "intern",
  "internship",
  "associate",
  "fresh",
  "0-2 year",
  "1 year",
  "1+ year",
  "1-2 year",
  "1 to 2 year",
  "2 years",
];

function normalize(text = "") {
  return String(text).toLowerCase();
}

function anyHit(haystack, needles) {
  return needles.some((n) => haystack.includes(n));
}

/** Senior role hai? (5+ years / Lead / Principal etc.) */
export function isSeniorRole(text = "") {
  return anyHit(normalize(text), SENIOR_KEYWORDS);
}

/** Junior / ~1-year experience friendly role hai? */
export function isJuniorFriendly(text = "") {
  return anyHit(normalize(text), JUNIOR_KEYWORDS);
}

// CORE software/web development role keywords — job TITLE me inme se ek hona chahiye
const DEV_ROLE_TITLE = [
  "full stack", "full-stack", "fullstack", "front end", "front-end", "frontend",
  "back end", "back-end", "backend", "mern", "mean", "react", "next.js", "nextjs",
  "node.js", "nodejs", "node developer", "vue", "angular", "javascript", "typescript",
  "web developer", "web development", "web app", "software engineer",
  "software developer", "wordpress developer", "shopify developer", "react native",
  "mobile app developer", "mobile developer", "app developer", ".net developer",
];

// OFF-FIELD roles — chahe JD me thodi web tech mile, ye hum target NAHI karte
// (user MERN/full-stack developer hai — AI/ML, data, devops, design, non-tech skip)
const OFF_FIELD_ROLE = [
  "ai engineer", "ml engineer", "machine learning", "data scientist", "data engineer",
  "data analyst", "devops", "sre", "site reliability", "security engineer", "cybersecurity",
  "blockchain", "solidity", "designer", "ui/ux", "ux/ui", "assistant", "planner",
  "recruiter", "marketing", " sales", "accountant", "bookkeep", "copywriter", "writer",
  "content ", "customer success", "qa engineer", "sdet", "tester", "product manager",
  "project manager", "scrum master", "business analyst", "human resource", "virtual assistant",
  "solutions architect", "cloud architect", "game developer", "unity", "unreal",
  "embedded", "firmware", "hardware",
];

/**
 * Job TITLE software/web-development role hai? (user ki field).
 * Off-field (AI/ML, data, devops, design, non-tech) ko reject karta hai.
 * Speculative software-house leads ka koi title nahi hota — unpe ye lagao mat.
 * @param {string} title
 * @returns {boolean}
 */
export function isRelevantDevRole(title = "") {
  const t = normalize(title);
  if (!t) return false; // khali/junk title -> skip
  if (anyHit(t, OFF_FIELD_ROLE)) return false; // off-field -> skip
  return anyHit(t, DEV_ROLE_TITLE); // core dev role title -> keep
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

  // location relevance (karachi onsite YA remote — dono theek)
  if (anyHit(t, LOCATION_KEYWORDS)) score += 15;

  // direct email = ready to outreach (sabse valuable)
  if (hasEmail) score += 20;

  // experience-level fit: junior/~1-year roles boost, senior roles down-rank
  // (Karachi software houses ke speculative leads me JD nahi hota -> senior nahi lagte)
  if (isJuniorFriendly(t)) score += 15;
  if (isSeniorRole(t)) score -= 30;

  return Math.max(0, Math.min(score, 100));
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
