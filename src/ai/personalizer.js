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
 * Ek lead ke liye "digital presence" agency cold email banata hai.
 * Structure: Opening -> what I noticed -> how we can help -> competitor example
 *            -> why it matters -> closing.
 * @param {object} lead  - { businessName, website, ownerName, niche, auditReasons }
 * @param {object} offer - agency offer (offers.js)
 * @returns {Promise<{subject, body, ownerName}>}
 */
export async function generateEmail(lead, offer) {
  const summary = await fetchSiteSummary(lead.website);
  const auditNote = (lead.auditReasons || []).join(", ");

  const prompt = `Tum ek expert B2B cold-email copywriter ho jo ek digital agency ke liye likhti ho.
Agency offer karti hai: ${offer.service}

BUSINESS DETAILS:
- Naam: ${lead.businessName}
- Industry/Niche: ${lead.niche}
- Website content: ${summary || "(website content nahi mila)"}
- Website ki known problems: ${auditNote || "(audit note nahi — guess mat karo, generic raho)"}

JSON return karo EXACTLY is format me. Sirf English, professional & warm tone, no emojis, no hype, no fake claims:
{
  "ownerName": "agar website content me kisi owner/founder/CEO/manager ka FIRST name clearly mile to wahi, warna empty string \"\". Guess mat karo.",
  "subject": "6-9 word subject line jaisa: Improve <Company>'s Online Presence & Lead Generation. Spammy mat lagao.",
  "industryPhrase": "2-5 word phrase jo batata hai yeh business kya karta hai (e.g. 'inspection services across oil & gas and renewables', 'dental care'). Unke website content se infer karo.",
  "opener": "1-2 lines: maine <Company> ko notice kiya aur yeh strong/reliable <industryPhrase> provide karte hain — lekin unki online presence usi level ki professionalism reflect nahi karti. Personalized rakho, generic 'I came across' avoid karo.",
  "positive": "agar website content me koi GENUINE strength dikhe (jaise acchi SEO ranking, active LinkedIn/social, clear services) to 1 warm line usko acknowledge karte hue. Sirf tab likho jab sach me dikhe — warna empty string \"\". Fake tareef mat karo.",
  "observations": ["2-3 short specific points jo unki digital presence me kamzori dikhayein — jaise outdated website design, weak Google/SEO visibility, limited social media/LinkedIn presence, ya site pe koi visible issue. Jo audit note diya hai usse align karo. Har point 1 line, soft tone (insult mat karo)."],
  "competitor": "1-2 lines ka SOFT example: unke industry me leading firms ki tarah jo Google pe top rank karti hain aur modern websites rakhti hain. Agar tum is niche/area ka ek REAL, well-known competitor jaante ho to naam le sakti ho, warna generic raho. KABHI fake company naam ya fake URL invent mat karo."
}
Har field concise aur professional rakho.`;

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

  // owner name: pehle scrape se mila, warna AI ne dhoonda, warna "there"
  const ownerName = lead.ownerName || (p.ownerName || "").trim() || "there";
  const greeting = `Hi ${ownerName},`;

  const industryPhrase = (p.industryPhrase || "").trim() || `quality ${lead.niche || "services"}`;

  const opener =
    (p.opener || "").trim() ||
    `I recently came across ${lead.businessName} and could see you provide strong, reliable ${industryPhrase}. Your expertise is clear — but your online presence doesn't yet reflect the same level of professionalism and trust.`;

  // optional: ek genuine strength acknowledge karo (warm-up), agar AI ne di ho
  const positive = (p.positive || "").trim();

  // "what I noticed" bullets — AI ke observations, warna safe defaults
  const observations =
    Array.isArray(p.observations) && p.observations.length
      ? p.observations
      : [
          "Your website design feels a little dated and may not create a strong first impression.",
          "Your business can be hard to find on Google, so potential clients may see competitors first.",
          "There's room to grow your presence on LinkedIn and social media.",
        ];
  const noticed = observations.map((o) => `• ${o}`).join("\n");

  // "how we can help" bullets (offer se)
  const help = (offer.serviceList || []).map((s) => `• ${s}`).join("\n");

  // competitor example (AI), warna generic soft line
  const competitor =
    (p.competitor || "").trim() ||
    `For example, the leading names in your space tend to rank at the top of Google and run modern, polished websites — and that visibility directly drives their lead generation.`;

  // "why this matters" bullets (offer se)
  const why = (offer.benefits || []).map((s) => `• ${s}`).join("\n");

  const links = Object.entries(offer.links || {}).map(([k, v]) => `${k}: ${v}`);

  const body = [
    greeting,
    "",
    opener,
    ...(positive ? ["", positive] : []),
    "",
    "Here's what I noticed:",
    "",
    noticed,
    "",
    "How we can help:",
    "",
    help,
    "",
    competitor,
    "",
    "Why this matters — a stronger online presence can help you:",
    "",
    why,
    "",
    `If you're open to it, I'd be happy to walk you through a few specific ideas for ${lead.businessName}'s website, SEO, and digital presence. It would only take a few minutes.`,
    "",
    "Best regards,",
    offer.senderName,
    offer.senderTitle,
    ...(links.length ? ["", ...links] : []),
  ].join("\n");

  return {
    subject: (p.subject || "").trim() || `Improve ${lead.businessName}'s Online Presence & Lead Generation`,
    body,
    ownerName: ownerName === "there" ? "" : ownerName,
  };
}
