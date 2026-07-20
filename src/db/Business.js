import mongoose from "mongoose";

/**
 * BUSINESS — lead-finder ka core document.
 *
 * ⚠️ Ye `Lead` collection se ALAG hai, jaan-boojh ke:
 *   - `businesses` = kaccha maal (jo mila, jaisa mila). Outreach ka koi taalluq nahi.
 *   - `leads`      = jise hum contact kar rahe hain (status, subject, body, sequence).
 * Business ko baad me PROMOTE kar ke Lead banaya jayega (alag module).
 * Isi liye outreach ka poora code (sender/, router/, followup) chhua tak nahi gaya.
 */
const contactSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["email", "phone", "whatsapp", "facebook", "instagram", "linkedin"] },
    value: String,
    source: String, // google_maps | website | contact_page | derived_from_phone
    confidence: Number, // 0..1
  },
  { _id: false }
);

const businessSchema = new mongoose.Schema(
  {
    // ---- identity / dedupe ----
    // name+area ka slug. UNIQUE index -> dobara scan karo to duplicate nahi banega.
    dedupeKey: { type: String, required: true },
    businessName: { type: String, required: true },
    area: { type: String, default: "" }, // "SMCHS"
    city: { type: String, default: "Karachi" },

    // ---- google maps se ----
    mapsUrl: { type: String, default: "" },
    category: { type: String, default: "" }, // Google ka raw category
    address: { type: String, default: "" },
    rating: { type: Number, default: null },
    reviews: { type: Number, default: null },
    hours: { type: String, default: "" },
    closed: { type: Boolean, default: false },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },

    // ---- website ----
    website: { type: String, default: "" },
    hasWebsite: { type: Boolean, default: false },
    websiteQuality: {
      type: String,
      enum: ["none", "outdated", "ok", "unknown"],
      default: "unknown",
    },
    websiteScore: { type: Number, default: null }, // 0-100
    websiteProblems: { type: [String], default: [] },

    // ---- classification ----
    ourCategory: { type: String, default: "other" }, // hamari taxonomy (Phase 7)

    // ---- contacts (Phase 6) — har ek ka source + confidence ----
    contacts: { type: [contactSchema], default: [] },
    hasEmail: { type: Boolean, default: false },
    hasWhatsapp: { type: Boolean, default: false },

    // ---- AI opportunity score (Phase 5) — EMBEDDED, alag collection nahi.
    // 1:1 hai aur hamesha business ke saath hi parha jata hai -> join bekaar hota.
    score: { type: Number, default: 0 },
    scoreReasons: { type: [String], default: [] },

    lastScannedAt: { type: Date },
  },
  { timestamps: true }
);

// duplicate prevention — dobara scan pe wahi business phir se na bane
businessSchema.index({ dedupeKey: 1 }, { unique: true });
// "SMCHS ke top-opportunity leads" — sabse common query
businessSchema.index({ area: 1, score: -1 });
// "jinki website nahi, score ke hisaab se" — user ka asli use-case
businessSchema.index({ hasWebsite: 1, score: -1 });

export const Business =
  mongoose.models.Business || mongoose.model("Business", businessSchema);
