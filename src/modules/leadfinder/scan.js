/**
 * AREA SCAN ORCHESTRATOR — npm run scan -- "SMCHS"
 *
 * Flow:
 *   area → Google Maps → har business:
 *      website hai?  ──NO──►  phone → +92 → WhatsApp   🔥 HIGH PRIORITY
 *                    ──YES─►  audit + email + socials
 *      → classify → opportunity score → MongoDB (dedupe)
 *
 * Ye module SIRF dhoondta hai. Koi email/WhatsApp BHEJTA nahi — outreach alag
 * module hai (jaisa tumne kaha).
 */
import dotenv from "dotenv";
import { connectDB, disconnectDB } from "../../db/connect.js";
import { Business } from "../../db/Business.js";
import { scrapeGoogleMaps } from "../../scraper/googleMaps.js";
import { auditWebsite } from "../../scraper/websiteAudit.js";
import { findContacts } from "./contact.js";
import { classifyBusiness } from "./classify.js";
import { scoreBusiness } from "./score.js";
import { withLock } from "../../core/lock.js";
import { log } from "../../core/logger.js";

dotenv.config();

const CITY = process.env.SCAN_CITY || "Karachi";

const slug = (s = "") =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

/** ek business ko process karo: audit → contacts → classify → score */
export async function processBusiness(raw, area) {
  const hasWebsite = Boolean(raw.website);

  // ---- website audit (sirf jinki website hai) ----
  let websiteQuality = "none";
  let websiteProblems = [];
  if (hasWebsite) {
    const audit = await auditWebsite(raw.website).catch(() => null);
    websiteQuality = audit?.quality || "unknown";
    websiteProblems = audit?.reasons || [];
  }

  // ---- contacts (no-website walon ke liye YEHI sab kuch hai) ----
  const contacts = await findContacts(raw).catch(() => []);
  const hasEmail = contacts.some((c) => c.type === "email");
  const hasWhatsapp = contacts.some((c) => c.type === "whatsapp");

  const doc = {
    dedupeKey: `${slug(raw.businessName)}|${slug(area)}`,
    businessName: raw.businessName,
    area,
    city: CITY,
    mapsUrl: raw.mapsUrl || "",
    category: raw.category || "",
    address: raw.address || raw.location || "",
    rating: raw.rating ?? null,
    reviews: raw.reviews ?? null,
    hours: raw.hours || "",
    closed: Boolean(raw.closed),
    lat: raw.lat ?? null,
    lng: raw.lng ?? null,

    website: raw.website || "",
    hasWebsite,
    websiteQuality,
    websiteProblems,

    ourCategory: classifyBusiness(raw.category, raw.businessName),
    contacts,
    hasEmail,
    hasWhatsapp,
    lastScannedAt: new Date(),
  };

  const { score, reasons } = scoreBusiness(doc);
  doc.score = score;
  doc.scoreReasons = reasons;
  return doc;
}

export async function scanArea(area, max = 20) {
  const query = `businesses in ${area} ${CITY}`;
  log.info("scan.start", { area, max });

  const raws = await scrapeGoogleMaps(query, max);
  log.info("scan.found", { area, businesses: raws.length });

  let created = 0;
  let updated = 0;
  const saved = [];

  for (const raw of raws) {
    if (!raw.businessName) continue;
    try {
      const doc = await processBusiness(raw, area);

      // dedupe: dobara scan karo to duplicate nahi banega — UPDATE ho jayega
      const res = await Business.updateOne(
        { dedupeKey: doc.dedupeKey },
        { $set: doc },
        { upsert: true }
      );
      if (res.upsertedCount) created++;
      else updated++;
      saved.push(doc);
    } catch (err) {
      log.warn("scan.business_fail", { name: raw.businessName, error: err.message });
    }
  }

  log.info("scan.done", { area, created, updated });
  return { area, found: raws.length, created, updated, businesses: saved };
}

/* --------------------------------- CLI ---------------------------------- */
async function main() {
  const area = process.argv.slice(2).filter((a) => !a.startsWith("-")).join(" ").trim();
  if (!area) {
    console.log('Usage: npm run scan -- "SMCHS"   (ya: node src/modules/leadfinder/scan.js "Clifton")');
    process.exit(1);
  }
  const maxArg = process.argv.find((a) => a.startsWith("--max="));
  const max = maxArg ? parseInt(maxArg.split("=")[1], 10) : 20;

  await connectDB();
  const r = await scanArea(area, max);

  // ---- report: wahi jo tumhein chahiye — NO WEBSITE + WhatsApp ----
  const hot = r.businesses
    .filter((b) => !b.hasWebsite)
    .sort((a, b) => b.score - a.score);

  console.log(`\n${"=".repeat(64)}`);
  console.log(`📍 ${r.area}  —  ${r.found} businesses  (${r.created} new, ${r.updated} updated)`);
  console.log(`🔥 ${hot.length} WITHOUT a website  ← tumhare best leads`);
  console.log("=".repeat(64));

  for (const b of hot) {
    const wa = b.contacts.find((c) => c.type === "whatsapp");
    const ph = b.contacts.find((c) => c.type === "phone");
    console.log(`\n[${b.score}/100] ${b.businessName}`);
    console.log(`   ${b.ourCategory} · ${b.rating ?? "—"}★ (${b.reviews ?? "—"} reviews)`);
    console.log(`   📞 ${ph ? ph.value : "❌ no phone"}`);
    console.log(`   💬 ${wa ? wa.value : "❌ not a mobile number (no WhatsApp)"}`);
    if (b.address) console.log(`   📍 ${b.address.slice(0, 60)}`);
  }

  const reachable = hot.filter((b) => b.hasWhatsapp).length;
  console.log(`\n${"=".repeat(64)}`);
  console.log(`✅ ${reachable}/${hot.length} no-website businesses have a WhatsApp number`);
  console.log(`   Dashboard: http://localhost:4000  |  DB: businesses collection`);

  await disconnectDB();
}

// direct run pe hi chalao (import karne pe nahi)
if (process.argv[1] && process.argv[1].endsWith("scan.js")) {
  withLock("leadfinder", main).catch((err) => {
    log.error("scan.error", { error: err.message });
    process.exit(1);
  });
}
