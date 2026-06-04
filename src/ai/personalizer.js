import Groq from "groq-sdk";
import dotenv from "dotenv";
import * as cheerio from "cheerio";

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

// website ka thoda text nikalo taaki AI ko context mile
async function fetchSiteSummary(website) {
  if (!website) return "";
  try {
    const res = await fetch(website, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return "";
    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, noscript").remove();
    const title = $("title").text();
    const desc = $('meta[name="description"]').attr("content") || "";
    const h1 = $("h1").first().text();
    const bodyText = $("body").text().replace(/\s+/g, " ").slice(0, 600);
    return `Title: ${title}\nDescription: ${desc}\nHeading: ${h1}\nContent: ${bodyText}`;
  } catch {
    return "";
  }
}

/**
 * Ek lead ke liye personalized cold email banata hai.
 * @param {object} lead - { businessName, website, ownerName, niche }
 * @param {object} offer - { service, senderName, senderTitle }
 * @returns {Promise<{subject, body}>}
 */
export async function generateEmail(lead, offer) {
  const summary = await fetchSiteSummary(lead.website);

  const prompt = `Tum ek expert cold-email copywriter ho. Ek SHORT, personalized cold email likho.

BUSINESS DETAILS:
- Naam: ${lead.businessName}
- Niche: ${lead.niche}
- Website ka content: ${summary || "(website content nahi mila)"}

MERI SERVICE (jo main bech raha hun):
- ${offer.service}

RULES:
- Pehli line PERSONALIZED ho — dikhaye maine unki website/business dekha hai. Generic mat likho.
- Total 60-90 words. Short rakho.
- Casual, human tone. Corporate jargon mat use karo.
- Ek clear soft CTA (jaise "15 min call?" ya "interested ho to reply karo").
- NO emojis. NO "Dear Sir/Madam".
- Sirf JSON return karo is format me: {"subject": "...", "body": "..."}
- Body me greeting "Hi ${lead.ownerName || "there"}," se shuru karo aur "${offer.senderName}\n${offer.senderTitle}" se khatam.`;

  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { subject: `Quick idea for ${lead.businessName}`, body: raw };
  }

  return {
    subject: parsed.subject || `Quick idea for ${lead.businessName}`,
    body: parsed.body || "",
  };
}
