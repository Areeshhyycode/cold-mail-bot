import mongoose from "mongoose";

/**
 * Ek lead = ek business jise hum email karenge.
 * status flow:
 *   new        -> abhi scrape hua, email nahi bana
 *   ready      -> AI ne personalized email bana di, bhejne ke liye taiyar
 *   sent       -> pehla email bhej diya
 *   followup_1 -> pehla follow-up bheja
 *   followup_2 -> doosra follow-up bheja
 *   replied    -> banda reply kar diya (sequence ruk gayi)
 *   done       -> sequence khatam, koi reply nahi
 *   bounced    -> email invalid / bounce ho gaya
 */
const leadSchema = new mongoose.Schema(
  {
    businessName: { type: String, required: true },
    website: { type: String },
    email: { type: String, required: true, lowercase: true, trim: true },
    emailStatus: {
      type: String,
      enum: ["valid", "risky", "invalid", "unknown"],
      default: "unknown",
    },
    ownerName: { type: String, default: "" },
    niche: { type: String, default: "" },
    city: { type: String, default: "" },
    phone: { type: String, default: "" },
    location: { type: String, default: "" },

    // website quality (kis ko naye website ki zaroorat hai)
    websiteQuality: {
      type: String,
      enum: ["none", "outdated", "ok", "unknown"],
      default: "unknown",
    },
    auditReasons: { type: [String], default: [] },
    outreachChannel: {
      type: String,
      enum: ["email", "phone"],
      default: "email",
    },

    // AI se bani email
    subject: { type: String, default: "" },
    body: { type: String, default: "" },

    // sequence tracking
    status: {
      type: String,
      enum: [
        "new",
        "ready",
        "sent",
        "followup_1",
        "followup_2",
        "replied",
        "unsubscribed",
        "done",
        "bounced",
      ],
      default: "new",
    },
    currentStep: { type: Number, default: 0 }, // 0=first, 1=fu1, 2=fu2
    lastSentAt: { type: Date },
    sentCount: { type: Number, default: 0 },

    // open tracking (pixel)
    opened: { type: Boolean, default: false },
    openCount: { type: Number, default: 0 },
    firstOpenedAt: { type: Date },
    lastOpenedAt: { type: Date },

    // kis client/campaign ke liye (jab multiple clients honge)
    campaign: { type: String, default: "default" },
  },
  { timestamps: true }
);

// ek email + campaign duplicate na ho
leadSchema.index({ email: 1, campaign: 1 }, { unique: true });

export const Lead = mongoose.models.Lead || mongoose.model("Lead", leadSchema);
