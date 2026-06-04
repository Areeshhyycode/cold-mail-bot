import dotenv from "dotenv";
import pLimit from "p-limit";
import { connectDB, disconnectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";
import { scrapeGoogleMaps } from "./googleMaps.js";
import { extractEmail } from "./emailExtractor.js";

dotenv.config();

/**
 * Usage:
 *   node src/scraper/run.js "dentist in Lahore" 30 dentists
 *   (query, kitne, niche-tag)
 */
async function main() {
  const query = process.argv[2] || "web design agency in Lahore";
  const max = parseInt(process.argv[3] || "20", 10);
  const niche = process.argv[4] || "general";

  console.log(`🔍 Scraping: "${query}" (max ${max})...`);

  await connectDB();

  // 1. Google Maps se businesses
  const businesses = await scrapeGoogleMaps(query, max);
  console.log(`📍 ${businesses.length} businesses mile`);

  // 2. har business se email nikalo (parallel, max 5 ek saath)
  const limit = pLimit(5);
  let saved = 0;
  let skipped = 0;

  await Promise.all(
    businesses.map((biz) =>
      limit(async () => {
        const { email, ownerName } = await extractEmail(biz.website);
        if (!email) {
          skipped++;
          console.log(`   ⏭️  ${biz.businessName} — koi email nahi`);
          return;
        }

        try {
          await Lead.create({
            businessName: biz.businessName,
            website: biz.website,
            email,
            ownerName,
            niche,
            city: biz.city || "",
            status: "new",
          });
          saved++;
          console.log(`   ✅ ${biz.businessName} — ${email}`);
        } catch (err) {
          if (err.code === 11000) {
            skipped++; // duplicate
          } else {
            console.log(`   ⚠️  ${biz.businessName} — ${err.message}`);
          }
        }
      })
    )
  );

  console.log(`\n📊 Result: ${saved} naye leads save hue, ${skipped} skip`);
  await disconnectDB();
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
