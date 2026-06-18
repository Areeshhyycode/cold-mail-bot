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
    // businessName ab required NAHI — job leads me company naam aata hai (niche
    // company field), service leads me businessName. Dono me se ek hamesha hoga.
    businessName: { type: String, default: "" },
    website: { type: String },
    // email optional — RemoteOK/job-board leads me sirf apply URL ho sakta hai
    // (email nahi). Aise leads DB me to aate hain par sender unhe skip karta hai.
    email: { type: String, lowercase: true, trim: true },
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

    /* =========================================================
       HYBRID ROUTING — har lead JOB ya SERVICE hota hai.
       leadType  -> final decision (kis flow me jayega)
       intent    -> detector ka raw output (JOB | SERVICE | HYBRID)
    ========================================================= */
    leadType: {
      type: String,
      enum: ["JOB", "SERVICE"],
      default: "SERVICE",
    },
    intent: {
      type: String,
      enum: ["JOB", "SERVICE", "HYBRID"],
      default: "HYBRID",
    },
    score: { type: Number, default: 0 }, // lead quality score (intent.js se)

    /* ---- JOB lead specific fields ---- */
    company: { type: String, default: "" }, // hiring company / software house
    jobTitle: { type: String, default: "" }, // "" => speculative application
    // jobUrl ka koi default NAHI (undefined rehta hai jab tak set na ho) — taaki
    // service leads partial unique index me na aayen (warna sab "" pe collide karte).
    jobUrl: { type: String }, // posting / apply link
    jobDescription: { type: String, default: "" }, // AI personalization ke liye
    source: { type: String, default: "" }, // hn | remoteok | remotive | wwr | gmaps
    datePosted: { type: Date }, // jab posting mili / publish hui

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

// ek email + campaign duplicate na ho — PARTIAL: sirf tab unique enforce karo
// jab email actually mojood ho. Job leads jinme email nahi (sirf apply URL) woh
// is index me aate hi nahi, isliye "duplicate null email" wala crash nahi hota.
leadSchema.index(
  { email: 1, campaign: 1 },
  { unique: true, partialFilterExpression: { email: { $type: "string" } } }
);

// job leads ki dedupe — same posting URL dobara save na ho. PARTIAL: sirf jab
// jobUrl set ho (string). Service leads me jobUrl undefined hota hai -> index me nahi.
leadSchema.index(
  { jobUrl: 1, campaign: 1 },
  { unique: true, partialFilterExpression: { jobUrl: { $type: "string" } } }
);

export const Lead = mongoose.models.Lead || mongoose.model("Lead", leadSchema);
