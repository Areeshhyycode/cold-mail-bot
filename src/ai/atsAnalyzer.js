/**
 * ATS ANALYZER — kisi CV ko ATS (Applicant Tracking System) ke nazariye se score
 * karta hai. Do hisse:
 *
 *   1. DETERMINISTIC checks (fast, no AI, reliable) — structure, contact, sections,
 *      measurable achievements, length, multi-column/parse red-flags.
 *   2. AI checks (Groq) — holistic score, missing keywords, targeted suggestions.
 *      Agar target job diya ho to us job ke against keyword/skill match bhi.
 *
 * Output: { score, breakdown{}, redFlags[], suggestions[], missingKeywords[], strengths[] }
 *
 * COMPLIANCE / honesty: suggestions sirf wording/structure/keywords ke bare me —
 * jhooti experience/skill add karne ko kabhi nahi kehta.
 */
import Groq from "groq-sdk";
import dotenv from "dotenv";
import { GROQ_MODEL as MODEL } from "./model.js";

dotenv.config();

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

/** Deterministic structural checks — AI ke bina bhi kaam karte hain. */
export function structuralChecks(text = "") {
  const t = text.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean).length;

  const hasEmail = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text);
  const hasPhone = /(\+?\d[\d\s-]{7,}\d)/.test(text);
  const hasSummary = /(summary|profile|objective|about)/i.test(text);
  const hasExperience = /(experience|employment|work history)/i.test(text);
  const hasEducation = /(education|academic|qualification)/i.test(text);
  const hasSkills = /(skills|competenc|technolog|proficienc)/i.test(text);
  // measurable achievements — numbers / % / "X+ candidates"
  const metrics = (text.match(/\b\d+\s*(\+|%|k\b|candidates?|hires?|employees?|days?|hours?|projects?|clients?)/gi) || []).length;
  // spaced-out headers ("E X P E R I E N C E") — ATS section-detection tor deta hai
  const spacedHeaders = /(?:[A-Z]\s){3,}[A-Z]/.test(text);
  // multi-column hint: extracted text ka order jumbled (experience summary se pehle etc.)
  const expIdx = t.indexOf("experience");
  const sumIdx = t.indexOf("summary");
  const jumbled = expIdx > -1 && sumIdx > -1 && expIdx < sumIdx; // summary aam tor pe pehle hota

  return {
    words,
    hasEmail, hasPhone, hasSummary, hasExperience, hasEducation, hasSkills,
    measurableAchievements: metrics,
    spacedHeaders,
    likelyMultiColumn: jumbled,
    lengthOk: words >= 200 && words <= 900,
  };
}

/** structural checks -> deterministic sub-score (0-45) + red flags */
function structuralScore(c) {
  let s = 0;
  const flags = [];
  if (c.hasEmail && c.hasPhone) s += 6; else flags.push("Contact info incomplete (email + phone dono chahiye).");
  if (c.hasSummary) s += 5; else flags.push("Koi Summary/Profile section nahi.");
  if (c.hasExperience) s += 8; else flags.push("Experience section clearly nahi mila.");
  if (c.hasEducation) s += 5; else flags.push("Education section nahi mila.");
  if (c.hasSkills) s += 8; else flags.push("Koi Skills section nahi — ATS keyword match ke liye zaroori.");
  if (c.measurableAchievements >= 2) s += 6; else flags.push("Measurable achievements kam (numbers/% add karo — e.g. 'screened 50+ candidates').");
  if (!c.spacedHeaders) s += 3; else flags.push("Headers me spaces hain ('E X P E R I E N C E') — ATS inhe section headers nahi samajhta; normal text use karo.");
  if (!c.likelyMultiColumn) s += 4; else flags.push("Layout multi-column lagta hai — ATS multi-column CVs ka text jumble kar deta hai. Single-column use karo.");
  return { score: s, flags };
}

/**
 * Poora ATS analysis.
 * @param {string} cvText
 * @param {object} [opts] - { jobText, role } — target job (optional)
 * @returns {Promise<object>}
 */
export async function analyzeCv(cvText = "", opts = {}) {
  const checks = structuralChecks(cvText);
  const structural = structuralScore(checks);

  // AI holistic (55 points) — score + keywords + suggestions
  let ai = { aiScore: 30, missingKeywords: [], suggestions: [], strengths: [] };
  if (groq && cvText.trim()) {
    try {
      const sys = `Tum ek ATS + recruiter expert ho. Ek CV ko ATS-friendliness aur role-fit ke liye evaluate karo.
JSON return karo. Honest raho. Jhooti experience/skill add karne ko NAHI kaho — sirf wording, structure, aur genuinely-missing keywords jo candidate ke real background se justify hon.`;
      const user = `CV TEXT:
"""
${cvText.slice(0, 6000)}
"""
${opts.jobText ? `TARGET JOB:\n"""\n${String(opts.jobText).slice(0, 2000)}\n"""` : `TARGET ROLE: ${opts.role || "(general — is CV ki apni field)"}`}

Is JSON shape me:
{
  "aiScore": 0-55,
  "strengths": ["..."],
  "missingKeywords": ["role ke liye important keywords jo CV me nahi (par candidate ke background se justified)"],
  "suggestions": ["specific, actionable — wording/structure/keywords; har ek 1 line"],
  "verdict": "strong | okay | needs-work"
}`;
      const c = await groq.chat.completions.create({
        model: MODEL,
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        temperature: 0.3,
        max_tokens: 1500,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
      });
      const p = JSON.parse(c.choices[0]?.message?.content || "{}");
      ai = {
        aiScore: Math.max(0, Math.min(55, +p.aiScore || 30)),
        missingKeywords: Array.isArray(p.missingKeywords) ? p.missingKeywords.slice(0, 12) : [],
        suggestions: Array.isArray(p.suggestions) ? p.suggestions.slice(0, 10) : [],
        strengths: Array.isArray(p.strengths) ? p.strengths.slice(0, 6) : [],
        verdict: p.verdict || "",
      };
    } catch {
      /* AI fail -> sirf structural score */
    }
  }

  const score = Math.round(structural.score + ai.aiScore);
  return {
    score: Math.max(0, Math.min(100, score)),
    verdict: ai.verdict || (score >= 80 ? "strong" : score >= 60 ? "okay" : "needs-work"),
    breakdown: {
      structural: structural.score,       // /45
      content: ai.aiScore,                // /55
    },
    checks,
    redFlags: structural.flags,
    strengths: ai.strengths,
    missingKeywords: ai.missingKeywords,
    suggestions: ai.suggestions,
  };
}

/* --------------------------------- standalone -------------------------------- */
import { fileURLToPath } from "url";
import { resolve } from "path";
const _norm = (p) => resolve(p).replace(/\\/g, "/").toLowerCase();
if (process.argv[1] && _norm(fileURLToPath(import.meta.url)) === _norm(process.argv[1])) {
  const path = process.argv[2];
  if (!path) { console.error("usage: node src/ai/atsAnalyzer.js <cv.pdf>"); process.exit(1); }
  (async () => {
    const { extractPdfText } = await import("./cvParser.js");
    const text = await extractPdfText(path);
    const r = await analyzeCv(text, { role: process.argv[3] || "" });
    console.log(JSON.stringify(r, null, 2));
  })().catch((e) => { console.error("❌", e.message); process.exit(1); });
}
