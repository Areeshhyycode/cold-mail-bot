/**
 * LEAD ROUTER — har lead ko sahi email generator pe bhejta hai.
 *
 *   JOB     -> jobEmail.js   (CV + portfolio, application tone)
 *   SERVICE -> personalizer.js (agency outreach)
 *   HYBRID  -> resolve karo (env HYBRID_DEFAULT, default JOB) phir route
 *
 * Final faisla `leadType` me return hota hai taaki sender ko pata chale CV attach
 * karni hai ya nahi.
 */
import { generateJobEmail } from "./jobEmail.js";
import { generateEmail as generateServiceEmail } from "./personalizer.js";
import { getProfile } from "./profile.js";
import { getOffer } from "./offers.js";
import { detectIntent } from "./intent.js";

const HYBRID_DEFAULT = (process.env.HYBRID_DEFAULT || "JOB").toUpperCase() === "SERVICE"
  ? "SERVICE"
  : "JOB";

/**
 * Lead ka final leadType decide karta hai (JOB | SERVICE).
 * - agar lead.leadType pehle se JOB/SERVICE set hai (e.g. job board se) to wahi.
 * - warna intent par: JOB/SERVICE seedha, HYBRID -> HYBRID_DEFAULT.
 */
export function resolveLeadType(lead) {
  if (lead.leadType === "JOB" || lead.leadType === "SERVICE") return lead.leadType;

  const text = [
    lead.jobTitle,
    lead.jobDescription,
    lead.company,
    lead.businessName,
    lead.niche,
  ]
    .filter(Boolean)
    .join(" ");

  const intent = lead.intent && lead.intent !== "HYBRID" ? lead.intent : detectIntent(text);
  if (intent === "JOB") return "JOB";
  if (intent === "SERVICE") return "SERVICE";
  return HYBRID_DEFAULT;
}

/**
 * Lead ke liye email banata hai (route ke hisab se).
 * @param {object} lead
 * @returns {Promise<{subject, body, leadType, ownerName?}>}
 */
export async function buildEmailForLead(lead) {
  const leadType = resolveLeadType(lead);

  if (leadType === "JOB") {
    const { subject, body } = await generateJobEmail(lead, getProfile());
    return { subject, body, leadType };
  }

  // SERVICE
  const { subject, body, ownerName } = await generateServiceEmail(lead, getOffer());
  return { subject, body, leadType, ownerName };
}
