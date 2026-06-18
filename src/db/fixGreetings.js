/**
 * One-off: already-generated JOB email bodies ki PEHLI line (greeting) saaf karta hai.
 * Lambe/SEO-stuffed company naam ("Hi Best Web Dev... - Siwtech. team,") ko clean
 * greeting ya neutral "Hello," se replace karta hai. Groq call NAHI karta.
 *
 *   node src/db/fixGreetings.js
 */
import { connectDB, disconnectDB } from "./connect.js";
import { Lead } from "./Lead.js";

function goodGreeting(company = "") {
  const name =
    company && company.length <= 32 && !/[|–—]|services|solutions|company|marketing/i.test(company)
      ? company.replace(/[.,]+$/, "").trim()
      : "";
  return name ? `Hi ${name} team,` : "Hello,";
}

async function main() {
  await connectDB();
  const leads = await Lead.find({ status: "ready", leadType: "JOB", body: { $exists: true, $ne: "" } });

  let fixed = 0;
  for (const l of leads) {
    const nl = l.body.indexOf("\n");
    if (nl < 0) continue;
    const firstLine = l.body.slice(0, nl);
    if (!/^Hi .+ team,\s*$/.test(firstLine)) continue; // sirf greeting line

    const better = goodGreeting(l.company || l.businessName);
    if (better === firstLine) continue; // already theek
    l.body = better + l.body.slice(nl);
    await l.save();
    fixed++;
  }

  console.log(`\n✅ ${fixed} JOB emails ki greeting saaf ki (checked: ${leads.length})`);
  await disconnectDB();
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
