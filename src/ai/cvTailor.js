/**
 * CV TAILOR — kisi job ke liye tumhari CV ko tailor karta hai (vision module #7).
 *
 * Input: job (title + description) + ek CareerProfile (parsed CV).
 * Output: job-specific tailored CV content — rewritten summary, JD ke hisaab se
 * prioritized skills, har role ka tailored 1-line emphasis, aur HONEST missing
 * keywords (gaps).
 *
 * "NEVER INVENT" — AI sirf tumhari MOJOOD experience/skills ko reorder + rephrase
 * karta hai job ke keywords ke saath. Naya role/company/skill kabhi add nahi.
 * Missing skill ho to use "add karo AGAR genuinely aati ho" ke taur pe suggest
 * karta hai — CV me daalta nahi.
 */
import Groq from "groq-sdk";
import dotenv from "dotenv";
import { GROQ_MODEL as MODEL } from "./model.js";
import { matchAgainstProfile } from "./profileSkills.js";

dotenv.config();

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

/**
 * @param {string} jobText - job title + description
 * @param {object} profile - CareerProfile.parsed (fullName, title, summary, skills, roles, …)
 * @returns {Promise<object>} tailored CV content + gaps
 */
export async function tailorCv(jobText = "", profile = {}) {
  const skills = [...(profile.skills || []), ...(profile.technologies || [])];
  // deterministic gap/overlap (fast, reliable) — AI ko bhi feed karte hain
  const cvMatch = matchAgainstProfile(jobText, { skills });

  if (!groq) {
    return {
      summary: profile.summary || "",
      prioritizedSkills: cvMatch.matched,
      roles: (profile.roles || []).map((r) => ({ ...r, emphasis: "" })),
      matchedSkills: cvMatch.matched,
      missingKeywords: cvMatch.missing,
      matchPct: cvMatch.matchPct,
      tips: [],
      note: "AI off — deterministic output.",
    };
  }

  const sys = `Tum ek expert resume writer ho. Ek candidate ki CV ko ek SPECIFIC job ke liye tailor karti ho.
CRITICAL: kuch INVENT mat karo. Sirf diye gaye profile ki MOJOOD skills/roles/experience use karo — reorder aur rephrase kar sakti ho job ke keywords ke saath, par naya role/company/skill/number kabhi add mat karo.
Agar job koi skill maangta hai jo profile me nahi, to use "missingKeywords" me daalo (CV me nahi) aur tips me likho "agar genuinely aati ho to add karo".
JSON return karo.`;

  const roleList = (profile.roles || [])
    .map((r, i) => `${i + 1}. ${r.title || ""}${r.company ? " @ " + r.company : ""}${r.duration ? " (" + r.duration + ")" : ""}`)
    .join("\n");

  const user = `CANDIDATE PROFILE:
Name: ${profile.fullName || ""}
Current title: ${profile.title || ""}
Summary: ${profile.summary || ""}
Skills (ye sab candidate ke paas HAIN): ${skills.join(", ")}
Roles:
${roleList || "(none)"}

TARGET JOB:
"""
${String(jobText).slice(0, 3000)}
"""

Is JSON shape me:
{
  "summary": "2-3 line tailored professional summary — is job ke liye, candidate ki real strengths se",
  "prioritizedSkills": ["candidate ki skills, job-relevance ke order me (sirf wo jo profile me hain)"],
  "roles": [{ "title": "", "company": "", "emphasis": "1 line — is role ka wo pehlu jo is job se relevant hai (real work se)" }],
  "missingKeywords": ["job maangta hai par profile me nahi (honest gaps)"],
  "tips": ["2-4 short actionable tips is job ke liye CV strong karne ko — jhoot nahi"]
}`;

  try {
    const c = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0.4,
      max_tokens: 2200,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
    });
    const p = JSON.parse(c.choices[0]?.message?.content || "{}");
    return {
      summary: (p.summary || profile.summary || "").trim(),
      prioritizedSkills: Array.isArray(p.prioritizedSkills) && p.prioritizedSkills.length ? p.prioritizedSkills : cvMatch.matched,
      roles: Array.isArray(p.roles) ? p.roles : [],
      matchedSkills: cvMatch.matched,
      missingKeywords: Array.isArray(p.missingKeywords) && p.missingKeywords.length ? p.missingKeywords : cvMatch.missing,
      matchPct: cvMatch.matchPct,
      tips: Array.isArray(p.tips) ? p.tips.slice(0, 5) : [],
    };
  } catch (e) {
    return {
      summary: profile.summary || "",
      prioritizedSkills: cvMatch.matched,
      roles: (profile.roles || []).map((r) => ({ title: r.title, company: r.company, emphasis: "" })),
      matchedSkills: cvMatch.matched,
      missingKeywords: cvMatch.missing,
      matchPct: cvMatch.matchPct,
      tips: [],
      note: "AI fail — deterministic fallback: " + e.message,
    };
  }
}
