import Groq from "groq-sdk";
import dotenv from "dotenv";

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

/**
 * JOB lead ke liye personalized job-application email banata hai.
 *
 * Do case handle karta hai:
 *   1. SPECIFIC posting  -> lead.jobTitle / jobDescription mojood -> us role ke liye tailored
 *   2. SPECULATIVE       -> jobTitle nahi (e.g. Karachi software house) -> "koi opening ho to
 *      mujhe consider karein" wali professional speculative application
 *
 * CV attachment sender (mailer.js) add karta hai; yahan sirf portfolio/GitHub/LinkedIn
 * links body me jaate hain aur "CV attached" line.
 *
 * @param {object} lead    - { company|businessName, jobTitle, jobDescription }
 * @param {object} profile - profile.js ka PROFILE
 * @returns {Promise<{subject, body}>}
 */
export async function generateJobEmail(lead, profile) {
  const company = lead.company || lead.businessName || "your company";
  const jobTitle = (lead.jobTitle || "").trim();
  const jd = (lead.jobDescription || "").trim();
  const speculative = !jobTitle;

  const prompt = `Tum ek professional job applicant ke liye concise application email likhti ho.

APPLICANT:
- Naam: ${profile.name}
- Title: ${profile.title}
- Location: ${profile.location}
- Summary: ${profile.summary}
- Skills: ${profile.skills.join(", ")}
- Highlights: ${profile.highlights.join(" | ")}

ROLE/COMPANY:
- Company: ${company}
- Position: ${jobTitle || "(no specific role advertised — speculative application)"}
- Job description / context: ${jd || "(none provided)"}

${
  speculative
    ? `Ye ek SPECULATIVE application hai (company ne specific role advertise nahi kiya). Tone: respectful, batao ke applicant in roles me interested hai aur agar koi opening ho to consider kiya jaye. Pushy mat lagao.`
    : `Ye ek SPECIFIC role ke liye application hai. Applicant ki skills ko role ke requirements se naturally connect karo.`
}

JSON return karo EXACTLY is format me. English only, professional & confident (over-selling nahi), no emojis, no fake claims, no buzzword spam:
{
  "subject": "${
    speculative
      ? `6-10 word subject jaisa: "Full Stack Developer interested in opportunities at ${company}"`
      : `6-10 word subject jaisa: "Application for ${jobTitle} — ${profile.name}"`
  }. Spammy mat lagao.",
  "opener": "1-2 lines: ${
    speculative
      ? `politely batao ke applicant ${company} ki team me ek developer role ke liye interested hai`
      : `batao ke applicant ${jobTitle} role ke liye apply kar raha hai aur kyun interest hai`
  }. Generic 'To whom it may concern' avoid karo.",
  "fit": "2-3 sentences: applicant ki MERN/Next.js full-stack experience ko ${
    speculative ? "ek developer role" : "is role ke requirements"
  } se connect karo. Specific raho, ${jd ? "job description ke keywords use karo" : "general full-stack strengths highlight karo"}. Honest raho.",
  "bullets": ["2-3 short bullet points: applicant ki sabse relevant achievements/skills is role ke liye. Har bullet 1 line, concrete."]
}`;

  let p = {};
  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.6,
      response_format: { type: "json_object" },
    });
    p = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    p = {};
  }

  const subject =
    (p.subject || "").trim() ||
    (speculative
      ? `${profile.title} interested in opportunities at ${company}`
      : `Application for ${jobTitle} — ${profile.name}`);

  const opener =
    (p.opener || "").trim() ||
    (speculative
      ? `I'm reaching out because I'd love the opportunity to join ${company} as a developer. I'm a ${profile.title} and a big admirer of the work teams like yours do.`
      : `I'm writing to apply for the ${jobTitle} role at ${company}. As a ${profile.title}, the position lines up closely with my experience.`);

  const fit =
    (p.fit || "").trim() ||
    `${profile.summary} I'd be excited to bring that experience to ${company}.`;

  const bullets =
    Array.isArray(p.bullets) && p.bullets.length ? p.bullets : profile.highlights;
  const bulletBlock = bullets.map((b) => `• ${b}`).join("\n");

  const links = Object.entries(profile.links).map(([k, v]) => `${k}: ${v}`);

  const body = [
    `Hi ${company} team,`,
    "",
    opener,
    "",
    fit,
    "",
    "A few highlights:",
    "",
    bulletBlock,
    "",
    "I've attached my CV, and you can see my work here:",
    ...links,
    "",
    speculative
      ? `If you have any openings that could be a fit — now or in the future — I'd be grateful to be considered.`
      : `I'd welcome the chance to discuss how I can contribute to your team.`,
    "",
    "Best regards,",
    profile.name,
    profile.title,
  ].join("\n");

  return { subject, body };
}
