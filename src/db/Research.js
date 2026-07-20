import mongoose from "mongoose";

/**
 * RESEARCH — Phase 2. Ek business ki research, DOMAIN pe cache.
 *
 * Kyun alag collection: research MEHNGI hai (site fetch + Groq call). Aur ek hi
 * company aksar kai leads ban jati hai (info@ aur sales@ do alag Lead docs). Domain
 * pe cache karo to dobara kaam nahi hota.
 *
 * TTL: 30 din. Us ke baad stale — business badal chuka hota hai.
 *
 * ⚠️ Ye `Business` collection se ALAG hai (jo lead-finder module ka hai). Wo raw
 * Google-Maps maal rakhta hai; ye outreach ke liye AI-summarized picture rakhta hai.
 */

const researchSchema = new mongoose.Schema(
  {
    // cache key — website ka clean domain (www./protocol/trailing-slash ke bagair)
    domain: { type: String, required: true, unique: true, index: true },
    website: { type: String, default: "" },

    businessName: { type: String, default: "" },
    industry: { type: String, default: "" },
    services: { type: [String], default: [] },
    location: { type: String, default: "" },
    companySize: { type: String, default: "" },   // "1-10" | "11-50" | "" (pata nahi)

    /* ------------------------- website ki halat --------------------------- */
    websiteStatus: {
      type: String,
      enum: ["live", "broken", "none", "unknown"],
      default: "unknown",
    },
    // websiteAudit.js ka output — jaisa hai waisa (reuse, dobara nahi likha)
    websiteQuality: {
      type: String,
      enum: ["none", "outdated", "ok", "unknown"],
      default: "unknown",
    },
    auditReasons: { type: [String], default: [] },
    techStack: { type: [String], default: [] },   // WordPress, Wix, jQuery, React…

    /* ---------------------------- presence -------------------------------- */
    socials: {
      facebook: { type: String, default: "" },
      instagram: { type: String, default: "" },
      linkedin: { type: String, default: "" },
      twitter: { type: String, default: "" },
      youtube: { type: String, default: "" },
      whatsapp: { type: String, default: "" },  // wa.me link jo site pe mila
    },
    googleRating: { type: Number, default: null },
    reviewCount: { type: Number, default: null },
    reviewHighlights: { type: [String], default: [] },

    // 0-100: kitni majboot online presence hai. KAM score = behtar agency target.
    onlinePresenceScore: { type: Number, default: null },
    presenceGaps: { type: [String], default: [] },  // "No LinkedIn page", "No SSL"…

    /* ---------------------------- contacts -------------------------------- */
    emails: { type: [String], default: [] },
    phones: { type: [String], default: [] },
    contactFormUrl: { type: String, default: "" },
    contactFormFields: { type: [String], default: [] },  // Phase 6 — length adapt

    /* ------------------------------- AI ----------------------------------- */
    aiSummary: { type: String, default: "" },     // 2-3 line business summary
    aiAngle: { type: String, default: "" },       // pitch ka best angle
    aiModel: { type: String, default: "" },

    researchedAt: { type: Date, default: Date.now },
    error: { type: String, default: "" },
  },
  { timestamps: true }
);

export const Research =
  mongoose.models.Research || mongoose.model("Research", researchSchema);

const TTL_DAYS = parseInt(process.env.RESEARCH_TTL_DAYS || "30", 10);

/** Research purani ho gayi? (30 din) */
export function isStale(doc) {
  if (!doc || !doc.researchedAt) return true;
  const age = Date.now() - new Date(doc.researchedAt).getTime();
  return age > TTL_DAYS * 24 * 60 * 60 * 1000;
}

/** website URL → cache key. "https://www.Foo.com/x/" → "foo.com" */
export function toDomain(website = "") {
  return String(website)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .trim();
}
