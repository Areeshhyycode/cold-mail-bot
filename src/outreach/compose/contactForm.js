/**
 * PHASE 6 — CONTACT FORM GENERATOR.
 *
 * Jab website pe contact form ho par bharosemand email na ho. Message ki LENGTH
 * form ke fields ke hisaab se adapt hoti hai:
 *   - agar form me sirf ek chhota message box hai → short pitch
 *   - bara textarea → thoda tafseeli
 *
 * ⚠️ Draft-only. Playwright se auto-submit NAHI (user ne "draft only, manual
 * submit" choose kiya). Output me form URL + fields hote hain taake tum khud
 * kholke paste kar sako. formFields me har detected field ke against value.
 */
import { askJSON, PROMPT_VERSION } from "../ai.js";
import { toneGuide, DEFAULT_TONE } from "./tones.js";
import { getOffer } from "../../ai/offers.js";

const FROM_NAME = process.env.SENDER_NAME || "Areesha Rafiq";
const FROM_EMAIL = process.env.SMTP_USER || "";

/**
 * @param {object} lead
 * @param {object} research - contactFormUrl + contactFormFields yahan se
 * @param {object} [opts] - { tone }
 */
export async function composeContactForm(lead, research, opts = {}) {
  const tone = opts.tone || DEFAULT_TONE;
  const offer = opts.offer || getOffer();
  const fields = research?.contactFormFields || [];
  const url = research?.contactFormUrl || research?.website || "";
  const name = research?.businessName || lead.businessName || "";
  const industry = research?.industry || lead.niche || "";
  const angle = research?.aiAngle || "";

  // form kitna bara message allow karta hai (heuristic) — length adapt
  const hasBigTextarea = fields.some((f) => /message|comment|detail|description|project/i.test(f));
  const lengthGuide = hasBigTextarea
    ? "3-5 sentences — thoda tafseel se, value clear karo."
    : "2-3 short sentences — form chhota hai, concise raho.";

  const prompt = `Tum ek digital agency ki taraf se ek business ke CONTACT FORM me message likh rahi ho.
TONE: ${toneGuide(tone)}
LENGTH: ${lengthGuide}

BUSINESS:
- Naam: ${name || "(pata nahi)"}
- Industry: ${industry || "(pata nahi)"}
- Pitch angle: ${angle || "online presence behtar karna"}

Rules:
- Contact form message hai — koi subject line body me mat likho, koi email signature nahi (form ke apne fields hain).
- Personalized, business ka naam use karo.
- Ek clear halka CTA (reply / short call).
- Spammy bilkul nahi.

SIRF JSON: { "message": "..." }`;

  let parsed = {};
  try {
    parsed = await askJSON(prompt, { temperature: 0.7, maxTokens: 400 });
  } catch {
    parsed = {};
  }

  let message = (parsed.message || "").trim();
  if (!message) {
    message = `Hi, I'm ${FROM_NAME} from ${offer.senderTitle}. I help ${
      industry || "businesses"
    } strengthen their online presence — website, SEO and social. I had a couple of specific ideas for ${
      name || "your business"
    } and would love to share them. Could we connect briefly?`;
  }

  // form fields ke against values map karo (Phase 6 — "adapt to available fields")
  const formFields = mapToFields(fields, { message, name: FROM_NAME, email: FROM_EMAIL });

  return {
    message,
    formUrl: url,
    formFields,
    tone,
    promptVersion: PROMPT_VERSION,
  };
}

/** detected field names ko humari values se match karo (best-effort) */
function mapToFields(fields, vals) {
  const out = {};
  for (const raw of fields) {
    const f = raw.toLowerCase();
    if (/e-?mail/.test(f)) out[raw] = vals.email;
    else if (/phone|mobile|tel|contact.?number/.test(f)) out[raw] = process.env.SENDER_PHONE || "";
    else if (/name/.test(f)) out[raw] = vals.name;
    else if (/subject|title/.test(f)) out[raw] = "Improving your online presence";
    else if (/message|comment|detail|description|project|enquir|inquir/.test(f)) out[raw] = vals.message;
    else if (/company|business|organi/.test(f)) out[raw] = process.env.SENDER_TITLE || "AriLabs";
    else if (/website|url/.test(f)) out[raw] = (getOffer().links || {}).Portfolio || "";
    else out[raw] = ""; // pata nahi — tum bhar dena
  }
  // agar koi message field pehchaana hi na gaya, message ko top-level pe rakho
  if (!Object.values(out).includes(vals.message)) out._message = vals.message;
  return out;
}
