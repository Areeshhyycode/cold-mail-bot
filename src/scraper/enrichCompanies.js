/**
 * BRIDGE: Job Apply Assistant extension  →  cold-mail-bot pipeline.
 *
 * Extension se exported `companies.csv` (sirf company naam + location, koi email
 * nahi) leta hai, aur har company ke liye:
 *   1. website dhoondta hai  (DuckDuckGo X-ray search — koi login nahi)
 *   2. us website se PUBLIC email nikaalta hai  (extractEmail: info@/careers@/hr@)
 *   3. saveLead() se DB me daalta hai  → phir existing pipeline:
 *        npm run personalize   (AI cold email likhega)
 *        npm run send          (bhejega)
 *
 * Sirf publicly-published business emails — kisi banday ki personal email scrape
 * nahi hoti. Human-in-the-loop: personalize ke baad aap review karke bhejti ho.
 *
 * Usage:
 *   node src/scraper/enrichCompanies.js                     (default: data/companies.csv)
 *   node src/scraper/enrichCompanies.js path/to/companies.csv
 *   node src/scraper/enrichCompanies.js data/companies.csv 25   (max 25 companies)
 */
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import * as cheerio from "cheerio";
import { connectDB, disconnectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";
import { extractEmail } from "./emailExtractor.js";
import { saveLead } from "./ingest.js";

dotenv.config();

const SETTLE_MS = 1500; // companies ke beech politeness delay (rate-limit se bachne ke liye)

// aggregators / socials — yeh company ki apni website NAHI hai, skip karo
const SKIP_HOST =
  /indeed|linkedin|facebook|instagram|twitter|x\.com|rozee|glassdoor|crunchbase|youtube|wikipedia|bloomberg|medium\.com|ambitionbox|google\.|bing\.|duckduckgo|yelp|tracxn|clutch\.co|goodfirms/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------- tiny CSV parser ----------------------------- */
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  text = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// extension headers (Company, Open roles, Locations, Careers search, Sample job link)
// + manual aliases — sab case-insensitive
const HEADER_MAP = {
  company: "company", "company name": "company", businessname: "company", name: "company",
  locations: "city", location: "city", city: "city",
  website: "website", url: "website",
};

/* ------------------- company naam → website (X-ray search) ---------------- */
async function findWebsite(name) {
  const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(`${name} official website`);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return "";
    const $ = cheerio.load(await res.text());
    let site = "";
    $("a.result__a").each((_, el) => {
      if (site) return;
      let href = $(el).attr("href") || "";
      const m = href.match(/uddg=([^&]+)/);
      if (m) href = decodeURIComponent(m[1]);
      try {
        const u = new URL(href);
        if (!SKIP_HOST.test(u.hostname)) site = u.origin;
      } catch { /* skip */ }
    });
    return site;
  } catch {
    return "";
  }
}

async function main() {
  const file = process.argv[2] || path.join(process.cwd(), "data", "companies.csv");
  const max = Number(process.argv[3]) || Infinity;

  let text;
  try { text = await fs.readFile(file, "utf-8"); }
  catch {
    // graceful: daily pipeline me file na ho to "kuch karna nahi" — fail nahi
    console.log(`ℹ️  ${file} nahi mili — koi company enrich karni nahi. Skip.`);
    process.exit(0);
  }

  const rows = parseCSV(text);
  if (rows.length < 2) { console.log("ℹ️  companies.csv khali — skip."); process.exit(0); }

  const headers = rows[0].map((h) => HEADER_MAP[h.trim().toLowerCase()] || h.trim().toLowerCase());
  const records = rows.slice(1).map((r) => {
    const o = {};
    headers.forEach((h, i) => (o[h] = (r[i] || "").trim()));
    return o;
  }).filter((r) => r.company).slice(0, max);

  console.log(`🏢 ${records.length} companies enrich karni hain (${file})\n`);
  await connectDB();

  let created = 0, dup = 0, noSite = 0, noEmail = 0;
  for (const rec of records) {
    const name = rec.company;

    // pehle se lead hai (kisi pichle run me ban gaya)? slow website/email lookup skip karo
    const already = await Lead.findOne({ $or: [{ businessName: name }, { company: name }] }).select("_id").lean();
    if (already) { dup++; continue; }

    let website = rec.website || "";
    if (!website) website = await findWebsite(name);
    if (!website) { noSite++; console.log(`   🔍 ${name} — website nahi mili`); await sleep(SETTLE_MS); continue; }

    const { email } = await extractEmail(website);
    if (!email) { noEmail++; console.log(`   📭 ${name} — ${website} (public email nahi mili)`); await sleep(SETTLE_MS); continue; }

    const r = await saveLead({
      leadType: "SERVICE",
      source: "extension",
      businessName: name,
      company: name,
      website,
      email,
      niche: "software house",
      city: rec.city || "",
      location: rec.city || "",
    });
    if (r === "created") { created++; console.log(`   ✅ ${name} — ${email}  (${website})`); }
    else if (r === "dup") { dup++; console.log(`   ♻️  ${name} — already in DB`); }
    else { console.log(`   ⏭️  ${name} — skipped (${r})`); }

    await sleep(SETTLE_MS);
  }

  console.log(
    `\n📊 Enrich done: ${created} naye leads · ${dup} duplicate · ${noSite} bina-website · ${noEmail} bina-email`
  );
  if (created) console.log(`   Ab chalao:  npm run personalize   phir   npm run send`);
  await disconnectDB();
}

main().catch((err) => { console.error("❌ Error:", err.message); process.exit(1); });
