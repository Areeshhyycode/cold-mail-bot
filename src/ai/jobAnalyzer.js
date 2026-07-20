/**
 * JOB ANALYZER — Phase 3 + Phase 7.
 *
 * Ek scraped job + tumhari PROFILE (src/ai/profile.js) leta hai aur Groq se
 * nikalta hai:
 *   matchScore, missingSkills, strengths, weaknesses, resumeSuggestions,
 *   interviewDifficulty, salaryEstimate, companySummary, verdict
 * aur (on-demand) tailoredResume + tailoredCoverLetter.
 *
 * Design notes:
 * - JSON mode (response_format) use karte hain — free-text parse karna flaky tha.
 * - Har job pe SIRF EK call (analysis). Resume/cover letter alag call hai jo tab
 *   hoti hai jab tum wo maango — warna har scraped job pe 3 calls jal jati.
 * - Result Mongo me cache hota hai. Dobara wahi job → koi Groq call NAHI.
 * - Groq fail ho to throw karte hain; queue retry/`aiStatus:"error"` sambhalti hai.
 */
import Groq from "groq-sdk";
import dotenv from "dotenv";
import { PROFILE } from "./profile.js";

dotenv.config();

const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
let client = null;
function groq() {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY .env me missing hai");
  if (!client) client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return client;
}

/** Groq ko bhejne ke liye job ka compact text. Poori description bhejna token
 *  jalata hai — 4000 chars kaafi hain (JD ka asli matter shuru me hota hai). */
function jobBrief(job) {
  const L = [];
  const add = (k, v) => { if (v != null && v !== "" && (!Array.isArray(v) || v.length)) L.push(`${k}: ${Array.isArray(v) ? v.join(", ") : v}`); };
  add("Title", job.title);
  add("Company", job.company);
  add("Location", job.location);
  add("Work mode", job.workMode);
  add("Employment type", job.employmentType);
  add("Seniority", job.seniority);
  add("Experience required", job.experienceRequired);
  add("Salary", job.salary || (job.salaryMin ? `${job.salaryCurrency || ""} ${job.salaryMin}-${job.salaryMax || ""} per ${job.salaryPeriod || "year"}` : null));
  add("Skills listed", (job.skills || []).slice(0, 25));
  add("Benefits", (job.benefits || []).slice(0, 10));
  add("Applicants", job.applicantCount);
  add("Requirements", (job.requirements || []).slice(0, 12));
  add("Responsibilities", (job.responsibilities || []).slice(0, 12));
  add("Preferred", (job.preferredQualifications || []).slice(0, 8));
  if (job.description) add("Description", String(job.description).slice(0, 4000));
  if (job.companyDescription) add("About company", String(job.companyDescription).slice(0, 800));
  return L.join("\n");
}

function candidateBrief() {
  return [
    `Name: ${PROFILE.name}`,
    `Title: ${PROFILE.title}`,
    `Location: ${PROFILE.location}`,
    `Summary: ${PROFILE.summary}`,
    `Skills: ${PROFILE.skills.join(" | ")}`,
    `Experience highlights:\n- ${PROFILE.highlights.join("\n- ")}`,
    `Target roles: ${PROFILE.targetRoles.join(", ")}`,
    `Links: ${Object.entries(PROFILE.links).map(([k, v]) => `${k}: ${v}`).join(" | ")}`,
  ].join("\n");
}

async function chatJSON(system, user, maxTokens = 1200) {
  const c = await groq().chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.3,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
  });
  const raw = c.choices[0]?.message?.content || "{}";
  try {
    return JSON.parse(raw);
  } catch {
    // JSON mode ke bawajood kabhi kabhi ```json fence aa jata hai
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("AI ne valid JSON nahi diya");
    return JSON.parse(m[0]);
  }
}

const arr = (v, n = 8) => (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : [])
  .map((x) => String(x).trim()).filter(Boolean).slice(0, n);
const str = (v) => (v == null || v === "" ? null : String(v).trim());
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
};

/**
 * Phase 3 — job ka poora analysis (EK Groq call).
 * @param {object} job — Job doc / plain object
 * @returns {Promise<object>} ai subdocument
 */
export async function analyzeJob(job) {
  const hasJD = !!(job.description && job.description.length > 120);

  const system = `Tum ek senior technical recruiter + career coach ho. Ek CANDIDATE aur ek JOB POSTING diya jayega. Honest, specific analysis do — flattery nahi.

SIRF is shape ka JSON return karo (koi markdown, koi extra text nahi):
{
  "matchScore": <0-100 integer — candidate is job pe kitna fit hai. Honest raho: stack mismatch ya senior role = kam score.>,
  "missingSkills": [<job maangti hai par candidate ke paas nahi — max 8, short names>],
  "strengths": [<candidate ke wo points jo IS job ke liye strong hain — max 5>],
  "weaknesses": [<is job ke liye candidate ki kamzoriyan — max 5, honest>],
  "resumeSuggestions": [<is job ke liye resume me kya badla jaye — max 5, actionable>],
  "interviewDifficulty": "easy" | "medium" | "hard",
  "salaryEstimate": <agar posting me salary NAHI hai to market estimate string (currency + range + period, candidate ki location/role ke hisaab se); posting me salary ho to null>,
  "companySummary": <2 line company summary; maloom na ho to null>,
  "verdict": "apply" | "maybe" | "skip",
  "reasoning": <1-2 line, verdict kyun>
}

Rules:
- Candidate junior/~1 saal experience wala hai. 5+ years ya Staff/Principal role = low matchScore + "skip".
- Job posting ka data hi use karo. Jo maloom nahi uske liye null do — mat banao.
${hasJD ? "" : "- IMPORTANT: is job ki poori description available NAHI hai (sirf title/company/location). Isliye conservative raho, matchScore ko 65 se upar mat le jao, aur reasoning me likho ke description missing hai."}`;

  const user = `CANDIDATE:\n${candidateBrief()}\n\n---\n\nJOB POSTING:\n${jobBrief(job)}`;

  const r = await chatJSON(system, user, 1100);

  return {
    matchScore: num(r.matchScore),
    missingSkills: arr(r.missingSkills, 8),
    strengths: arr(r.strengths, 5),
    weaknesses: arr(r.weaknesses, 5),
    resumeSuggestions: arr(r.resumeSuggestions, 5),
    interviewDifficulty: ["easy", "medium", "hard"].includes(String(r.interviewDifficulty).toLowerCase())
      ? String(r.interviewDifficulty).toLowerCase() : null,
    salaryEstimate: job.salary ? null : str(r.salaryEstimate),
    companySummary: str(r.companySummary),
    verdict: ["apply", "maybe", "skip"].includes(String(r.verdict).toLowerCase())
      ? String(r.verdict).toLowerCase() : null,
    reasoning: str(r.reasoning),
    model: MODEL,
    basedOn: hasJD ? "detail" : "card",
    generatedAt: new Date(),
  };
}

/**
 * Phase 7 — tailored resume + cover letter (alag call, on-demand).
 * Ye MEHNGA hai (lamba output) isliye har job pe auto nahi chalta — sirf jab
 * popup/dashboard se maanga jaye. Result cache ho jata hai.
 */
export async function tailorResume(job) {
  const system = `Tum ek expert resume writer ho. Candidate aur job posting diye jayenge.

SIRF is shape ka JSON return karo:
{
  "tailoredResume": <plain-text resume, IS job ke liye tailored. Sections: SUMMARY, SKILLS, EXPERIENCE, PROJECTS, EDUCATION. Job ki keywords natural tareeqe se use karo (ATS ke liye). Har experience bullet result-oriented ho.>,
  "tailoredCoverLetter": <180-250 words ka cover letter, first person, is company + role ke liye specific. Koi "Dear Hiring Manager" cliché nahi — seedha aur confident. Sign off candidate ke naam se.>
}

RULES (zaroori):
- Sirf candidate ka ASLI experience use karo. Jhooti company, degree, ya saal KABHI mat banao.
- Job ki required skills me se sirf wahi highlight karo jo candidate ke paas WAQAI hain.
- Markdown nahi — plain text (newlines aur "-" bullets theek hain).`;

  const user = `CANDIDATE:\n${candidateBrief()}\n\n---\n\nJOB POSTING:\n${jobBrief(job)}`;

  const r = await chatJSON(system, user, 2600);
  return {
    tailoredResume: str(r.tailoredResume),
    tailoredCoverLetter: str(r.tailoredCoverLetter),
  };
}
