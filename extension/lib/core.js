/* Job Apply Assistant — shared core (ES module).
 *
 * Ye file EK jagah pe wo sab define karti hai jo pehle 3 files me copy-paste tha:
 * job ka shape, dedupe keys, seniority classification, fit score, skills, normQ.
 *
 * Import karne wale:
 *   - popup.js          (module)
 *   - background.js     (module service worker)
 *   - autofill-content.js  (dynamic import() — isliye lib/ web_accessible_resources me hai)
 *
 * NOTE: is file me kuch bhi chrome.* ya DOM pe depend nahi karta — pure logic,
 * taake teeno contexts (popup / SW / content script) me chale.
 */

/* ------------------------------ job shape -------------------------------- */
/* Har scraped job ka canonical shape. Jo field na mile wo `null` rehta hai
   (task requirement: missing = null, ignore nahi). Ye list Mongo ke
   src/db/Job.js schema se exactly match karti hai. */
export const JOB_FIELDS = [
  "title", "company", "companyLogo", "companyWebsite", "companyLinkedin",
  "url", "jobId", "atsId", "atsPlatform",
  "salary", "salaryCurrency", "salaryMin", "salaryMax", "salaryPeriod",
  "experienceRequired", "skills", "technologies",
  "employmentType", "seniority", "workMode",
  "location", "country", "city",
  "benefits", "recruiterName", "recruiterProfile",
  "datePosted", "applicantCount", "easyApply",
  "companyDescription", "description",
  "responsibilities", "requirements", "preferredQualifications",
];

const ARRAY_FIELDS = new Set([
  "skills", "technologies", "benefits",
  "responsibilities", "requirements", "preferredQualifications",
]);

/** Kisi bhi partial object ko poore canonical job me normalize karo.
 *  Missing scalar -> null, missing array -> []. Extra keys drop nahi hote
 *  (meta fields jaise status/syncState bhi guzar jate hain). */
export function normalizeJob(raw = {}) {
  const j = {};
  for (const f of JOB_FIELDS) {
    const v = raw[f];
    if (ARRAY_FIELDS.has(f)) {
      j[f] = Array.isArray(v) ? v.filter(Boolean).map(String) : [];
    } else if (v === undefined || v === "" || v === null) {
      j[f] = null;
    } else {
      j[f] = v;
    }
  }
  // derived fields jo scraper se na aaye ho
  if (!j.seniority && j.title) j.seniority = classify(j.title);
  if (!j.workMode) j.workMode = detectWorkMode(`${j.title || ""} ${j.location || ""} ${j.description || ""}`);
  if (!j.atsPlatform && j.url) j.atsPlatform = detectAts(j.url);
  if (!j.city && j.location) j.city = splitLocation(j.location).city;
  if (!j.country && j.location) j.country = splitLocation(j.location).country;
  return j;
}

/* ----------------------------- job statuses ------------------------------ */
/* Phase 5 — lifecycle. `new` = abhi scrape hua, kuch decide nahi kiya. */
export const STATUSES = [
  "new", "saved", "applied", "ignored", "archived",
  "rejected", "interview", "offer", "accepted",
];
export const STATUS_LABEL = {
  new: "new", saved: "⭐ saved", applied: "✓ applied", ignored: "🚫 ignored",
  archived: "📦 archived", rejected: "✕ rejected", interview: "🗣 interview",
  offer: "🎉 offer", accepted: "🏆 accepted",
};
/* jo statuses "ye job ab list me nahi chahiye" matlab rakhte hain */
export const DEAD_STATUSES = new Set(["ignored", "archived", "rejected"]);

/* ------------------------------- dedupe ---------------------------------- */
/* Phase 8 — smart duplicate detection.
 *
 * dedupeKey = STRONG identity. Preference order:
 *   1. ATS id      (greenhouse gh_jid, lever id, workday req)  — sabse reliable
 *   2. site job id (indeed jk, linkedin numeric id)
 *   3. normalized URL (tracking params hata ke)
 * fingerprint = WEAK identity (company + title + city). Alag URL par same job
 *   (e.g. LinkedIn + company career page) pakadne ke liye — backend isse
 *   "possible duplicate" detect karta hai. */
export function normalizeUrl(u) {
  if (!u) return null;
  try {
    const x = new URL(u);
    x.hash = "";
    // tracking / session junk hatao — warna same job 5 alag "unique" URLs bnti hai
    const kill = /^(utm_|ref_|src|from|source|trk|trackingId|refId|position|pageNum|eBP|origin|alid|sid|vjs|tk|xkcb|xpse|xfps|xkcb|jsa|mo|cmp)/i;
    for (const k of [...x.searchParams.keys()]) if (kill.test(k)) x.searchParams.delete(k);
    x.searchParams.sort();
    let s = x.toString();
    if (s.endsWith("?")) s = s.slice(0, -1);
    return s.replace(/\/$/, "");
  } catch {
    return String(u);
  }
}

const slug = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function dedupeKey(job = {}) {
  if (job.atsPlatform && job.atsId) return `ats:${job.atsPlatform}:${job.atsId}`;
  if (job.jobId) {
    const host = hostOf(job.url) || "job";
    return `id:${host}:${job.jobId}`;
  }
  const u = normalizeUrl(job.url);
  return u ? `url:${u}` : `fp:${fingerprint(job)}`;
}

export function fingerprint(job = {}) {
  const title = slug(job.title).replace(/-(i|ii|iii|senior|junior|jr|sr)$/, "");
  return [slug(job.company), title, slug(job.city || job.location)].join("|");
}

export function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; }
}

/* ---------------------- classification / heuristics ---------------------- */
export const SENIOR_RE = /\b(senior|sr\.?|lead|staff|principal|head\s+of|architect|manager|director|vp|chief)\b|\b([5-9]|1\d)\+?\s*years?\b/i;
export const JUNIOR_RE = /\b(junior|jr\.?|entry[-\s]?level|graduate|trainee|fresh(er)?s?)\b/i;
export const INTERN_RE = /\b(intern|internship|apprentice)\b/i;
export const JUNK_RE = /\b(dentist|physician|dermatolog|doctor|mbbs|embroider|digitizer|truck|dispatch|electrical|electronics? technician|site engineer|sales executive|aesthetic|hospital it|nurse|pharmac)\b/i;
export const DEV_RE = /\b(developer|engineer|web|frontend|front[-\s]?end|backend|back[-\s]?end|full[-\s]?stack|mern|mean|react|next\.?js|nest\.?js|node|javascript|typescript|software|wordpress|php|laravel|vue|angular|python|programmer)\b/i;

/** internship | junior | mid | senior | junk  (first match wins) */
export function classify(text) {
  const s = String(text || "");
  if (JUNK_RE.test(s)) return "junk";
  if (INTERN_RE.test(s)) return "internship";
  if (SENIOR_RE.test(s)) return "senior";
  if (JUNIOR_RE.test(s)) return "junior";
  return "mid";
}

/** remote | hybrid | onsite | null */
export function detectWorkMode(text) {
  const t = String(text || "").toLowerCase();
  if (/\bhybrid\b/.test(t)) return "hybrid";
  if (/\bremote\b|\banywhere\b|worldwide|work from home|\bwfh\b|distributed/.test(t)) return "remote";
  if (/\bon[-\s]?site\b|\bin[-\s]?office\b|\bin person\b/.test(t)) return "onsite";
  return null;
}

/** greenhouse | lever | workday | ashby | smartrecruiters | workable | recruitee | bamboohr | indeed | linkedin | null */
const ATS_PATTERNS = [
  [/greenhouse\.io|gh_jid=/i, "greenhouse"],
  [/jobs\.lever\.co|lever\.co/i, "lever"],
  [/myworkdayjobs\.com|workday/i, "workday"],
  [/jobs\.ashbyhq\.com|ashbyhq/i, "ashby"],
  [/smartrecruiters\.com/i, "smartrecruiters"],
  [/apply\.workable\.com|workable\.com/i, "workable"],
  [/recruitee\.com/i, "recruitee"],
  [/bamboohr\.com/i, "bamboohr"],
  [/breezy\.hr/i, "breezy"],
  [/indeed\.com/i, "indeed"],
  [/linkedin\.com/i, "linkedin"],
  [/rozee\.pk/i, "rozee"],
];
export function detectAts(url) {
  const u = String(url || "");
  for (const [re, name] of ATS_PATTERNS) if (re.test(u)) return name;
  return null;
}

/** ATS ka apna job id nikaalo (dedupe ke liye sabse strong signal) */
export function extractAtsId(url) {
  const u = String(url || "");
  let m;
  if ((m = u.match(/[?&]gh_jid=(\d+)/i))) return m[1];
  if ((m = u.match(/lever\.co\/[^/]+\/([a-f0-9-]{16,})/i))) return m[1];
  if ((m = u.match(/ashbyhq\.com\/[^/]+\/([a-f0-9-]{16,})/i))) return m[1];
  if ((m = u.match(/[?&]jk=([a-z0-9]+)/i))) return m[1];
  if ((m = u.match(/\/jobs\/view\/(\d+)/i))) return m[1];
  return null;
}

/** "Karachi, Pakistan" -> {city:"Karachi", country:"Pakistan"} (best-effort) */
const COUNTRIES = ["pakistan", "united states", "usa", "uk", "united kingdom", "canada", "germany",
  "netherlands", "australia", "india", "uae", "united arab emirates", "saudi arabia", "qatar",
  "singapore", "poland", "spain", "france", "ireland", "remote"];
export function splitLocation(loc) {
  const raw = String(loc || "").replace(/\s+/g, " ").trim();
  if (!raw) return { city: null, country: null };
  const parts = raw.split(/\s*[,·|]\s*/).filter(Boolean);
  let country = null, city = null;
  for (const p of parts) {
    if (COUNTRIES.includes(p.toLowerCase())) country = p;
  }
  const nonCountry = parts.filter((p) => !COUNTRIES.includes(p.toLowerCase()));
  if (nonCountry.length) city = nonCountry[0];
  if (!country && parts.length > 1) country = parts[parts.length - 1];
  if (/^remote$/i.test(city || "")) city = null;
  return { city: city || null, country: country || null };
}

/* ------------------------------- skills ---------------------------------- */
/* longest-first taake "Node.js" pehle match ho "Node" se, aur "Spring Boot"
   pehle "Spring" se. Regex ek hi baar compile hoti hai (module scope) — pehle
   ye har call pe 23 RegExp banata tha. */
export const STACK = [
  "React Native", "Next.js", "Nest.js", "Node.js", "Spring Boot", "Tailwind CSS",
  "Express", "MongoDB", "PostgreSQL", "MySQL", "GraphQL", "TypeScript", "JavaScript",
  "React", "Angular", "Vue", "Svelte", "Redux", "Three.js", "Laravel", "PHP",
  "Python", "Django", "Flask", "Java", "Spring", ".NET", "C#", "Docker", "Kubernetes",
  "AWS", "Azure", "GCP", "Firebase", "Prisma", "Jest", "Cypress", "Git", "REST",
  "Node", "MERN", "MEAN", "WordPress", "Figma", "Sass", "Webpack", "Vite",
];
const STACK_RE = STACK.map((s) => ({
  name: s,
  re: new RegExp(`(^|[^\\w.#+])${s.replace(/[.+*?^${}()|[\]\\]/g, "\\$&")}($|[^\\w.#+])`, "i"),
}));

/** kisi bhi text (title ya poori description) me se tech stack nikaalo */
export function skillsFor(text, limit = 12) {
  const t = String(text || "");
  const found = [];
  for (const { name, re } of STACK_RE) {
    if (re.test(t) && !found.some((f) => f.toLowerCase() === name.toLowerCase())) found.push(name);
  }
  if (found.includes("MERN")) {
    for (const s of ["React", "Node.js", "MongoDB", "Express"]) if (!found.includes(s)) found.push(s);
  }
  // chhota naam drop karo agar lamba match usko cover karta hai (Node ⊂ Node.js)
  const deduped = found.filter(
    (s) => !found.some((o) => o !== s && o.toLowerCase().includes(s.toLowerCase()))
  );
  return deduped.slice(0, limit);
}

/* ------------------------ deterministic fit score ------------------------ */
/* 0–100. Ye LOCAL hai (koi AI call nahi) — har job pe turant chal jata hai,
   list ko rank karne ke liye. AI ka apna `ai.matchScore` alag field hai jo
   backend deta hai (Groq) — dono popup me dikhte hain. */
export function fitScore(job = {}, profileSkills = []) {
  const title = String(job.title || "");
  const blob = `${title} ${job.description || ""} ${(job.skills || []).join(" ")} ${(job.technologies || []).join(" ")}`;
  const level = job.seniority || classify(title);
  if (level === "junk") return 0;

  let s = 30; // base: plausible dev role
  const mine = (profileSkills.length ? profileSkills : ["react", "node", "next", "nest", "express", "mongodb", "javascript", "typescript", "mern", "full stack"])
    .map((x) => String(x).toLowerCase());
  const hits = mine.filter((k) => blob.toLowerCase().includes(k)).length;
  s += Math.min(hits, 5) * 10;                        // stack overlap (max +50)

  if (level === "internship" || level === "junior") s += 18;
  if (level === "senior") s -= 40;

  const mode = job.workMode || detectWorkMode(blob);
  if (mode === "remote") s += 10;
  if (mode === "hybrid") s += 4;

  if (!DEV_RE.test(title)) s -= 25;                   // web-dev role hi nahi
  if (job.easyApply) s += 5;                          // apply karna aasan
  if (job.salaryMin || job.salary) s += 5;            // salary disclosed = serious posting
  if (typeof job.applicantCount === "number" && job.applicantCount > 200) s -= 8; // bahut crowded

  return Math.max(0, Math.min(100, Math.round(s)));
}

/* --------------------------- answer normalization ------------------------ */
/* autofill-content.js aur popup.js DONO ye use karte hain. Pehle ye do jagah
   copy tha — agar drift ho jata to saved answers chup-chaap match hona band
   kar dete. Ab ek hi source. */
export function normQ(q) {
  return String(q || "")
    .toLowerCase()
    .replace(/in \d+ characters?( or (fewer|less))?/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

/* ------------------------------- misc ------------------------------------ */
export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/** href me sirf http(s) allow karo — scraped `javascript:` URL XSS vector tha */
export function safeUrl(u) {
  const s = String(u || "");
  return /^https?:\/\//i.test(s) ? s : "#";
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));