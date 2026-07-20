/**
 * PHASE 7 — MULTI-STEP AI FOLLOW-UP.
 *
 * Purana followup.js HARDCODED template bhejta tha (aur ek hi reminder). Ye alag
 * hai: har follow-up AI se banta hai, in cheezon ki bunyaad pe:
 *   - pichla message (kya keh chuke hain — dobara na kaho)
 *   - kitna waqt guzra
 *   - website audit / business category
 *   - koi reply aaya tha (aaya to follow-up karte hi nahi)
 *
 * Ye SIRF next follow-up ka DRAFT Message banata hai (status: draft/approved).
 * Bhejta dispatcher hai. Purane sender/followup.js ko chhua nahi — wo Lead-based
 * flow ke liye chalta rehta hai; ye Message-based v2 flow ke liye hai.
 */
import { Message } from "../db/Message.js";
import { Reply } from "../db/Reply.js";
import { askJSON, PROMPT_VERSION } from "./ai.js";
import { buildSignature } from "./compose/email.js";
import { getOffer } from "../ai/offers.js";
import { log } from "../core/logger.js";

const MAX_STEPS = parseInt(process.env.OUTREACH_MAX_FOLLOWUPS || "2", 10); // first ke baad 2 reminders

/**
 * Ek lead/campaign ke liye agla follow-up draft karo — agar due ho.
 *
 * @param {object} lead
 * @param {object} research
 * @param {object} campaign
 * @param {object} lastMessage - is lead ka sabse recent SENT message
 * @returns {Promise<object|null>} naya Message draft, ya null (due nahi / khatam)
 */
export async function draftFollowup(lead, research, campaign, lastMessage) {
  if (!lastMessage || lastMessage.status === "replied") return null;

  const nextStep = (lastMessage.step || 0) + 1;
  if (nextStep > MAX_STEPS) return null; // bas — aur nahi (spam nahi karte)

  // reply aa chuki to follow-up nahi (double-check — Reply collection)
  const replied = await Reply.findOne({ leadId: lead._id, campaign: campaign?.name || "default" });
  if (replied) return null;

  // ye step pehle se ban chuka? (idempotent)
  const exists = await Message.findOne({
    leadId: lead._id,
    campaign: campaign?.name || "default",
    step: nextStep,
  });
  if (exists) return null;

  const daysSince = lastMessage.sentAt
    ? Math.round((Date.now() - new Date(lastMessage.sentAt).getTime()) / 86400000)
    : 0;

  const offer = getOffer();
  const name = research?.businessName || lead.businessName || "";
  const prevBody = (lastMessage.body || "").slice(0, 600);

  const prompt = `Tum ek digital agency owner ho jo ek follow-up email likh rahi ho (pehla email jawab-talab raha).
TONE: professional, respectful, short. Pushy/guilt-trip bilkul nahi.

CONTEXT:
- Business: ${name || "(pata nahi)"}
- Industry: ${research?.industry || lead.niche || "(pata nahi)"}
- Follow-up number: ${nextStep} (of ${MAX_STEPS})
- ${daysSince} din pehle pichla email bheja tha.
- Website ki known issue: ${(research?.auditReasons || []).slice(0, 2).join(", ") || "(koi note nahi)"}

PICHLA EMAIL (ye DOBARA mat likho — is se aage barho, naya angle ya nayi value do):
"""${prevBody}"""

Rules:
- Bilkul short (3-4 sentences max).
- Pichli baat repeat mat karo — ek NAYA chhota value point ya soft reminder.
- ${nextStep >= MAX_STEPS ? "Ye AAKHRI follow-up hai — narmi se 'agar abhi sahi waqt nahi to koi baat nahi' wala close do." : "Halka reminder + ek nayi wajah."}
- Ek clear halka CTA.

SIRF JSON: { "subject": "Re: waali ya nayi short subject", "body": "email body bina signature ke" }`;

  let parsed = {};
  try {
    parsed = await askJSON(prompt, { temperature: 0.7, maxTokens: 500 });
  } catch {
    parsed = {};
  }

  const signature = buildSignature(offer);
  const bodyText = (parsed.body || "").trim() ||
    `Hi ${lead.ownerName || "there"},\n\nJust following up on my note about ${name || "your business"}'s online presence. If it's helpful, I'm happy to send over a couple of specific ideas — no obligation at all.`;

  const doc = new Message({
    leadId: lead._id,
    campaign: campaign?.name || "default",
    channel: lastMessage.channel || "email",
    step: nextStep,
    variant: "A",
    tone: campaign?.style?.tone || "professional",
    subject: (parsed.subject || "").trim() || `Following up — ${name}`,
    body: `${bodyText}\n\n${signature}`,
    signature,
    channelReasons: lastMessage.channelReasons || [],
    // follow-up email bhi auto-send ho sakta hai (email channel); baaki approval
    requiresApproval: lastMessage.channel !== "email",
    status: lastMessage.channel === "email" ? "approved" : "draft",
    approvedAt: lastMessage.channel === "email" ? new Date() : undefined,
    promptVersion: PROMPT_VERSION,
  });
  await doc.save();

  log.info("outreach.followup_drafted", { lead: String(lead._id), step: nextStep });
  return doc;
}
