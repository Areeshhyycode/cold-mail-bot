/**
 * PHASE 5 — WHATSAPP GENERATOR.
 *
 * Sirf tab jab phone/WhatsApp number ho aur email na ho (channel decide.js se aata
 * hai). Requirements: Friendly · Short · Non-spammy · Personalized · Clear CTA.
 *
 * ⚠️ KABHI khud-ba-khud nahi bhejta. Ye sirf DRAFT + wa.me deep link banata hai.
 * Tum dashboard me review karke, link click karke, khud bhejte ho. (User ki
 * explicit requirement — aur WhatsApp ToS ke bhi mutabiq.)
 *
 * wa.me link: https://wa.me/<number>?text=<url-encoded message>
 */
import { askJSON, PROMPT_VERSION } from "../ai.js";
import { toneGuide } from "./tones.js";
import { getOffer } from "../../ai/offers.js";

/**
 * @param {object} lead
 * @param {object} research
 * @param {string} waNumber - E.164 digits ("923001234567") — decide.js se
 * @param {object} [opts] - { tone }
 * @returns {Promise<{message:string, waLink:string, promptVersion:string, tone:string}>}
 */
export async function composeWhatsApp(lead, research, waNumber, opts = {}) {
  const tone = opts.tone || "friendly"; // WhatsApp pe friendly best chalta hai
  const offer = opts.offer || getOffer();
  const name = research?.businessName || lead.businessName || lead.company || "";
  const industry = research?.industry || lead.niche || "";
  const area = research?.location || lead.city || "";
  const angle = research?.aiAngle || "";

  const prompt = `Tum ek friendly digital-agency owner ho jo WhatsApp pe ek local business ko pehli baar message kar rahi ho.
TONE: ${toneGuide(tone)}

BUSINESS (research se — sirf ye facts):
- Naam: ${name || "(pata nahi)"}
- Industry: ${industry || "(pata nahi)"}
- Area: ${area || "(pata nahi)"}
- Pitch angle: ${angle || "(website/online presence behtar bana sakte hain)"}

Ek SHORT WhatsApp message likho. Rules:
- 2-4 short sentences, MAX ~350 characters. WhatsApp hai, email nahi.
- Friendly aur insaani — koi corporate jargon, koi bullet points, koi links spam nahi.
- Business ka naam use karo, ek specific personalized cheez mention karo.
- Ek clear, halka CTA (jaise "kya main aapko 2-3 ideas bhej sakti hoon?").
- Bilkul spammy/mass-message jaisa na lage.
- English (ya halka Roman-Urdu mix agar natural lage). No emoji spam — max 1.

SIRF JSON: { "message": "..." }`;

  let parsed = {};
  try {
    parsed = await askJSON(prompt, { temperature: 0.8, maxTokens: 300 });
  } catch {
    parsed = {};
  }

  let message = (parsed.message || "").trim();
  if (!message) {
    message = `Hi${name ? ` ${name}` : ""}! I'm ${offer.senderName} from ${offer.senderTitle}. I help ${
      industry || "local businesses"
    } get a stronger online presence — modern website, better Google visibility, and more inquiries. Could I share 2–3 quick ideas for ${name || "your business"}?`;
  }
  // hard cap — koi hallucinated novel na aa jaye
  if (message.length > 500) message = message.slice(0, 497) + "…";

  return {
    message,
    waLink: `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`,
    tone,
    promptVersion: PROMPT_VERSION,
  };
}
