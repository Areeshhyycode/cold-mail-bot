/**
 * PHASE 4 — EMAIL GENERATOR.
 *
 * Har email ke liye 5 first-class fields banata hai:
 *   subject · previewText · body · cta · signature
 * (pehle sirf subject+body the — preview/cta/signature body me gh_le hue the).
 *
 * Phase 3 personalization: research se aaya business-specific data prompt me jata
 * hai — naam, industry, area, website ki khaas problem, presence gaps, positive
 * point. "Generic" email is design me mumkin hi nahi — data available hi mention
 * hota hai.
 *
 * A/B: `variants` count ke hisaab se AI se utni alag subject+opener deta hai
 * (structure same, angle alag) — Message.variant "A"/"B"/"C" ban jate hain.
 *
 * ⚠️ Ye purane personalizer.js/jobEmail.js ko REPLACE nahi karta — un ke saath
 * chalta hai. Purana `npm run personalize` Lead.subject/body likhta rehta hai;
 * ye Message docs banata hai. Dono ka data alag jagah, koi takraav nahi.
 */
import { askJSON, PROMPT_VERSION } from "../ai.js";
import { toneGuide, DEFAULT_TONE } from "./tones.js";
import { getOffer } from "../../ai/offers.js";

const VARIANT_IDS = ["A", "B", "C"];

/**
 * @param {object} lead     - Lead doc
 * @param {object} research - Research doc (Phase 2)
 * @param {object} [opts]   - { tone, variants (1-3), offer }
 * @returns {Promise<Array>} har element ek Message ka draft-content:
 *   { variant, tone, subject, previewText, body, cta, signature, promptVersion }
 */
export async function composeEmail(lead, research, opts = {}) {
  const tone = opts.tone || DEFAULT_TONE;
  const count = Math.max(1, Math.min(3, opts.variants || 1));
  const offer = opts.offer || getOffer();

  const name = research?.businessName || lead.businessName || lead.company || "your business";
  const owner = (lead.ownerName || "").trim();
  const industry = research?.industry || lead.niche || "";
  const area = research?.location || lead.city || lead.location || "";
  const gaps = (research?.presenceGaps || []).slice(0, 3);
  const auditReasons = (research?.auditReasons || []).slice(0, 3);
  const angle = research?.aiAngle || "";
  const summary = research?.aiSummary || "";

  const prompt = `Tum ek expert B2B cold-email copywriter ho jo ek digital agency ke liye likhti ho.
Agency offer: ${offer.service}

TONE: ${toneGuide(tone)}

BUSINESS (research se — SIRF ye facts use karo, kuch invent mat karo):
- Naam: ${name}
- Owner ka naam (agar mila): ${owner || "(nahi mila — 'there' use karo)"}
- Industry: ${industry || "(pata nahi)"}
- Area/Location: ${area || "(pata nahi)"}
- Business summary: ${summary || "(nahi)"}
- Website ki known problems: ${auditReasons.join(", ") || "(koi note nahi — is bare me guess mat karo)"}
- Online presence ki kamiyan: ${gaps.join(", ") || "(koi note nahi)"}
- Best pitch angle: ${angle || "(nahi)"}

${count} alag email VARIANT likho A/B testing ke liye. Har variant ka angle/subject ALAG ho magar sab professional aur non-spammy hon. SIRF JSON return karo:
{
  "variants": [
    {
      "subject": "6-9 word, specific, is business ke liye. Spammy/clickbait nahi. '${name}' mention kar sakti ho.",
      "previewText": "35-90 char ki inbox preview line jo subject ko extend kare (dobara na kahe). Curiosity + value.",
      "opener": "1-2 line personal opener jo is business ki KHAAS baat (industry/area/summary) ko mention kare. 'I came across your website' jaisa generic bilkul nahi.",
      "observation": "1 line: unki online presence ki ek specific kami jo hum theek kar sakte hain (audit/gaps se align). Narmi se, insult nahi.",
      "cta": "1 line ka soft call-to-action — ek chhoti call ya reply maangna. Pushy nahi."
    }
  ]
}
Bilkul ${count} variant do. Har field concise.`;

  let parsed = {};
  try {
    parsed = await askJSON(prompt, { temperature: 0.8, maxTokens: 1100 });
  } catch {
    parsed = {};
  }

  const aiVariants = Array.isArray(parsed.variants) ? parsed.variants : [];
  const out = [];

  for (let i = 0; i < count; i++) {
    const v = aiVariants[i] || aiVariants[0] || {};
    const greeting = `Hi ${owner || "there"},`;
    const opener =
      (v.opener || "").trim() ||
      `I came across ${name}${industry ? ` and could see you work in ${industry}` : ""}. Your work stands out — but your online presence doesn't yet reflect the same quality.`;
    const observation = (v.observation || "").trim();
    const help = (offer.serviceList || []).slice(0, 4).map((s) => `• ${s}`).join("\n");
    const cta =
      (v.cta || "").trim() ||
      `If you're open to it, I'd love to share a couple of specific ideas for ${name} — it would only take a few minutes.`;
    const signature = buildSignature(offer);

    const body = [
      greeting,
      "",
      opener,
      ...(observation ? ["", observation] : []),
      "",
      "How we can help:",
      "",
      help,
      "",
      cta,
      "",
      signature,
    ].join("\n");

    out.push({
      variant: VARIANT_IDS[i],
      tone,
      subject:
        (v.subject || "").trim() ||
        `Helping ${name} strengthen its online presence`,
      previewText:
        (v.previewText || "").trim() ||
        `A few quick ideas to help ${name} attract more clients online.`,
      body,
      cta,
      signature,
      promptVersion: PROMPT_VERSION,
    });
  }

  return out;
}

/** Phase 4 — signature ko alag field banaya (analytics/consistency ke liye) */
export function buildSignature(offer = getOffer()) {
  const links = Object.entries(offer.links || {}).map(([k, v]) => `${k}: ${v}`);
  return [offer.senderName, offer.senderTitle, ...links].filter(Boolean).join("\n");
}
