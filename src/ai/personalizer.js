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

MERI SERVICE (jo main bech raha hun):
- ${offer.service}

JSON return karo EXACTLY is format me (sirf English, no emojis, no jargon):
{
  "subject": "5-7 word curiosity subject line, salesy mat lagao",
  "opener": "1 personalized line jo SPECIFICALLY un ke business/website ke baare me ho — dikhaye maine dekha hai. Generic 'I came across' mat likho.",
  "pitch": "1-2 line jisme meri service ka clear benefit ho un ke liye",
  "cta": "1 short soft question, jaise 'Worth a quick 15-min call?'"
}
Har field short rakho. Total email 60 words se kam.`;

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

  const greeting = `Hi ${lead.ownerName || "there"},`;
  const opener = p.opener || `I came across ${lead.businessName} and was impressed.`;
  const pitch = p.pitch || offer.service;
  const cta = p.cta || "Worth a quick 15-min call?";

  // body khud assemble karo — proper line breaks guaranteed
  const body = [
    greeting,
    "",
    opener,
    "",
    pitch,
    "",
    cta,
    "",
    "Best,",
    offer.senderName,
    offer.senderTitle,
  ].join("\n");

  return {
    subject: p.subject || `Quick idea for ${lead.businessName}`,
    body,
  };
}
