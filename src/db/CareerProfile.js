import mongoose from "mongoose";

/**
 * CAREER PROFILE — ek CV se bana structured profile.
 *
 * User ke paas kai career tracks hain (MERN Developer, AI Automation, HR, Call
 * Center). Har track ek CareerProfile hai: apni CV, skills, roles, target-roles.
 * Job matching in profiles ke against hota hai — "is job ke liye best profile
 * kaunsa?" (multi-profile match, vision module #4/#5).
 *
 * PEHLE: ek hardcoded PROFILE (ai/profile.js) tha — sirf ek identity, edit nahi
 * ho sakta tha. Ab CV se parse hota hai (ai/cvParser.js), DB me store, dashboard
 * se add/edit. `ai/profile.js` PROFILE fallback rahega jab tak koi active profile
 * na ho (backward-compat — kuch break na ho).
 *
 * "Never invent" rule: parsed.* me sirf CV me MOJOOD cheez aati hai. AI wording
 * improve kar sakta hai, par facts (skills/experience) CV se hi.
 */
const roleSchema = new mongoose.Schema(
  { title: String, company: String, duration: String, mode: String, bullets: [String] },
  { _id: false }
);

const careerProfileSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },        // "MERN Stack Developer"
    slug: { type: String, required: true, unique: true }, // "mern-stack-developer"
    active: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },  // job emails/matching ka default

    // source CV
    cvPath: { type: String, default: "" },         // assets/cv.pdf
    cvFileName: { type: String, default: "" },      // attachment ka naam
    rawText: { type: String, default: "" },         // extracted PDF text (parser input)

    // AI-parsed structure (facts CV se — invent NAHI)
    parsed: {
      fullName: { type: String, default: "" },
      title: { type: String, default: "" },
      location: { type: String, default: "" },
      email: { type: String, default: "" },
      phone: { type: String, default: "" },
      links: { type: Object, default: {} },         // {GitHub, LinkedIn, Portfolio}
      summary: { type: String, default: "" },
      seniority: { type: String, default: "junior" }, // intern|junior|mid|senior
      yearsExperience: { type: Number, default: 0 },
      skills: { type: [String], default: [] },        // normalized skill keywords
      technologies: { type: [String], default: [] },
      roles: { type: [roleSchema], default: [] },
      education: { type: [String], default: [] },
      certifications: { type: [String], default: [] },
      targetRoles: { type: [String], default: [] },   // "Full Stack Developer", "React Developer"
      keywords: { type: [String], default: [] },       // ATS/matching keywords
    },

    // baseline ATS (CV alone, no job) — ATS analyzer phase me bharega
    atsBaseline: { type: Number, default: null },

    parsedAt: { type: Date },
  },
  { timestamps: true }
);

export const CareerProfile =
  mongoose.models.CareerProfile || mongoose.model("CareerProfile", careerProfileSchema);
