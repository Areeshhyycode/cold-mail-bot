/**
 * COMPOSE ORCHESTRATOR — channel decision → sahi composer → Message draft(s).
 *
 * Har draft ek Message doc banta hai (status: "draft", requiresApproval decide.js
 * se). Email ke liye N variants (A/B); baaki channels ke liye 1 (unpe A/B ka
 * matlab nahi — tum khud bhejte ho).
 *
 * DUPLICATE PREVENTION: Message ka unique index (leadId+campaign+step+variant) —
 * agar draft pehle se hai to dobara nahi banta (upsert semantics).
 */
import { Message } from "../../db/Message.js";
import { composeEmail } from "./email.js";
import { composeWhatsApp } from "./whatsapp.js";
import { composeContactForm } from "./contactForm.js";
import { composeSocial } from "./social.js";
import { log } from "../../core/logger.js";

/**
 * Ek lead ke liye chune gaye channel par draft(s) banao aur DB me daalo.
 *
 * @param {object} lead
 * @param {object} research
 * @param {object} decision  - decideChannel() ka natija
 * @param {object} campaign  - Campaign doc (tone, variants, name)
 * @param {object} [opts]    - { step (default 0) }
 * @returns {Promise<object[]>} banaye gaye Message docs
 */
export async function composeForLead(lead, research, decision, campaign, opts = {}) {
  const step = opts.step ?? 0;
  const tone = campaign?.style?.tone || "professional";
  const channel = decision.channel;

  // manual channel — koi message nahi banta, bas ek placeholder taake dashboard
  // pe dikhe "is lead ka koi channel nahi mila, tum khud dekho"
  if (channel === "manual") {
    return [await upsertMessage(lead, campaign, {
      channel: "manual",
      step, variant: "A", tone,
      status: "skipped",
      skipReason: "Koi reachable channel nahi mila",
      channelReasons: decision.reasons,
      requiresApproval: true,
    })];
  }

  const drafts = [];

  if (channel === "email") {
    const variants = campaign?.style?.variants || 1;
    const composed = await composeEmail(lead, research, { tone, variants });
    for (const c of composed) {
      drafts.push(await upsertMessage(lead, campaign, {
        channel, step,
        variant: c.variant, tone: c.tone,
        subject: c.subject, previewText: c.previewText, body: c.body,
        cta: c.cta, signature: c.signature,
        channelReasons: decision.reasons,
        requiresApproval: decision.requiresApproval,
        promptVersion: c.promptVersion,
      }));
    }
  } else if (channel === "whatsapp") {
    const c = await composeWhatsApp(lead, research, decision.target, { tone });
    drafts.push(await upsertMessage(lead, campaign, {
      channel, step, variant: "A", tone: c.tone,
      body: c.message, waLink: c.waLink,
      channelReasons: decision.reasons,
      requiresApproval: true,     // WhatsApp hamesha approval
      promptVersion: c.promptVersion,
    }));
  } else if (channel === "contact_form") {
    const c = await composeContactForm(lead, research, { tone });
    drafts.push(await upsertMessage(lead, campaign, {
      channel, step, variant: "A", tone: c.tone,
      body: c.message, formFields: { ...c.formFields, _url: c.formUrl },
      channelReasons: decision.reasons,
      requiresApproval: true,
      promptVersion: c.promptVersion,
    }));
  } else if (["linkedin", "facebook", "instagram"].includes(channel)) {
    const c = await composeSocial(channel, lead, research, decision.target, { tone });
    drafts.push(await upsertMessage(lead, campaign, {
      channel, step, variant: "A", tone: c.tone,
      body: c.message,
      channelReasons: decision.reasons,
      requiresApproval: true,
      promptVersion: c.promptVersion,
    }));
  }

  log.info("outreach.composed", { lead: String(lead._id), channel, drafts: drafts.length });
  return drafts;
}

/**
 * Message upsert — pehle se ho to content refresh karo (jab tak SENT na ho gaya).
 * Sent/approved message ko dobara draft nahi karte (tumhara faisla overwrite nahi hota).
 */
async function upsertMessage(lead, campaign, fields) {
  const key = {
    leadId: lead._id,
    campaign: campaign?.name || "default",
    step: fields.step,
    variant: fields.variant,
  };

  const existing = await Message.findOne(key);
  if (existing && !["draft", "skipped"].includes(existing.status)) {
    return existing; // approve/sent ho chuka — haath mat lagao
  }

  const doc = existing || new Message(key);
  Object.assign(doc, fields, key);
  await doc.save();
  return doc;
}
