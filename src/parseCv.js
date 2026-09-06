/**
 * PARSE CV -> CareerProfile (DB) — npm run parse-cv
 *
 * Ek CV PDF ko parse karke DB me CareerProfile ke taur pe save karta hai. Ye wo
 * foundation hai jispe baaki sab (CV-based job matching, ATS, tailoring) chalega.
 *
 *   npm run parse-cv                                  # assets/cv.pdf -> "MERN Stack Developer" (default)
 *   node src/parseCv.js path/to/cv.pdf "AI Automation"  # naam ke saath
 *   node src/parseCv.js assets/cv.pdf "HR" --no-default # default set na karo
 *
 * Same slug dobara chale to UPDATE karta hai (duplicate nahi banta).
 */
import dotenv from "dotenv";
import path from "path";
import { connectDB, disconnectDB } from "./db/connect.js";
import { CareerProfile } from "./db/CareerProfile.js";
import { parseCvFile } from "./ai/cvParser.js";

dotenv.config();

const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function main() {
  const args = process.argv.slice(2);
  const noDefault = args.includes("--no-default");
  const rest = args.filter((a) => !a.startsWith("--"));
  const cvPath = rest[0] || "assets/cv.pdf";
  const name = rest[1] || "MERN Stack Developer";
  const slug = slugify(name);

  console.log(`📄 Parsing CV: ${cvPath}  →  profile "${name}"\n`);

  const { text, parsed } = await parseCvFile(cvPath);
  console.log(`   ✅ extracted ${text.length} chars`);
  console.log(`   ✅ ${parsed.fullName} · ${parsed.title}`);
  console.log(`   ✅ seniority: ${parsed.seniority} (~${parsed.yearsExperience}yr) · ${parsed.skills.length} skills`);
  console.log(`   ✅ target roles: ${parsed.targetRoles.slice(0, 6).join(", ")}`);

  await connectDB();

  // pehla profile? to isDefault true (jab tak user na kahe)
  const count = await CareerProfile.countDocuments();
  const makeDefault = !noDefault && (count === 0);

  const doc = await CareerProfile.findOneAndUpdate(
    { slug },
    {
      $set: {
        name,
        slug,
        active: true,
        cvPath: path.resolve(cvPath),
        cvFileName: path.basename(cvPath),
        rawText: text,
        parsed,
        parsedAt: new Date(),
      },
      ...(makeDefault ? { $setOnInsert: {} } : {}),
    },
    { upsert: true, new: true }
  );

  if (makeDefault) {
    await CareerProfile.updateMany({ _id: { $ne: doc._id } }, { $set: { isDefault: false } });
    doc.isDefault = true;
    await doc.save();
  }

  console.log(`\n💾 Saved CareerProfile: "${doc.name}" (${doc.slug})${doc.isDefault ? " · DEFAULT" : ""}`);
  console.log(`   _id: ${doc._id}`);
  await disconnectDB();
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
