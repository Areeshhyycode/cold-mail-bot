/**
 * TAILOR CV for a job — npm run tailor-cv
 *
 *   node src/tailorCv.js "<job description text>"     # apna JD do
 *   node src/tailorCv.js                              # DB se ek JOB lead uthata hai
 *
 * Default CareerProfile (npm run parse-cv se) ke against job ko tailor karta hai:
 * tailored summary, prioritized skills, per-role emphasis, honest missing gaps.
 */
import dotenv from "dotenv";
import { connectDB, disconnectDB } from "./db/connect.js";
import { CareerProfile } from "./db/CareerProfile.js";
import { Lead } from "./db/Lead.js";
import { tailorCv } from "./ai/cvTailor.js";

dotenv.config();

async function main() {
  await connectDB();

  const cp = await CareerProfile.findOne({ isDefault: true }) || await CareerProfile.findOne({});
  if (!cp) { console.log("❌ Koi CareerProfile nahi — pehle `npm run parse-cv` chalao."); await disconnectDB(); return; }

  let jobText = process.argv.slice(2).join(" ").trim();
  let jobLabel = "(pasted job)";
  if (!jobText) {
    const lead = await Lead.findOne({ leadType: "JOB", jobDescription: { $nin: [null, ""] } })
      .sort({ score: -1 }).lean();
    if (!lead) { console.log("❌ Koi JOB lead (description ke saath) nahi mila. JD argument me do."); await disconnectDB(); return; }
    jobText = `${lead.jobTitle || ""}\n${lead.jobDescription}`;
    jobLabel = `${lead.jobTitle || "?"} @ ${lead.company || "?"}`;
  }

  console.log(`\n👤 Profile: ${cp.name}  →  🎯 Job: ${jobLabel}\n`);
  const r = await tailorCv(jobText, cp.parsed);

  console.log(`📊 CV↔Job match: ${r.matchPct}%\n`);
  console.log("📝 Tailored summary:\n   " + (r.summary || "—") + "\n");
  console.log("⭐ Prioritized skills: " + (r.prioritizedSkills || []).slice(0, 12).join(", "));
  console.log("\n💼 Role emphasis:");
  (r.roles || []).forEach((role) => console.log(`   • ${role.title}${role.company ? " @ " + role.company : ""}\n     → ${role.emphasis || "—"}`));
  console.log("\n⚠️  Missing (add only if genuinely yours): " + ((r.missingKeywords || []).join(", ") || "none 🎉"));
  console.log("\n💡 Tips:");
  (r.tips || []).forEach((t) => console.log("   • " + t));
  if (r.note) console.log("\n(" + r.note + ")");

  await disconnectDB();
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
