import dotenv from "dotenv";
import pLimit from "p-limit";
import fs from "fs/promises";
import path from "path";
import { connectDB, disconnectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";
import { scrapeGoogleMaps } from "./googleMaps.js";
import { extractEmail } from "./emailExtractor.js";
import { verifyEmail } from "./verifyEmail.js";
import { auditWebsite } from "./websiteAudit.js";

dotenv.config();

/**
 * Usage:
 *   node src/scraper/run.js "<query>" <count> <niche>
 *   e.g. node src/scraper/run.js "dental clinic in New York" 30 dental
 *
 * Logic (website-finder mode):
 *   - website MODERN (ok)   -> skip (in ko zaroorat nahi)
 *   - website OUTDATED      -> EMAIL outreach target (email scrape + save lead)
 *   - NO website / broken   -> PHONE outreach list me save (data/phone-leads.json)
 *
 * AUDIT_MODE=off karo to purana behaviour (sabki email scrape, no audit).
 */
async function main() {
  const query = process.argv[2] || "dental clinic in New York";
  const max = parseInt(process.argv[3] || "20", 10);
  const niche = process.argv[4] || "general";
  const auditOn = process.env.AUDIT_MODE !== "off";

  console.log(`🔍 Scraping: "${query}" (max ${max}) | audit: ${auditOn ? "ON" : "off"}`);

  await connectDB();

  const businesses = await scrapeGoogleMaps(query, max);
  console.log(`📍 ${businesses.length} businesses mile\n`);

  const limit = pLimit(5);
  let emailLeads = 0;
  let phoneLeads = 0;
  let skipped = 0;
  const phoneList = [];

  await Promise.all(
    businesses.map((biz) =>
      limit(async () => {
        // 1. website ka audit
        const { quality, reasons } = auditOn
          ? await auditWebsite(biz.website)
          : { quality: "unknown", reasons: [] };

        // 2. modern site -> skip (target nahi)
        if (auditOn && quality === "ok") {
          skipped++;
          console.log(`   ⏭️  ${biz.businessName} — modern site, skip`);
          return;
        }

        // 3. NO website -> phone outreach list
        if (auditOn && quality === "none") {
          if (!biz.phone) {
            skipped++;
            console.log(`   ⏭️  ${biz.businessName} — no website, no phone`);
            return;
          }
          phoneLeads++;
          phoneList.push({
            businessName: biz.businessName,
            phone: biz.phone,
            location: biz.location || "",
            niche,
            reason: reasons.join("; "),
          });
          console.log(`   📞 ${biz.businessName} — ${biz.phone} (no website → phone)`);
          return;
        }

        // 4. OUTDATED (ya audit off) -> email outreach target
        const { email, ownerName } = await extractEmail(biz.website);
        if (!email) {
          // website hai par email nahi mila -> phone fallback
          if (biz.phone) {
            phoneLeads++;
            phoneList.push({
              businessName: biz.businessName,
              phone: biz.phone,
              location: biz.location || "",
              niche,
              reason: reasons.join("; ") || "no email on site",
            });
            console.log(`   📞 ${biz.businessName} — ${biz.phone} (no email → phone)`);
          } else {
            skipped++;
            console.log(`   ⏭️  ${biz.businessName} — koi email/phone nahi`);
          }
          return;
        }

        const emailStatus = await verifyEmail(email);
        if (emailStatus === "invalid") {
          skipped++;
          console.log(`   ❌ ${biz.businessName} — ${email} (invalid)`);
          return;
        }

        try {
          await Lead.create({
            businessName: biz.businessName,
            website: biz.website,
            email,
            emailStatus,
            ownerName,
            niche,
            city: biz.city || "",
            phone: biz.phone || "",
            location: biz.location || "",
            websiteQuality: quality,
            auditReasons: reasons,
            outreachChannel: "email",
            status: "new",
          });
          emailLeads++;
          const why = reasons.length ? ` [${reasons[0]}]` : "";
          console.log(`   ✅ ${biz.businessName} — ${email}${why}`);
        } catch (err) {
          if (err.code === 11000) skipped++;
          else console.log(`   ⚠️  ${biz.businessName} — ${err.message}`);
        }
      })
    )
  );

  // phone leads ko file me save karo (manual phone/WhatsApp outreach ke liye)
  if (phoneList.length) {
    const dir = path.join(process.cwd(), "data");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "phone-leads.json");
    let existing = [];
    try {
      existing = JSON.parse(await fs.readFile(file, "utf-8"));
    } catch {
      /* file nahi hai */
    }
    await fs.writeFile(file, JSON.stringify([...existing, ...phoneList], null, 2));
  }

  console.log(
    `\n📊 Result: ${emailLeads} email-leads (DB), ${phoneLeads} phone-leads (data/phone-leads.json), ${skipped} skip`
  );
  await disconnectDB();
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
