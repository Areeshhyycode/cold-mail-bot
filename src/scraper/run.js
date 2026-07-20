import dotenv from "dotenv";
import pLimit from "p-limit";
import fs from "fs/promises";

import { connectDB, disconnectDB } from "../db/connect.js";
import { extractEmail } from "./emailExtractor.js";
import { verifyEmail } from "./verifyEmail.js";
import { auditWebsite } from "./websiteAudit.js";
import { scrapeGoogleMaps } from "./googleMaps.js";
import { generateQueries } from "./leadGenerator.js";
import { scrapeAllJobBoards } from "./jobBoards.js";
import { scrapeSoftwareHouses } from "./softwareHouses.js";
import { saveLead, saveLeads } from "./ingest.js";
import { ROLE_KEYWORDS } from "../ai/intent.js";
import { alertNoNewLeads } from "../core/alerts.js";
import { log } from "../core/logger.js";

dotenv.config();

// har source ka natija jama karo — run ke aakhir me batayenge ke KUCH naya mila ya nahi
const totals = { created: 0, dup: 0, skipped: 0 };
function tally(r = {}) {
  totals.created += r.created || 0;
  totals.dup += r.dup || 0;
  totals.skipped += r.skipped || 0;
}

/* =======================
   📊 STATS (service queries ke liye)
======================= */
const STATS_FILE = "src/queries/queryStats.json";

async function loadStats() {
  try {
    return JSON.parse(await fs.readFile(STATS_FILE, "utf-8"));
  } catch {
    return { data: {} };
  }
}
async function saveStats(stats) {
  try {
    await fs.writeFile(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch (err) {
    console.error("❌ Failed to save stats:", err.message);
  }
}

/* =======================
   🧩 SOURCE 1: JOB BOARDS
======================= */
async function runJobBoards() {
  const keyword = ROLE_KEYWORDS.slice(0, 8).join(" ");
  console.log(`\n🧩 JOB BOARDS (filter: roles)`);
  const leads = await scrapeAllJobBoards(keyword);
  tally(await saveLeads(leads, "job-boards"));
}

/* =======================
   🏢 SOURCE 2: SOFTWARE HOUSES (speculative JOB)
======================= */
async function runSoftwareHouses() {
  console.log(`\n🏢 SOFTWARE HOUSES (speculative job applications)`);
  const r = await scrapeSoftwareHouses();
  console.log(`   📥 software houses → new: ${r.created}, dup: ${r.dup}, no-email: ${r.noEmail}`);
  tally({ created: r.created, dup: r.dup, skipped: r.noEmail });
}

/* =======================
   🌐 SOURCE 3: SERVICE LEADS (Google Maps + website audit)
======================= */
async function runService(max) {
  const auditOn = process.env.AUDIT_MODE !== "off";
  const stats = await loadStats();
  const queries = generateQueries().slice(0, 8);
  console.log(`\n🌐 SERVICE LEADS | queries: ${queries.length} | audit: ${auditOn ? "on" : "off"}`);

  for (const query of queries) {
    console.log(`\n🔍 Query: "${query}"`);
    try {
      const businesses = await scrapeGoogleMaps(query, max);
      const result = await processServiceBusinesses(businesses, auditOn);

      if (!stats.data[query]) stats.data[query] = { runs: 0, emails: 0, phones: 0 };
      stats.data[query].runs += 1;
      stats.data[query].emails += result.created;
      await saveStats(stats);
    } catch (err) {
      console.error(`❌ Query failed: ${query}`, err.message);
    }
  }
}

async function processServiceBusinesses(businesses, auditOn) {
  const limit = pLimit(5);
  let created = 0;
  let skipped = 0;

  const tasks = businesses.map((biz) =>
    limit(async () => {
      try {
        let quality = "unknown";
        let auditReasons = [];
        if (auditOn && biz.website) {
          const audit = await auditWebsite(biz.website);
          quality = audit?.quality || "unknown";
          auditReasons = audit?.reasons || [];
          if (quality === "ok") {
            skipped++;
            return; // accha website hai -> service lead nahi
          }
        }

        const { email } = await extractEmail(biz.website);
        if (!email) {
          skipped++;
          return;
        }
        if ((await verifyEmail(email)) === "invalid") {
          skipped++;
          return;
        }

        const r = await saveLead({
          leadType: "SERVICE",
          source: "gmaps",
          businessName: biz.businessName,
          email,
          website: biz.website,
          niche: "business",
          location: biz.location || "",
          city: biz.city || "",
          phone: biz.phone || "",
          // ye do fields schema me MOJOOD thi par kabhi save hi nahi hoti thi —
          // audit ka natija har baar zaya ho jata tha. Ab persist hota hai, aur
          // personalizer email me "aapki site ka ye masla hai" mention kar sakta hai.
          websiteQuality: quality,
          auditReasons,
        });
        if (r === "created") created++;
        else skipped++;
      } catch {
        skipped++;
      }
    })
  );

  await Promise.all(tasks);
  console.log(`📊 Service → new: ${created}, skipped: ${skipped}`);
  tally({ created, skipped });
  return { created, skipped };
}

/* =======================
   🚀 MAIN — mode: all | jobs | software | service
======================= */
async function main() {
  const mode = (process.argv[2] || "all").toLowerCase();
  const max = parseInt(process.argv[3] || "20", 10);

  console.log(`🚀 Scraper started | mode: ${mode}`);
  await connectDB();

  if (mode === "all" || mode === "jobs") await runJobBoards();
  if (mode === "all" || mode === "software") await runSoftwareHouses();
  if (mode === "all" || mode === "service") await runService(max);

  log.info("scraper.done", { mode, ...totals });

  // 0 NAYE LEADS = pipeline sookh gayi. Yehi 7-din wali khamoshi ki jarh thi:
  // sourcing "success" report karta raha par kuch naya nahi de raha tha, aur
  // koi alert nahi tha. Ab pata chal jayega.
  if (totals.created === 0) {
    log.warn("scraper.no_new_leads", totals);
    await alertNoNewLeads(mode, totals);
  }

  await disconnectDB();
  console.log("\n✅ Done!");
}

main().catch((err) => {
  console.error("❌ Fatal Error:", err.message);
  process.exit(1);
});
