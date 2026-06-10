import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { connectDB, disconnectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";

dotenv.config();

/**
 * Apni KHUD ki companies ko leads me import karo (CSV file se).
 * Yeh scraped leads ke saath hi same pipeline me chali jaati hain:
 *   import -> personalize (AI email) -> send -> follow-up
 *
 * Usage:
 *   node src/scraper/importLeads.js                  (default: data/my-companies.csv)
 *   node src/scraper/importLeads.js path/to/file.csv
 *
 * CSV headers (koi bhi order, case-insensitive). Sirf "email" zaroori hai:
 *   businessName, website, email, ownerName, niche, city, phone
 * Aliases bhi chalte hain: name/company -> businessName, url -> website,
 *   "email id" -> email, owner -> ownerName.
 *
 * Note: jo email pehle se DB me hai usko chhua nahi jata (dobara nahi banta).
 */

// --- chhota CSV parser (quoted fields + commas-inside-quotes handle karta hai) ---
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// header naam ko ek standard key me map karo
const HEADER_MAP = {
  businessname: "businessName", name: "businessName", company: "businessName", "company name": "businessName",
  website: "website", url: "website", site: "website",
  email: "email", "email id": "email", "email address": "email",
  ownername: "ownerName", owner: "ownerName", "owner name": "ownerName", "person name": "ownerName", contact: "ownerName",
  niche: "niche", category: "niche", industry: "niche",
  city: "city",
  phone: "phone", "phone no": "phone", "phone number": "phone",
};

// agar cell me multiple emails ho ("a@x.com, b@y.com") to pehla lo
const firstEmail = (s = "") => {
  const m = s.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m ? m[0].toLowerCase() : "";
};

async function main() {
  const file = process.argv[2] || path.join(process.cwd(), "data", "my-companies.csv");
  let text;
  try {
    text = await fs.readFile(file, "utf-8");
  } catch {
    console.error(`❌ File nahi mili: ${file}\n   data/my-companies.csv banao (template repo me hai) ya path do.`);
    process.exit(1);
  }

  const rows = parseCSV(text);
  if (rows.length < 2) {
    console.error("❌ CSV khali hai ya sirf header hai.");
    process.exit(1);
  }

  const headers = rows[0].map((h) => HEADER_MAP[h.trim().toLowerCase()] || h.trim().toLowerCase());
  const records = rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = (r[i] || "").trim()));
    return obj;
  });

  await connectDB();

  let added = 0, skippedDup = 0, skippedNoEmail = 0;
  for (const rec of records) {
    const email = firstEmail(rec.email || "");
    if (!email) { skippedNoEmail++; continue; }

    const exists = await Lead.findOne({ email });
    if (exists) { skippedDup++; continue; }

    try {
      await Lead.create({
        businessName: rec.businessName || rec.name || email,
        website: rec.website || "",
        email,
        ownerName: rec.ownerName || "",
        niche: rec.niche || "general",
        city: rec.city || "",
        phone: rec.phone || "",
        location: rec.city || "",
        outreachChannel: "email",
        status: "new", // -> personalize step isko AI email dega
      });
      added++;
      console.log(`   ✅ ${rec.businessName || email} — ${email}`);
    } catch (err) {
      if (err.code === 11000) skippedDup++;
      else console.log(`   ⚠️  ${rec.businessName || email} — ${err.message}`);
    }
  }

  console.log(`\n📊 Import done: ${added} naye leads, ${skippedDup} already-exist skip, ${skippedNoEmail} bina-email skip`);
  console.log(`   Ab "npm run personalize" chalao taaki AI in ke emails bana de.`);
  await disconnectDB();
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
