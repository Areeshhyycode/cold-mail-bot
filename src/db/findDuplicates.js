import { connectDB, disconnectDB } from "./connect.js";
import { Lead } from "./Lead.js";

/**
 * Read-only diagnostic. Kuch delete nahi karta.
 * Dikhata hai kaunsi companies DB me ek se zyada baar hain
 * (same businessName ya same website pe alag-alag email).
 * Yahi "same company ko daily mail" ki asli wajah hoti hai.
 *
 * Run: node src/db/findDuplicates.js
 */
function norm(s = "") {
  return s.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").trim();
}

async function main() {
  await connectDB();
  const leads = await Lead.find({}, "businessName website email status lastSentAt sentCount").lean();
  console.log(`📊 Total leads: ${leads.length}\n`);

  // group by normalized businessName
  const byName = {};
  const bySite = {};
  for (const l of leads) {
    const n = norm(l.businessName);
    const s = norm(l.website);
    if (n) (byName[n] ||= []).push(l);
    if (s) (bySite[s] ||= []).push(l);
  }

  const dupNames = Object.entries(byName).filter(([, arr]) => arr.length > 1);
  const dupSites = Object.entries(bySite).filter(([, arr]) => arr.length > 1);

  console.log(`🔁 Same company NAME, multiple leads: ${dupNames.length}`);
  for (const [name, arr] of dupNames) {
    console.log(`\n  • ${arr[0].businessName} (${arr.length} leads):`);
    for (const l of arr) console.log(`     - ${l.email}  [${l.status}, sent ${l.sentCount}x]`);
  }

  console.log(`\n🔁 Same WEBSITE, multiple leads: ${dupSites.length}`);
  for (const [site, arr] of dupSites) {
    if (arr.length > 1) {
      console.log(`\n  • ${site} (${arr.length} leads):`);
      for (const l of arr) console.log(`     - ${l.email}  [${l.status}]`);
    }
  }

  console.log(`\n✅ Diagnostic done. (Kuch delete nahi hua.)`);
  await disconnectDB();
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
