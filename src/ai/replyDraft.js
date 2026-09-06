/**
 * REPLY AUTO-DRAFT — jab koi tumhari cold email ka jawab de, AI ek professional
 * response draft kar deta hai (tumhari taraf se, first person). Tum sirf review
 * karke bhejti ho — auto-send NAHI hota.
 *
 * KYUN: pehle replyChecker sirf status "replied" mark karta tha — reply ka mauqa
 * zaya hota tha (jawab dene me der ya bhool). Ab har reply ke saath ek ready
 * draft hota hai jo notification + dashboard me dikhta hai.
 *
 * JOB reply aur SERVICE reply alag handle hote hain:
 *   JOB     -> recruiter/HR ka jawab (interview offer, availability, questions)
 *   SERVICE -> business ka jawab (pricing, scope, interest)
 */
import Groq from "groq-sdk";
import dotenv from "dotenv";
import { GROQ_MODEL as MODEL } from "./model.js";
import { PROFILE } from "./profile.js";

dotenv.config();

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

/** incoming email body se quoted history / signatures / footers hata do */
export function cleanReplyText(raw = "") {
  let t = String(raw);
  // common reply separators pe kaato (quoted original niche hota hai)
  t = t
    .split(/^\s*On .+ wrote:/m)[0]
    .split(/^-{2,}\s*Original Message\s*-{2,}/mi)[0]
    .split(/^_{5,}/m)[0]
    .split(/^From:\s.+$/m)[0]
    .replace(/^>.*$/gm, "")           // quoted lines
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t.slice(0, 2000);
}

/**
 * Reply ka AI draft banao.
 * @param {object} lead - { leadType, company, businessName, jobTitle, subject }
 * @param {string} replyText - unka (cleaned) reply
 * @returns {Promise<string>} suggested response (plain text) — fail ho to ""
 */
export async function draftReply(lead = {}, replyText = "") {
  if (!groq) return "";
  const isJob = lead.leadType === "JOB";
  const who = lead.company || lead.businessName || "them";
  const role = lead.jobTitle ? ` for the ${lead.jobTitle} role` : "";

  const sys = isJob
    ? `Tum ${PROFILE.name} ho — ek ${PROFILE.title} (${PROFILE.location}). Ek recruiter/HR ne tumhari job application ka jawab diya hai. Unke reply ka ek professional, warm, concise response likho (first person, "I"). Rules:
- Interview/call offer ho -> enthusiastically accept, availability do ("weekdays, immediately available, flexible on time").
- Sawaal poochhein (experience, notice period, salary) -> honestly answer: ~1 year experience (junior), immediately available, salary "negotiable / as per company standards".
- Portfolio/CV maangein -> links do: ${PROFILE.links.Portfolio} , GitHub ${PROFILE.links.GitHub}.
- Jhooti baat/experience kabhi mat banao. No markdown, no emojis, no preamble. 3-6 sentences. Signature ke saath khatam karo (naam + title).`
    : `Tum ${PROFILE.name} ho — ek web developer/agency. Ek business ne tumhari service outreach ka jawab diya. Professional, helpful, concise response likho (first person). Rules:
- Interest dikhायein -> next step propose karo (short call / requirements samajhna).
- Pricing poochhein -> range do but pehle scope samajhne ki baat karo.
- Not interested -> politely thank karo, door khula rakho.
- No markdown, no emojis, no preamble. 3-6 sentences. Signature ke saath khatam.`;

  const user = `CONTEXT:
- Unka naam/company: ${who}
- Tumhari original email ka subject: ${lead.subject || "(cold outreach)"}${role}

UNKA REPLY:
"""
${replyText.slice(0, 1500)}
"""

Ab unke reply ka jawab likho (plain text, ready to send):`;

  try {
    const c = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      temperature: 0.5,
      max_tokens: 500,
    });
    return (c.choices[0]?.message?.content || "").trim();
  } catch (e) {
    return "";
  }
}
