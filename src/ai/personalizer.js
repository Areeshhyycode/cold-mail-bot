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
  const isWebsite = offer.type === "website";
  const auditNote = (lead.auditReasons || []).join(", ");

  const prompt = `Tum ek expert cold-email copywriter ho. Ek business ke liye email ke PARTS likho.

BUSINESS DETAILS:
- Naam: ${lead.businessName}
- Niche: ${lead.niche}
- Website ka content: ${summary || "(website content nahi mila)"}
${isWebsite ? `- Website ki problem: ${auditNote || "purani / mobile-friendly nahi"}` : ""}

MERE BAARE ME (jo main offer karta hun):
${offer.service}

JSON return karo EXACTLY is format me (sirf English, professional tone, no emojis, no jargon):
{
  "ownerName": "agar website content me kisi owner/founder/CEO ka FIRST name clearly mile to wo, warna empty string \"\". Guess mat karo.",
  "subject": "5-7 word ${isWebsite ? "helpful subject about improving their website" : "professional"} subject line, spammy mat lagao",
  "opener": "1 warm personalized line jo SPECIFICALLY un ke business${isWebsite ? " ki website ki problem (jaise mobile-friendly nahi)" : "/website"} ke baare me ho. Generic 'I came across' mat likho.",
  "intro": "1 line jisme main professionally batau ke main ${isWebsite ? "modern mobile-friendly websites banati hoon" : "full-stack + AI developer hoon"} aur unki kaise help kar sakti hoon"
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
  const services = (offer.serviceList || []).map((s) => `• ${s}`).join("\n");
  const links = Object.entries(offer.links || {}).map(([k, v]) => `${k}: ${v}`);

  let body;
  if (isWebsite) {
    // ---- $5 WEBSITE OFFER ----
    const opener =
      p.opener || `I came across ${lead.businessName} and noticed your website could use a modern, mobile-friendly refresh.`;
    const intro =
      p.intro ||
      `I build clean, mobile-friendly websites for small businesses — and right now I'm offering a professional site for just ${offer.promoPrice} as a promo.`;
    body = [
      greeting,
      "",
      opener,
      "",
      intro,
      "",
      "What you get:",
      "",
      services,
      "",
      "I can even send you a free demo/mockup first, so you can see exactly how your new site would look — no commitment.",
      "",
      "If you're interested, just reply and I'll prepare your free demo.",
      "",
      "Best regards,",
      offer.senderName,
      offer.senderTitle,
      ...(links.length ? ["", ...links] : []),
    ].join("\n");
  } else {
    // ---- DEV / AI SERVICES OFFER ----
    const opener =
      p.opener || `I came across ${lead.businessName} and noticed your work in web development and digital solutions.`;
    const intro =
      p.intro ||
      "I'm a Full-Stack & AI Developer, helping businesses build smarter products and automate workflows using modern AI technologies.";
    body = [
      greeting,
      "",
      opener,
      "",
      intro,
      "",
      "Some areas where I can help include:",
      "",
      services,
      "",
      "If you're exploring AI initiatives or need additional development support, I'd be happy to connect and discuss how I can help.",
      "",
      "Best regards,",
      offer.senderName,
      offer.senderTitle,
      ...(links.length ? ["", ...links] : []),
    ].join("\n");
  }

  return {
    subject: p.subject || `Quick idea for ${lead.businessName}`,
    body,
    ownerName: ownerName === "there" ? "" : ownerName,
  };
}
