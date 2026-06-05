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

  const prompt = `Tum ek expert cold-email copywriter ho. Ek business ke liye email ke PARTS likho.

BUSINESS DETAILS:
- Naam: ${lead.businessName}
- Niche: ${lead.niche}
- Website ka content: ${summary || "(website content nahi mila)"}

MERE BAARE ME (jo main offer karta hun):
${offer.service}

JSON return karo EXACTLY is format me (sirf English, professional tone, no emojis, no jargon):
{
  "ownerName": "agar website content me kisi owner/founder/CEO ka FIRST name clearly mile to wo, warna empty string \"\". Guess mat karo.",
  "subject": "5-7 word professional subject line, salesy/spammy mat lagao",
  "opener": "1 warm personalized line jo SPECIFICALLY un ke business/website ke baare me ho — dikhaye maine dekha hai. Generic 'I came across' mat likho.",
  "intro": "1 line jisme main professionally introduce karoon ke main kya karti hun (full-stack + AI developer) aur unke business ko kaise help kar sakti hun"
}
Har field short rakho aur professional. No fake claims.`;

  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content || "{}";
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    p = {};
  }

  // owner name: pehle scrape se mila, warna AI ne dhoondha, warna "there"
  const ownerName = lead.ownerName || (p.ownerName || "").trim() || "there";
  const greeting = `Hi ${ownerName},`;
  const opener = p.opener || `I recently came across ${lead.businessName} and was impressed by your work.`;
  const intro =
    p.intro ||
    "I'm a full-stack and AI developer, and I help businesses build modern web/mobile apps and AI automation.";

  // services ki bullet list
  const services = (offer.serviceList || []).map((s) => `  • ${s}`).join("\n");

  // professional body — services list + clear "if interested, contact" CTA
  const body = [
    greeting,
    "",
    opener,
    "",
    intro,
    "",
    "Here are a few things I can help you with:",
    services,
    "",
    "If any of this sounds useful for your business, I'd love to connect — just reply to this email and we can take it from there.",
    "",
    "Best regards,",
    offer.senderName,
    offer.senderTitle,
  ].join("\n");

  return {
    subject: p.subject || `Quick idea for ${lead.businessName}`,
    body,
    ownerName: ownerName === "there" ? "" : ownerName,
  };
}
