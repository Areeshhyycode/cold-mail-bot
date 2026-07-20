import mongoose from "mongoose";

/**
 * JOB — extension se scrape hui har job posting.
 *
 * Ye Lead se ALAG collection hai (jaan-boojh ke):
 *   Lead = koi business jise hum COLD EMAIL karte hain (outbound).
 *   Job  = koi posting jispe HUM APPLY karte hain (inbound funnel).
 * Dono ka lifecycle, dedupe aur fields bilkul mukhtalif hain — ek hi schema me
 * thoosne se dono gandi ho jati.
 *
 * Har wo field jo scrape na ho sake wo `null` rehti hai (kabhi missing/undefined
 * nahi) — taake dashboard/AI ko pata rahe "ye maloom nahi" vs "ye hai hi nahi".
 */

const NULL_STR = { type: String, default: null };
const NULL_NUM = { type: Number, default: null };

/* ---------------- AI analysis (Phase 3 + Phase 7) — cached ---------------- */
const aiSchema = new mongoose.Schema(
  {
    matchScore: NULL_NUM,             // 0-100, kitna fit ho tum is job pe
    missingSkills: { type: [String], default: [] },
    strengths: { type: [String], default: [] },
    weaknesses: { type: [String], default: [] },
    resumeSuggestions: { type: [String], default: [] },
    interviewDifficulty: NULL_STR,    // easy | medium | hard
    salaryEstimate: NULL_STR,         // jab posting me salary na ho
    companySummary: NULL_STR,
    verdict: NULL_STR,                // apply | maybe | skip
    reasoning: NULL_STR,

    // Phase 7 — heavy artifacts (on-demand, phir cache)
    tailoredResume: NULL_STR,
    tailoredCoverLetter: NULL_STR,

    model: NULL_STR,                  // kis Groq model ne banaya
    basedOn: NULL_STR,                // "card" (sirf title) | "detail" (poori JD)
    generatedAt: { type: Date, default: null },
  },
  { _id: false }
);

const statusEventSchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    at: { type: Date, default: Date.now },
    note: NULL_STR,
  },
  { _id: false }
);

const jobSchema = new mongoose.Schema(
  {
    /* ------------------------- identity / dedupe ------------------------- */
    // Phase 8 — dedupeKey STRONG identity hai (ats id > site job id > clean URL).
    // Isi pe unique index hai: same job DOBARA kabhi save nahi hoti.
    dedupeKey: { type: String, required: true, unique: true, index: true },
    // WEAK identity: company|title|city. Alag URL par wahi job (LinkedIn +
    // company career page) pakadne ke liye — upsert pe warn/merge karte hain.
    fingerprint: { type: String, index: true },

    url: { type: String, required: true },
    jobId: NULL_STR,                  // site ka apna id (indeed jk / linkedin id)
    atsId: NULL_STR,                  // ATS ka id (gh_jid, lever uuid…)
    atsPlatform: NULL_STR,            // greenhouse | lever | workday | indeed | …

    /* ------------------------------ core --------------------------------- */
    title: { type: String, required: true },
    company: NULL_STR,
    companyLogo: NULL_STR,
    companyWebsite: NULL_STR,
    companyLinkedin: NULL_STR,
    companyDescription: NULL_STR,

    /* ---------------------------- compensation --------------------------- */
    salary: NULL_STR,                 // raw string jaisa page pe tha
    salaryCurrency: NULL_STR,         // USD | PKR | EUR | …
    salaryMin: NULL_NUM,
    salaryMax: NULL_NUM,
    salaryPeriod: NULL_STR,           // hour | week | month | year

    /* ------------------------------ role --------------------------------- */
    experienceRequired: NULL_STR,     // "2+ years"
    skills: { type: [String], default: [] },
    technologies: { type: [String], default: [] },
    employmentType: NULL_STR,         // full-time | part-time | contract | internship
    seniority: {                      // internship | junior | mid | senior | junk
      type: String, enum: ["internship", "junior", "mid", "senior", "junk", null],
      default: null,
    },
    workMode: {                       // remote | hybrid | onsite
      type: String, enum: ["remote", "hybrid", "onsite", null], default: null,
    },

    /* ---------------------------- location ------------------------------- */
    location: NULL_STR,               // raw
    country: NULL_STR,
    city: NULL_STR,

    /* ---------------------------- extras --------------------------------- */
    benefits: { type: [String], default: [] },
    recruiterName: NULL_STR,
    recruiterProfile: NULL_STR,
    datePosted: NULL_STR,             // "2 weeks ago" ya ISO — raw rakhte hain
    applicantCount: NULL_NUM,
    easyApply: { type: Boolean, default: null },

    /* -------------------------- description ------------------------------ */
    description: NULL_STR,
    responsibilities: { type: [String], default: [] },
    requirements: { type: [String], default: [] },
    preferredQualifications: { type: [String], default: [] },

    /* ------------------------- scoring / AI ------------------------------ */
    fit: { type: Number, default: 0 },   // local deterministic score (0-100)
    ai: { type: aiSchema, default: null },
    aiStatus: {                          // AI queue ki halat
      type: String, enum: ["pending", "done", "error", "skipped"], default: "pending",
      index: true,
    },
    aiError: NULL_STR,

    /* --------------------- Phase 5 — job history ------------------------- */
    status: {
      type: String,
      enum: ["new", "saved", "applied", "ignored", "archived", "rejected", "interview", "offer", "accepted"],
      default: "new",
      index: true,
    },
    statusHistory: { type: [statusEventSchema], default: [] },
    firstSeen: { type: Date, default: Date.now },
    lastUpdated: { type: Date, default: Date.now },
    appliedAt: { type: Date, default: null },

    /* ---------------------------- provenance ----------------------------- */
    source: NULL_STR,                 // kis host se aaya (indeed.com / linkedin.com)
    enriched: { type: Boolean, default: false }, // detail page visit ho chuki?
  },
  { timestamps: true }
);

/* Phase 8 — dedupe indexes.
   dedupeKey: unique (upsert isi pe hota hai).
   company+title+city: same job alag URL se aaye to bhi pakda jaye. NON-unique —
   kyunki ek company genuinely do same-title roles (alag team) post kar sakti hai;
   isliye ye sirf "possible duplicate" flag karta hai, block nahi. */
jobSchema.index({ company: 1, title: 1, city: 1 });
jobSchema.index({ fit: -1, status: 1 });
jobSchema.index({ "ai.matchScore": -1 });
jobSchema.index({ lastUpdated: -1 });

/** applied ka waqt khud stamp ho jaye */
jobSchema.pre("save", function (next) {
  if (this.isModified("status") && this.status === "applied" && !this.appliedAt) {
    this.appliedAt = new Date();
  }
  next();
});

export const Job = mongoose.models.Job || mongoose.model("Job", jobSchema);
