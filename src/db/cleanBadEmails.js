/**
 * One-off cleanup: jo pending leads (status new/ready) junk/placeholder email rakhte
 * hain (e.g. email@example.org, your@…), unhe "skipped" mark karta hai taaki sender
 * unhe na bheje. Wahi strict filter use karta hai jo scraping me lagta hai.
 *
 *   node src/db/cleanBadEmails.js
 */
import { connectDB, disconnectDB } from "./connect.js";
import { Lead } from "./Lead.js";
import { extractEmailsFromText } from "../scraper/emailExtractor.js";

const isJunk = (email) => extractEmailsFromText(email).length === 0;

async function main() {
  await connectDB();

  // 1. RESTORE: pehle galti se skip hue valid leads wapas lao (filter ab sahi hai)
  const skipped = await Lead.find({
    status: "skipped",
    email: { $exists: true, $nin: [null, ""] },
  });
  let restored = 0;
  for (const l of skipped) {
    if (!isJunk(l.email)) {
      l.status = l.subject && l.body ? "ready" : "new";
      await l.save();
      restored++;
      console.log(`   ♻️  restore: ${l.email} -> ${l.status}`);
    }
  }

  // 2. SKIP: pending leads jinka email junk/placeholder hai
  const pending = await Lead.find({
    status: { $in: ["new", "ready"] },
    email: { $exists: true, $nin: [null, ""] },
  });
  let bad = 0;
  for (const l of pending) {
    if (isJunk(l.email)) {
      l.status = "skipped";
      await l.save();
      bad++;
      console.log(`   🚫 skip junk: ${l.email} (${l.company || l.businessName || "—"})`);
    }
  }

  console.log(
    `\n✅ Done | restored: ${restored}, junk-skipped: ${bad} (pending checked: ${pending.length})`
  );
  await disconnectDB();
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
