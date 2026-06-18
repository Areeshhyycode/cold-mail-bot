/**
 * JOB-BOARD SCRAPERS — public sources jahan log openly hiring post karte hain.
 * Har scraper normalized job-leads return karta hai:
 *   { source, company, jobTitle, jobUrl, jobDescription, email, location, datePosted, hasEmail }
 *
 * Sources:
 *   1. Hacker News "Who is hiring"  (Algolia API, aksar EMAIL ke saath)
 *   2. RemoteOK                     (public API, aksar sirf apply URL)
 *   3. Remotive                     (public API)
 *   4. WeWorkRemotely               (public RSS)
 *
 * Standalone bhi chalta hai (DB me ingest karta hai):
 *   node src/scraper/jobBoards.js "react node next"
 *   node src/scraper/jobBoards.js                      # default keyword filter (roles)
 */
import dotenv from "dotenv";
import * as cheerio from "cheerio";
import { fileURLToPath } from "url";
import { connectDB, disconnectDB } from "../db/connect.js";
import { saveLeads } from "./ingest.js";
import { extractEmailsFromText } from "./emailExtractor.js";
import { ROLE_KEYWORDS } from "../ai/intent.js";

dotenv.config();

// shared strict filter — placeholder/junk (email@example.org, your@…) block ho jate hain
function findEmail(text = "") {
  return extractEmailsFromText(text)[0] || "";
}

function strip(text = "") {
  return text.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

// keyword match helper — har word me se koi ek bhi mile to pass
function matchesKeyword(hay, kw) {
  if (!kw) return true;
  const h = hay.toLowerCase();
  return kw.toLowerCase().split(/\s+/).some((w) => w && h.includes(w));
}

/* ------------------------- Hacker News "Who is hiring" ---------------------- */
export async function scrapeHN(keyword = "") {
  const search = await fetch(
    "https://hn.algolia.com/api/v1/search_by_date" +
      "?tags=story,author_whoishiring&query=" + encodeURIComponent("Ask HN: Who is hiring"),
    { signal: AbortSignal.timeout(15000) }
  );
  if (!search.ok) throw new Error(`HN search HTTP ${search.status}`);
  const story = (await search.json()).hits?.[0];
  if (!story) throw new Error("HN: koi 'Who is hiring' thread nahi mila");

  const thread = await fetch(`https://hn.algolia.com/api/v1/items/${story.objectID}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!thread.ok) throw new Error(`HN thread HTTP ${thread.status}`);
  const data = await thread.json();
  const link = `https://news.ycombinator.com/item?id=${story.objectID}`;

  return (data.children || [])
    .filter((c) => c && c.text)
    .map((c) => {
      const body = strip(c.text);
      // HN posts aksar "Company | Role | Location | ..." format me hote hain
      const parts = body.split("|").map((s) => s.trim());
      const company = parts.length > 1 ? parts[0].slice(0, 80) : "";
      return {
        source: "hn",
        leadType: "JOB",
        company,
        jobTitle: (parts[1] || body).slice(0, 90),
        jobUrl: `${link}#${c.id}`, // per-post anchor -> unique dedupe key
        jobDescription: body,
        email: findEmail(body),
        location: /remote/i.test(body) ? "remote" : "",
      };
    })
    .filter((c) => matchesKeyword(c.jobDescription, keyword))
    .map((c) => ({ ...c, hasEmail: Boolean(c.email) }));
}

/* -------------------------------- RemoteOK -------------------------------- */
export async function scrapeRemoteOK(keyword = "") {
  const res = await fetch("https://remoteok.com/api", {
    headers: { "User-Agent": "lead-bot/1.0" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`RemoteOK HTTP ${res.status}`);
  const json = await res.json();

  return json
    .filter((j) => j && j.position)
    .filter((j) => matchesKeyword(`${j.position} ${j.company} ${(j.tags || []).join(" ")}`, keyword))
    .map((j) => {
      const desc = strip(j.description || "");
      const email = findEmail(desc);
      return {
        source: "remoteok",
        leadType: "JOB",
        company: j.company || "",
        jobTitle: j.position || "",
        jobUrl: j.url || j.apply_url || "",
        jobDescription: desc,
        email,
        location: j.location || "remote",
        datePosted: j.date ? new Date(j.date) : undefined,
        hasEmail: Boolean(email),
      };
    });
}

/* -------------------------------- Remotive -------------------------------- */
export async function scrapeRemotive(keyword = "") {
  const url =
    "https://remotive.com/api/remote-jobs?category=software-dev" +
    (keyword ? `&search=${encodeURIComponent(keyword)}` : "");
  const res = await fetch(url, {
    headers: { "User-Agent": "lead-bot/1.0" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Remotive HTTP ${res.status}`);
  const jobs = (await res.json()).jobs || [];

  return jobs.slice(0, 60).map((j) => {
    const desc = strip(j.description || "");
    const email = findEmail(desc);
    return {
      source: "remotive",
      leadType: "JOB",
      company: j.company_name || "",
      jobTitle: j.title || "",
      jobUrl: j.url || "",
      jobDescription: desc.slice(0, 4000),
      email,
      location: j.candidate_required_location || "remote",
      datePosted: j.publication_date ? new Date(j.publication_date) : undefined,
      hasEmail: Boolean(email),
    };
  });
}

/* ----------------------------- WeWorkRemotely ----------------------------- */
export async function scrapeWWR(keyword = "") {
  const res = await fetch("https://weworkremotely.com/categories/remote-programming-jobs.rss", {
    headers: { "User-Agent": "lead-bot/1.0" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`WWR HTTP ${res.status}`);
  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });

  const out = [];
  $("item").each((_, el) => {
    const item = $(el);
    const rawTitle = item.find("title").text().trim(); // "Company: Role"
    const linkEl = item.find("link").text().trim();
    const desc = strip(item.find("description").text());
    const pub = item.find("pubDate").text().trim();
    if (!rawTitle || !linkEl) return;
    if (!matchesKeyword(`${rawTitle} ${desc}`, keyword)) return;

    const [company, ...roleParts] = rawTitle.split(":");
    out.push({
      source: "wwr",
      leadType: "JOB",
      company: (company || "").trim(),
      jobTitle: (roleParts.join(":").trim() || rawTitle).slice(0, 90),
      jobUrl: linkEl,
      jobDescription: desc.slice(0, 4000),
      email: findEmail(desc),
      location: "remote",
      datePosted: pub ? new Date(pub) : undefined,
      hasEmail: Boolean(findEmail(desc)),
    });
  });
  return out;
}

/**
 * Saare job sources chalata hai aur leads ka flat array return karta hai.
 * (DB save NAHI karta — caller decide kare. main() neeche save karta hai.)
 */
export async function scrapeAllJobBoards(keyword = "") {
  const settled = await Promise.allSettled([
    scrapeHN(keyword),
    scrapeRemoteOK(keyword),
    scrapeRemotive(keyword),
    scrapeWWR(keyword),
  ]);

  const leads = [];
  const names = ["hn", "remoteok", "remotive", "wwr"];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      leads.push(...r.value);
      console.log(`   ✅ ${names[i]}: ${r.value.length} posts`);
    } else {
      console.log(`   ⚠️  ${names[i]} fail: ${r.reason.message}`);
    }
  });
  return leads;
}

/* ---------------------------------- main ---------------------------------- */
// default keyword = hamari target roles (taaki relevant jobs hi aayen)
const DEFAULT_KEYWORD = ROLE_KEYWORDS.slice(0, 8).join(" ");

async function main() {
  const keyword = process.argv.slice(2).join(" ").trim() || DEFAULT_KEYWORD;
  console.log(`\n🔎 Job boards scrape (filter: "${keyword}")\n`);

  const leads = await scrapeAllJobBoards(keyword);
  const withEmail = leads.filter((l) => l.hasEmail).length;
  console.log(`\n📊 Total ${leads.length} job posts | ${withEmail} me direct email (ready to apply)\n`);

  if (!leads.length) return;

  await connectDB();
  await saveLeads(leads, "job-boards");
  await disconnectDB();
}

// sirf tab chalao jab file DIRECTLY run ho (scraper/run.js import kare to nahi)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("❌ Error:", err.message);
    process.exit(1);
  });
}
