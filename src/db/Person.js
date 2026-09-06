import mongoose from "mongoose";

/**
 * PERSON — ek recruiter/HR/hiring-manager jise user ne LinkedIn pe DEKH ke
 * extension se "capture" kiya (user-initiated, publicly-visible info).
 *
 * COMPLIANCE: ye bulk-harvest NAHI hai. Extension ek waqt me EK profile capture
 * karta hai jo user khud khol ke dekh rahi hoti hai. Note generate hota hai;
 * bhejna user khud karti hai (dashboard se copy -> LinkedIn pe paste). Koi
 * auto-connect / auto-message NAHI. Koi login/anti-bot bypass NAHI.
 *
 * Priority (kis se pehle connect karna behtar): recruiter > talent-acquisition >
 * hr > hiring-manager > eng-manager > other — role text se derive hoti hai.
 */
const personSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    role: { type: String, default: "" },          // headline / title (jaise dikha)
    company: { type: String, default: "" },
    location: { type: String, default: "" },
    profileUrl: { type: String, required: true },  // linkedin.com/in/... (dedupe key)

    // kis job/role ke liye ye person relevant hai (note personalize karne ko)
    jobTitle: { type: String, default: "" },
    jobUrl: { type: String, default: "" },

    priority: { type: Number, default: 5 },        // 1 = best (recruiter), 6 = other
    priorityLabel: { type: String, default: "other" },

    note: { type: String, default: "" },           // AI connection note (copy karne ko)
    noteAt: { type: Date },

    status: {
      type: String,
      enum: ["new", "note-ready", "sent", "connected", "replied", "skipped"],
      default: "new",
    },
    source: { type: String, default: "linkedin-extension" },
    capturedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// same profile dobara capture -> update (duplicate na bane)
personSchema.index({ profileUrl: 1 }, { unique: true });

/** role text se priority (1 best .. 6 other) + label nikaalo. */
export function rolePriority(role = "") {
  const r = role.toLowerCase();
  if (/\b(recruit|talent acquisition|\bta\b|sourcer)/.test(r)) return { priority: 1, priorityLabel: "recruiter" };
  if (/\b(hr|human resource|people ops|people operations)/.test(r)) return { priority: 2, priorityLabel: "hr" };
  if (/hiring manager/.test(r)) return { priority: 3, priorityLabel: "hiring-manager" };
  if (/(engineering manager|eng manager|team lead|tech lead|cto|head of engineering)/.test(r)) return { priority: 4, priorityLabel: "eng-manager" };
  if (/(founder|ceo|director|manager|lead)/.test(r)) return { priority: 5, priorityLabel: "leadership" };
  return { priority: 6, priorityLabel: "other" };
}

export const Person = mongoose.models.Person || mongoose.model("Person", personSchema);
