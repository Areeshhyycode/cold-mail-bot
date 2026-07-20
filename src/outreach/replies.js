/**
 * PHASE 8 — REPLY HANDLING.
 *
 * Har reply ko AI se 8 categories me classify karta hai aur ek suggested jawab
 * pehle se taiyar rakhta hai:
 *   interested · not_interested · need_info · meeting_request · quote_request ·
 *   auto_reply · out_of_office · spam
 *
 * ⚠️ KOI jawab khud-ba-khud nahi jata (user ki explicit requirement). Reply doc
 * `status: "new"` pe rehta hai jab tak tum approve na karo.
 *
 * Ye purane replyChecker.js ka POORAK hai, replacement nahi. replyChecker Lead ka
 * status (replied/bounced/unsubscribed) update karta rehta hai; ye Reply doc bana
 * ke usme classification + suggested reply add karta hai. Dono saath chal sakte hain.
 */
import { Reply, POSITIVE, NEGATIVE } from "../db/Reply.js";
import { Message } from "../db/Message.js";
import { askJSON, PROMPT_VERSION, hasGroq } from "./ai.js";
import { getOffer } from "../ai/offers.js";
import { buildSignature } from "./compose/email.js";
import { log } from "../core/logger.js";

const CLASSES = [
  "interested", "not_interested", "need_info", "meeting_request",
  "quote_request", "auto_reply", "out_of_office", "spam",
];

/**
 * Ek reply ko process karo: classify + suggest + save. Idempotent (externalId pe).
 *
 * @param {object} input - { leadId, from, subject, text, receivedAt, externalId, campaign }
 * @param {object} [lead] - Lead doc (context ke liye — optional)
 * @returns {Promise<object|null>} Reply doc ya null (dedupe hit)
 */
export async function handleReply(input, lead = null) {
  const externalId = (input.externalId || "").trim();
  if (externalId) {
    const dupe = await Reply.findOne({ externalId });
    if (dupe) return null; // pehle process ho chuki
  }

  // is reply ko us message se jodo jo hum ne bheja tha (analytics ke liye)
  const linkedMsg = await Message.findOne({
    leadId: input.leadId,
    status: { $in: ["sent", "delivered", "opened"] },
  }).sort({ sentAt: -1 });

  const analysis = hasGroq()
    ? await classifyReply(input, lead)
    : fallbackClassify(input);

  const doc = new Reply({
    leadId: input.leadId,
    messageId: linkedMsg?._id || null,
    campaign: input.campaign || linkedMsg?.campaign || "default",
    from: input.from || "",
    subject: input.subject || "",
    text: (input.text || "").slice(0, 5000),
    receivedAt: input.receivedAt || new Date(),
    externalId,
    classification: analysis.classification,
    confidence: analysis.confidence,
    sentiment: analysis.sentiment,
    summary: analysis.summary,
    suggestedReply: analysis.suggestedReply,
    suggestedSubject: analysis.suggestedSubject,
    status: "new",
  });

  try {
    await doc.save();
  } catch (err) {
    if (err.code === 11000) return null; // race — dusre ne save kar diya
    throw err;
  }

  log.info("outreach.reply_classified", {
    lead: String(input.leadId),
    class: analysis.classification,
    conf: analysis.confidence,
  });
  return doc;
}

/* ------------------------------ AI classify ------------------------------- */
async function classifyReply(input, lead) {
  const offer = getOffer();
  const prompt = `Tum ek sales assistant ho. Ek business ne humari cold email ka jawab diya hai. Us reply ko classify karo aur ek suggested jawab likho.

HUMARI original pitch: ${offer.service}

REPLY (from: ${input.from || "unknown"}):
Subject: ${input.subject || "(none)"}
"""${(input.text || "").slice(0, 2000)}"""

Categories (exact ek chuno):
- interested: positive, aage baat karna chahte hain
- meeting_request: call/meeting maang rahe hain
- quote_request: price/quote/proposal maang rahe hain
- need_info: aur maloomat chahiye pehle
- not_interested: mana kar rahe hain
- auto_reply: automatic reply (jaise "thanks, we'll get back")
- out_of_office: chhutti/OOO auto message
- spam: irrelevant / spam / bounce-jaisa

SIRF JSON:
{
  "classification": "in categories me se ek",
  "confidence": 0.0-1.0,
  "sentiment": "positive|neutral|negative",
  "summary": "1 line: banda keh kya raha hai",
  "suggestedSubject": "jawab ki subject line (Re: ... theek hai)",
  "suggestedReply": "ek professional, warm jawab jo unki baat ka address kare aur agla step (call/details) suggest kare. Signature MAT lagao — wo alag add hogi. Agar category not_interested/spam/auto_reply/out_of_office hai to suggestedReply empty string do (in pe jawab nahi bhejte)."
}`;

  let p = {};
  try {
    p = await askJSON(prompt, { temperature: 0.4, maxTokens: 600 });
  } catch (err) {
    log.warn("outreach.reply_ai_fail", { err: err.message });
    return fallbackClassify(input);
  }

  const classification = CLASSES.includes(p.classification) ? p.classification : "unknown";
  let suggestedReply = (p.suggestedReply || "").trim();

  // in categories pe jawab dena bekaar/nuksan-deh — suggestion khali rakho
  if (["not_interested", "spam", "auto_reply", "out_of_office"].includes(classification)) {
    suggestedReply = "";
  } else if (suggestedReply) {
    // signature add karo (jaisa email composer karta hai)
    suggestedReply = `${suggestedReply}\n\n${buildSignature(offer)}`;
  }

  return {
    classification,
    confidence: typeof p.confidence === "number" ? Math.max(0, Math.min(1, p.confidence)) : 0.5,
    sentiment: ["positive", "neutral", "negative"].includes(p.sentiment) ? p.sentiment : "neutral",
    summary: (p.summary || "").trim(),
    suggestedSubject: (p.suggestedSubject || "").trim() || `Re: ${input.subject || "your reply"}`,
    suggestedReply,
  };
}

/* -------------------------- no-AI fallback (rules) ------------------------ */
function fallbackClassify(input) {
  const t = `${input.subject || ""} ${input.text || ""}`.toLowerCase();
  let classification = "unknown";
  if (/out of office|on leave|annual leave|vacation|away from|ooo\b/.test(t)) classification = "out_of_office";
  else if (/automatic reply|auto-reply|do not reply|noreply/.test(t)) classification = "auto_reply";
  else if (/\b(quote|pricing|price|proposal|cost|budget)\b/.test(t)) classification = "quote_request";
  else if (/\b(call|meeting|schedule|calendar|zoom|available)\b/.test(t)) classification = "meeting_request";
  else if (/not interested|no thanks|unsubscribe|remove me|stop/.test(t)) classification = "not_interested";
  else if (/interested|tell me more|sounds good|yes|keen/.test(t)) classification = "interested";
  else if (/more info|details|how (does|do)|what (is|do)/.test(t)) classification = "need_info";

  return {
    classification,
    confidence: 0.3,
    sentiment: POSITIVE.includes(classification) ? "positive" : NEGATIVE.includes(classification) ? "negative" : "neutral",
    summary: "",
    suggestedSubject: `Re: ${input.subject || "your reply"}`,
    suggestedReply: "",
  };
}

export { PROMPT_VERSION };
