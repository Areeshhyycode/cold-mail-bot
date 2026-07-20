/**
 * CHANNEL DRIVERS — har channel "kaise bheja jaye".
 *
 * Ek uniform interface: send(message, lead) → { sent, delivered, providerMessageId,
 * error, manual }. `manual: true` ka matlab "tumne khud bhejna hai" (WhatsApp/
 * form/social) — dispatcher us message ko `sent` mark karta hai jab tum confirm
 * karo, khud se nahi.
 *
 * EMAIL driver purane mailer.js ko wrap karta hai — wo bytes-on-wire ka kaam pehle
 * se accha karta hai (unsubscribe header, tracking pixel, delivered detection).
 * Hum sirf uske upar Message layer chadha rahe hain, uski jagah nahi le rahe.
 */
import { sendEmail } from "../sender/mailer.js";
import { getCvAttachment } from "../ai/profile.js";

/**
 * @param {object} message - Message doc
 * @param {object} lead    - us ka Lead
 * @returns {Promise<{sent:boolean, delivered:boolean, providerMessageId?:string, error?:string, manual?:boolean}>}
 */
export async function sendViaChannel(message, lead) {
  switch (message.channel) {
    case "email":
      return sendEmailChannel(message, lead);

    // ye sab MANUAL hain — dispatcher inhe khud nahi bhejta, sirf approved-and-ready
    // banata hai. wa.me link / form URL / profile URL message me pehle se hai.
    case "whatsapp":
    case "contact_form":
    case "linkedin":
    case "facebook":
    case "instagram":
    case "manual":
      return { sent: false, delivered: false, manual: true };

    default:
      return { sent: false, delivered: false, error: `unknown channel: ${message.channel}` };
  }
}

async function sendEmailChannel(message, lead) {
  // SERVICE email → mailer.js khud unsubscribe footer + List-Unsubscribe + tracking
  // pixel lagata hai (leadType SERVICE). Hum wahi contract use karte hain.
  const attachments = lead.leadType === "JOB" ? getCvAttachment() : [];
  const result = await sendEmail({
    to: lead.email,
    subject: message.subject,
    text: message.body,
    leadId: lead._id.toString(),
    attachments,
    leadType: lead.leadType,
  });
  return {
    sent: true,
    delivered: result?.delivered !== false,
    providerMessageId: result?.messageId || "",
  };
}
