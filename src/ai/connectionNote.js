/**
 * LINKEDIN CONNECTION NOTE — ek recruiter/HR ke liye chhota personalized note.
 *
 * ~200 chars (LinkedIn connection-request note ki limit ~300, par short better).
 * Consider karta hai: job applied for, company, person ka role, tumhari relevant
 * skills (CV se), career profile.
 *
 * COMPLIANCE: ye sirf note ka TEXT banata hai. Bhejna user khud karta hai
 * (dashboard se copy -> LinkedIn pe paste). Koi auto-send NAHI.
 */
import Groq from "groq-sdk";
import dotenv from "dotenv";
import { GROQ_MODEL as MODEL } from "./model.js";

dotenv.config();

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

const firstName = (full = "") => String(full).trim().split(/\s+/)[0] || "there";

/**
 * @param {object} opts
 * @param {object} opts.person   - { name, role }
 * @param {string} opts.company  - company name
 * @param {string} opts.jobTitle - jis role ke liye apply kiya (ya interested)
 * @param {object} opts.profile  - getMatchProfile() output (skills, name, title)
 * @param {number} [opts.maxLen=200]
 * @returns {Promise<string>}
 */
export async function generateConnectionNote(opts = {}) {
  const { person = {}, company = "", jobTitle = "", profile = {}, maxLen = 200 } = opts;
  const fn = firstName(person.name);
  const topSkills = (profile.skills || []).slice(0, 3).join(", ");
  const myName = firstName(profile.fullName || profile.name || "");

  // fallback (AI off / fail) — deterministic, still personalized
  const fallback = jobTitle
    ? `Hi ${fn}, I recently applied for the ${jobTitle} role at ${company}. My experience with ${topSkills || "full-stack development"} lines up well with it — would love to connect!`
    : `Hi ${fn}, I'm a ${profile.title || "developer"} keen on opportunities at ${company}. My work with ${topSkills || "modern web tech"} could be a fit — would love to connect!`;

  if (!groq) return clamp(fallback, maxLen);

  const sys = `Tum ek job candidate ke liye LinkedIn CONNECTION-REQUEST note likhti ho. Rules:
- ${maxLen} characters se kam. Ek short paragraph, warm + professional, first person ("I").
- Person ke role ka lihaaz karo (recruiter/HR/hiring manager/engineering manager).
- 2-3 relevant skills naturally mention karo. Job/company specific raho.
- No emojis, no hashtags, no markdown, no "Dear Sir/Madam". Greeting: "Hi <first name>,".
- Jhoot mat likho. Sirf candidate ki real skills.`;

  const user = `CANDIDATE: ${profile.fullName || profile.name || "a developer"} — ${profile.title || ""}. Skills: ${(profile.skills || []).slice(0, 8).join(", ")}.
PERSON: ${person.name || "recruiter"} — ${person.role || "recruiter"} at ${company}.
ROLE APPLIED/INTERESTED: ${jobTitle || "(open to relevant roles)"}.

Ek connection note likho (${maxLen} chars se kam, sirf note text):`;

  try {
    const c = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      temperature: 0.6,
      max_tokens: 300,
      reasoning_effort: "low",
    });
    let note = (c.choices[0]?.message?.content || "").trim().replace(/^["']|["']$/g, "");
    if (!note) note = fallback;
    return clamp(note, maxLen);
  } catch {
    return clamp(fallback, maxLen);
  }
}

/** note ko maxLen tak clamp karo (word boundary pe, "…" ke saath). */
function clamp(s, maxLen) {
  const t = String(s).replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  const cut = t.slice(0, maxLen - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + "…";
}
