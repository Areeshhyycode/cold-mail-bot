/**
 * SOCIAL DM GENERATOR — LinkedIn / Facebook Messenger / Instagram DM.
 *
 * Sirf tab jab email/form/WhatsApp na ho magar social page mila ho. Har platform
 * ki alag mizaaj (LinkedIn professional, IG casual). Sab DRAFT-only — auto-send
 * ka koi sawaal hi nahi (in platforms pe automation ban karwa deta hai).
 *
 * Output me profile URL hota hai taake tum khud kholke paste kar sako.
 */
import { askJSON, PROMPT_VERSION } from "../ai.js";
import { toneGuide } from "./tones.js";
import { getOffer } from "../../ai/offers.js";

const PLATFORM = {
  linkedin: { tone: "professional", limit: 300, note: "LinkedIn connection note — professional, 300 char se kam." },
  facebook: { tone: "friendly", limit: 500, note: "Facebook Messenger — friendly aur approachable." },
  instagram: { tone: "casual", limit: 400, note: "Instagram DM — casual aur short, halka." },
};

/**
 * @param {string} channel - "linkedin" | "facebook" | "instagram"
 * @param {object} lead
 * @param {object} research
 * @param {string} profileUrl - decide.js se (research.socials[channel])
 */
export async function composeSocial(channel, lead, research, profileUrl, opts = {}) {
  const cfg = PLATFORM[channel] || PLATFORM.linkedin;
  const tone = opts.tone || cfg.tone;
  const offer = opts.offer || getOffer();
  const name = research?.businessName || lead.businessName || "";
  const industry = research?.industry || lead.niche || "";
  const angle = research?.aiAngle || "";

  const prompt = `Tum ek digital agency owner ho jo ${channel} pe ek business ko pehli baar message kar rahi ho.
PLATFORM: ${cfg.note}
TONE: ${toneGuide(tone)}

BUSINESS:
- Naam: ${name || "(pata nahi)"}
- Industry: ${industry || "(pata nahi)"}
- Angle: ${angle || "online presence behtar karna"}

Rules:
- ${cfg.limit} character se kam.
- Personalized, business ka naam.
- Ek halka CTA.
- Spammy/mass bilkul nahi. Koi links ka dher nahi.

SIRF JSON: { "message": "..." }`;

  let parsed = {};
  try {
    parsed = await askJSON(prompt, { temperature: 0.8, maxTokens: 300 });
  } catch {
    parsed = {};
  }

  let message = (parsed.message || "").trim();
  if (!message) {
    message = `Hi${name ? ` ${name}` : ""}! I'm ${offer.senderName} — I help ${
      industry || "businesses"
    } grow their online presence. I had a couple of quick ideas for you; mind if I share them?`;
  }
  if (message.length > cfg.limit) message = message.slice(0, cfg.limit - 1) + "…";

  return { message, profileUrl, tone, promptVersion: PROMPT_VERSION };
}
