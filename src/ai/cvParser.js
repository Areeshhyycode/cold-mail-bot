/**
 * CV PARSER — PDF/text CV ko structured profile me todta hai.
 *
 * FLOW: PDF -> text (pdf-parse) -> Groq (JSON mode) -> structured fields.
 *
 * "NEVER INVENT" — sirf CV me jo LIKHA hai wahi extract karo. Skills/experience
 * add mat karo jo CV me nahi. (User ki apni CV me "Resume Parsing" skill hai —
 * yehi wo feature hai.)
 *
 * Standalone test:
 *   node src/ai/cvParser.js assets/cv.pdf
 */
import fs from "fs";
import Groq from "groq-sdk";
import dotenv from "dotenv";
import { GROQ_MODEL as MODEL } from "./model.js";

dotenv.config();

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

/** PDF file se raw text nikaalo (pdf-parse v2 API). */
export async function extractPdfText(pdfPath) {
  const { PDFParse } = await import("pdf-parse");
  const buf = fs.readFileSync(pdfPath);
  const parser = new PDFParse({ data: buf });
  const r = await parser.getText();
  return (r.text || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

const norm = (arr) =>
  [...new Set((Array.isArray(arr) ? arr : []).map((s) => String(s || "").trim()).filter(Boolean))];

/**
 * CV text ko structured profile me parse karo (Groq JSON mode).
 * @param {string} text - CV ka raw text
 * @returns {Promise<object>} parsed profile (CareerProfile.parsed shape)
 */
export async function parseCvText(text) {
  if (!groq) throw new Error("GROQ_API_KEY set nahi hai — CV parse nahi ho sakti");

  const sys = `Tum ek precise resume parser ho. Diye gaye CV text se structured data nikaalo.
CRITICAL RULE — kuch INVENT mat karo. Sirf wahi likho jo CV me MOJOOD hai. Agar koi field nahi mili to khali/[] chhodo.
Skills ko normalize karo (lowercase, e.g. "React.js" -> "react", "Node.js" -> "node"). Seniority CV ki experience se andaza lagao: intern | junior | mid | senior.
targetRoles: CV ki titles/skills ke hisaab se wo job-roles list karo jinke liye ye candidate apply kar sakta hai (e.g. "Full Stack Developer", "React Developer", "MERN Developer", "Frontend Developer").
keywords: ATS matching ke liye important technical + role keywords (skills + tools + frameworks).`;

  const user = `CV TEXT:
"""
${text.slice(0, 8000)}
"""

Is EXACT JSON shape me return karo:
{
  "fullName": "",
  "title": "",
  "location": "",
  "email": "",
  "phone": "",
  "links": { "GitHub": "", "LinkedIn": "", "Portfolio": "" },
  "summary": "",
  "seniority": "intern|junior|mid|senior",
  "yearsExperience": 0,
  "skills": [],
  "technologies": [],
  "roles": [{ "title": "", "company": "", "duration": "", "mode": "" }],
  "education": [],
  "certifications": [],
  "targetRoles": [],
  "keywords": []
}`;

  const c = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    max_tokens: 4000,              // gpt-oss reasoning tokens + poora JSON — budget bara rakho
    reasoning_effort: "low",       // kam socho, zyada output (JSON truncate na ho)
    response_format: { type: "json_object" },
  });

  let p = {};
  try {
    p = JSON.parse(c.choices[0]?.message?.content || "{}");
  } catch {
    throw new Error("CV parse: AI ne valid JSON nahi diya");
  }

  return {
    fullName: p.fullName || "",
    title: p.title || "",
    location: p.location || "",
    email: p.email || "",
    phone: p.phone || "",
    links: p.links && typeof p.links === "object" ? p.links : {},
    summary: p.summary || "",
    seniority: ["intern", "junior", "mid", "senior"].includes(p.seniority) ? p.seniority : "junior",
    yearsExperience: Number.isFinite(+p.yearsExperience) ? +p.yearsExperience : 0,
    skills: norm(p.skills),
    technologies: norm(p.technologies),
    roles: Array.isArray(p.roles)
      ? p.roles.filter((r) => r && r.title).map((r) => ({
          title: String(r.title || "").slice(0, 120),
          company: String(r.company || "").slice(0, 120),
          duration: String(r.duration || "").slice(0, 60),
          mode: String(r.mode || "").slice(0, 30),
        }))
      : [],
    education: norm(p.education),
    certifications: norm(p.certifications),
    targetRoles: norm(p.targetRoles),
    keywords: norm(p.keywords),
  };
}

/** Convenience: PDF path -> parsed profile. */
export async function parseCvFile(pdfPath) {
  const text = await extractPdfText(pdfPath);
  const parsed = await parseCvText(text);
  return { text, parsed };
}

/* --------------------------------- standalone -------------------------------- */
import { fileURLToPath } from "url";
import { resolve } from "path";
const _norm = (p) => resolve(p).replace(/\\/g, "/").toLowerCase();
if (process.argv[1] && _norm(fileURLToPath(import.meta.url)) === _norm(process.argv[1])) {
  const path = process.argv[2] || "assets/cv.pdf";
  parseCvFile(path)
    .then(({ parsed }) => {
      console.log(JSON.stringify(parsed, null, 2));
      process.exitCode = 0;
    })
    .catch((e) => {
      console.error("❌", e.message);
      process.exitCode = 1;
    });
}
