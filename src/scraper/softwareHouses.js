/**
 * KARACHI SOFTWARE HOUSES — speculative JOB outreach.
 *
 * Goal: chahe company ne koi job advertise na kiya ho, Karachi (ya kahin bhi) ki
 * software houses dhoondo, unki public/HR email nikaalo, aur ek professional
 * speculative job-application email bhejo ("agar koi opening ho to consider karein").
 *
 * Google Maps scraper reuse karta hai (businesses) + emailExtractor (HR/contact email).
 * Leads JOB type me ingest hote hain, jobTitle khali (=> jobEmail.js speculative mode).
 *
 * Usage:
 *   node src/scraper/softwareHouses.js
 *   node src/scraper/softwareHouses.js "software house lahore" 25
 */
import dotenv from "dotenv";
import pLimit from "p-limit";
import { fileURLToPath } from "url";
import { connectDB, disconnectDB } from "../db/connect.js";
import { scrapeGoogleMaps } from "./googleMaps.js";
import { extractEmail } from "./emailExtractor.js";
import { verifyEmail } from "./verifyEmail.js";
import { saveLead } from "./ingest.js";

dotenv.config();

// default queries — Karachi ki software houses / IT companies
const DEFAULT_QUERIES = [
  // SIRF KARACHI (onsite target). Remote jobs job-boards (HN/RemoteOK/Remotive/WWR)
  // se aate hain — onsite ke liye Karachi software houses hi chahiye, doosre shehr nahi.
  // Alag-alag terms + ilaaqe se zyada companies milti hain.
  "software house in karachi",
  "software company in karachi",
  "software development company karachi",
  "IT company in karachi",
  "web development company karachi",
  "web design agency karachi",
  "mobile app development company karachi",
  "tech startup karachi",
  "IT services company karachi",
  "ecommerce development company karachi",
  "fintech company karachi",
  "software house shahrah e faisal karachi",
  "software house gulshan e iqbal karachi",
  "software house clifton karachi",
  "software house dha karachi",
  "software house i.i. chundrigar karachi",
  "software house north nazimabad karachi",
  "software house saddar karachi",
];

/**
 * @param {string[]} queries
 * @param {number} maxPerQuery
 * @returns {Promise<{created:number, dup:number, skipped:number, noEmail:number}>}
 */
export async function scrapeSoftwareHouses(queries = DEFAULT_QUERIES, maxPerQuery = 20) {
  const limit = pLimit(5);
  let created = 0;
  let dup = 0;
  let skipped = 0;
  let noEmail = 0;

  for (const query of queries) {
    console.log(`\n🏢 Query: "${query}"`);
    let businesses = [];
    try {
      businesses = await scrapeGoogleMaps(query, maxPerQuery);
    } catch (err) {
      console.log(`   ⚠️  maps fail: ${err.message}`);
      continue;
    }

    const tasks = businesses.map((biz) =>
      limit(async () => {
        try {
          if (!biz.website) {
            noEmail++;
            return;
          }
          const { email } = await extractEmail(biz.website);
          if (!email) {
            noEmail++;
            return;
          }
          if ((await verifyEmail(email)) === "invalid") {
            skipped++;
            return;
          }

          const r = await saveLead({
            leadType: "JOB",
            source: "gmaps",
            company: biz.businessName,
            businessName: biz.businessName,
            jobTitle: "", // speculative — koi specific role nahi
            jobDescription: `${biz.businessName} is a software house / IT company${
              biz.location ? ` based at ${biz.location}` : ""
            }. Speculative application for a developer role.`,
            email,
            website: biz.website,
            niche: "software house",
            location: biz.location || "Karachi",
            city: biz.city || "Karachi",
            phone: biz.phone || "",
          });

          if (r === "created") created++;
          else if (r === "dup") dup++;
          else skipped++;
        } catch (err) {
          skipped++;
        }
      })
    );

    await Promise.all(tasks);
    console.log(`   📥 saved: ${created}, dup: ${dup}, no-email: ${noEmail}, skip: ${skipped}`);
  }

  return { created, dup, skipped, noEmail };
}

async function main() {
  const arg = process.argv[2];
  const max = parseInt(process.argv[3] || "20", 10);
  const queries = arg ? [arg] : DEFAULT_QUERIES;

  console.log(`\n🚀 Software-house sourcing | ${queries.length} queries\n`);
  await connectDB();
  const r = await scrapeSoftwareHouses(queries, max);
  console.log(
    `\n📊 Done | new: ${r.created}, duplicate: ${r.dup}, no-email: ${r.noEmail}, skipped: ${r.skipped}`
  );
  await disconnectDB();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("❌ Error:", err.message);
    process.exit(1);
  });
}
