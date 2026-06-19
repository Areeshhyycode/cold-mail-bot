/**
 * TARGET QUALITY FILTER — decide kis email pe bhejna WORTH hai.
 *
 * Yahi module 0% reply-rate ka asli ilaaj hai. Teen problems pakadta hai jo
 * pehle silently emails waste kar rahe the:
 *
 *   1. JOB-SEEKER posts        -> HN "Who wants to be hired?" thread ke log (jo KHUD
 *                                 job dhoond rahe hain) galti se employer samajh ke
 *                                 email ho jate the. Inhe skip karo.
 *   2. GENERIC inboxes (JOB)   -> info@/contact@/hello@ pe job application kabhi
 *                                 hiring manager tak nahi pahunchti. JOB leads ke liye
 *                                 skip; SERVICE pitches ke liye theek hai (woh business
 *                                 ko hi pitch karte hain).
 *   3. GLUED / junk emails     -> "9343393info@seolahore.com" jaise (phone number email
 *                                 se chipka hua). Clean karo ya risky mark karo.
 */

/* ---- generic mailbox local-parts: JOB application yahan bekaar jati hai ---- */
// NOTE: careers/hr/jobs/hiring/recruiting/talent/people JAAN-BOOJH ke baahar hain —
// ye LEGIT job-application targets hain, generic spam-inbox nahi.
const GENERIC_LOCALPARTS = new Set([
  "info",
  "contact",
  "hello",
  "hi",
  "sales",
  "support",
  "admin",
  "office",
  "team",
  "mail",
  "marketing",
  "enquiry",
  "enquiries",
  "inquiry",
  "general",
  "webmaster",
  "service",
  "services",
]);

/* ---- job-SEEKER signals: ye log hire karne nahi, hire HONE aaye hain ---- */
const SEEKER_PHRASES = [
  "seeking work",
  "seeking a position",
  "seeking new",
  "open to work",
  "looking for work",
  "looking for a new role",
  "available for hire",
  "available for work",
  "available immediately",
  "willing to relocate",
  "want to be hired",
  "wants to be hired",
  "i am a developer",
  "i'm a developer",
  "my resume",
  "my résumé",
  "résumé/cv",
  "resume/cv",
  "open to remote",
];

/**
 * Email ke local part se leading phone/junk digits hata ke saaf karta hai.
 * "9343393info@seolahore.com" -> "info@seolahore.com"
 * @param {string} email
 * @returns {string}
 */
export function normalizeEmail(email = "") {
  const e = email.toLowerCase().trim();
  const at = e.indexOf("@");
  if (at <= 0) return e;
  let local = e.slice(0, at);
  const domain = e.slice(at + 1);
  // 5+ digits ka leading run (phone number chipka hua) hata do
  local = local.replace(/^\d{5,}/, "");
  if (!local) return e; // sab digits the -> as-is (verifier risky mark karega)
  return `${local}@${domain}`;
}

/**
 * true agar email ek GENERIC inbox hai (info@, contact@, ...). Job application
 * yahan na bhejo. Leading-digit junk pehle strip karte hain.
 * @param {string} email
 * @returns {boolean}
 */
export function isGenericInbox(email = "") {
  const local = normalizeEmail(email).split("@")[0] || "";
  return GENERIC_LOCALPARTS.has(local);
}

/**
 * true agar email kisi REAL person ki lagti hai (named inbox), generic nahi.
 * henry.anderson@, alexander@ -> true ; info@, careers@ -> false.
 * Warm-lead mode ke liye sabse valuable.
 * @param {string} email
 * @returns {boolean}
 */
export function looksLikePerson(email = "") {
  const local = normalizeEmail(email).split("@")[0] || "";
  if (!local) return false;
  if (isGenericInbox(email)) return false;
  // role inboxes (careers/hr/jobs...) person nahi — legit hain par "warm" nahi
  if (/^(careers?|hr|jobs?|hiring|recruit|recruiting|talent|people|apply|join|work)$/.test(local))
    return false;
  // named lagti hai: dot/underscore wala (john.doe) ya plain naam
  return /[a-z]/.test(local) && local.length >= 2;
}

/**
 * true agar ye post kisi JOB-SEEKER ka hai (employer nahi). Aise leads pe
 * "mujhe job do" email bhejna bekaar — woh khud job dhoond rahe hain.
 * @param {string} text     - post body / job description
 * @param {string} [company]- parsed company/title field
 * @returns {boolean}
 */
export function isJobSeekerPost(text = "", company = "") {
  const t = `${company} ${text}`.toLowerCase();
  // HN "Who wants to be hired?" template ka structured giveaway
  const templateHits = ["location:", "remote:", "willing to relocate:", "technologies:", "résumé", "resume:"]
    .filter((k) => t.includes(k)).length;
  if (templateHits >= 3) return true;
  return SEEKER_PHRASES.some((p) => t.includes(p));
}

/**
 * Ek JOB lead bhejne layak hai? (generic inbox skip + seeker skip)
 * SERVICE leads pe ye filter NAHI lagana (woh business ko pitch karte hain).
 * @param {object} lead - { email, company, jobTitle, jobDescription, businessName }
 * @returns {{ ok: boolean, reason?: string }}
 */
export function jobLeadSendable(lead = {}) {
  const text = [lead.jobTitle, lead.jobDescription, lead.company, lead.businessName]
    .filter(Boolean)
    .join(" ");
  if (isJobSeekerPost(text, lead.company || lead.businessName)) {
    return { ok: false, reason: "job-seeker post (not an employer)" };
  }
  // SPECULATIVE software-house leads (no jobUrl, e.g. Karachi software houses) ke paas
  // aksar sirf info@/contact@ hota hai — wahi unhe reach karne ka tareeka hai, isliye
  // unpe generic-inbox rule na lagao. Sirf ASLI job-postings (jobUrl wale) pe lagao.
  const speculative = !lead.jobUrl;
  if (!speculative && lead.email && isGenericInbox(lead.email)) {
    return { ok: false, reason: "generic inbox (won't reach a hiring manager)" };
  }
  return { ok: true };
}
