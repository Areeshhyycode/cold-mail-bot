/**
 * ROZEE.PK JOB SCRAPER — Pakistan/Karachi ka sabse bada job board.
 *
 * KYUN: baaki saare sources (RemoteOK, Remotive, WWR, ATS…) INTERNATIONAL remote
 * boards hain — un pe Karachi/Pakistan ki LOCAL jobs (onsite internships etc.)
 * aati hi nahi. User ko primarily Karachi MERN internships chahiye + remote.
 * Rozee.pk wahi gap bharta hai.
 *
 * TAREEQA: rozee jobs JavaScript se load karta hai (initial HTML me nahi hoti),
 * isliye Playwright (headless chromium) chahiye — plain fetch se nahi milti.
 * Har card ka innerText rich hota hai:
 *   "<Title> <Company>, <City>, Pakistan <desc>.. <Date> <X Years> <Salary> <skills>"
 * aur href me city + job id hota hai:
 *   //www.rozee.pk/<slug>-<city>-jobs-<id>
 *
 * DEFENSIVE: koi bhi cheez toote (playwright missing, rozee down, DOM badle) to
 * ye [] return karta hai — kabhi throw nahi karta, taake daily run na ruke.
 *
 * Standalone:
 *   node src/scraper/rozeeJobs.js "react developer"
 */
import { extractEmailsFromText } from "./emailExtractor.js";

// Default search queries — user ka stack (MERN/web) + junior/intern focus.
// Rozee query format: dashes ke saath. Har query ~20-40 jobs deti hai.
const DEFAULT_QUERIES = [
  "full-stack-developer",
  "mern-stack-developer",
  "react-developer",
  "node-js-developer",
  "web-developer",
  "javascript-developer",
  "front-end-developer",
  "software-engineer-intern",
];

const strip = (s = "") => String(s).replace(/\s+/g, " ").trim();

/** rozee card ke concatenated text se structured fields nikaalo (best-effort). */
function parseCard(title, href, cardText) {
  const t = strip(cardText);
  // title ke baad ka text: "Company, City, Pakistan <desc>.. <Date> <Exp> <Salary>"
  const afterTitle = t.startsWith(title) ? t.slice(title.length).trim() : t;

  // company = pehle comma se pehle ka hissa (title hataane ke baad)
  const company = strip((afterTitle.split(",")[0] || "").slice(0, 80));

  // location: "City, Pakistan" — href me city zyada reliable hai
  const cityFromHref = (href.match(/-(karachi|lahore|islamabad|rawalpindi|peshawar|multan|faisalabad)-jobs?-/i) || [])[1] || "";
  const cityFromText = (afterTitle.match(/\b(karachi|lahore|islamabad|rawalpindi|peshawar|multan|faisalabad|remote|multiple cities)\b/i) || [])[1] || "";
  const city = cityFromHref || cityFromText;
  const isRemote = /\bremote\b/i.test(afterTitle) && !city;
  const location = isRemote ? "Remote" : city ? `${city[0].toUpperCase()}${city.slice(1)}, Pakistan` : "Pakistan";

  // experience: "2 Years" / "1 Year" — minimum years nikaalo (senior filter ke liye)
  const expMatch = afterTitle.match(/(\d+)\s*\+?\s*years?/i);
  const minYears = expMatch ? parseInt(expMatch[1], 10) : null;

  // salary: "30K - 30K" / "450K"
  const salMatch = afterTitle.match(/(\d+\s*K(?:\s*-\s*\d+\s*K)?)/i);
  const salary = salMatch ? salMatch[1].replace(/\s+/g, "") : "";

  // date: "Aug 30, 2026"
  const dateMatch = afterTitle.match(/([A-Z][a-z]{2}\s+\d{1,2},\s*\d{4})/);
  const datePosted = dateMatch ? new Date(dateMatch[1]) : undefined;

  return { company, location, minYears, salary, datePosted, isRemote };
}

/**
 * Rozee se jobs scrape karo.
 * @param {string[]} queries - search terms (dashes ke saath). Default: MERN/web.
 * @param {object} [opts] - { headless=true, perQuery=30 }
 * @returns {Promise<Array>} normalized job leads (jobBoards.js jaisa hi shape)
 */
export async function scrapeRozee(queries = DEFAULT_QUERIES, opts = {}) {
  const { headless = true, perQuery = 30 } = opts;

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.log("   ⚠️  rozee: playwright missing — skip (npx playwright install chromium)");
    return [];
  }

  let browser;
  const out = [];
  const seen = new Set();
  try {
    browser = await chromium.launch({ headless });
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    });

    for (const q of queries) {
      const page = await ctx.newPage();
      try {
        await page.goto(`https://www.rozee.pk/job/jsearch/q/${q}`, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await page.waitForTimeout(4000); // JS-rendered cards load hone do

        const raw = await page.evaluate((limit) => {
          const results = [];
          const seenHref = new Set();
          const links = [...document.querySelectorAll("a")].filter((a) => {
            const href = a.getAttribute("href") || "";
            const txt = (a.textContent || "").trim();
            return /\/[a-z0-9-]+-jobs?-\d+/i.test(href) && txt.length > 4 && txt.length < 90;
          });
          for (const a of links) {
            const href = a.getAttribute("href");
            if (seenHref.has(href)) continue;
            seenHref.add(href);
            let card = a;
            for (let i = 0; i < 5 && card.parentElement; i++) card = card.parentElement;
            results.push({
              title: (a.textContent || "").trim(),
              href,
              cardText: (card.innerText || "").replace(/\s+/g, " ").trim().slice(0, 300),
            });
            if (results.length >= limit) break;
          }
          return results;
        }, perQuery);

        for (const r of raw) {
          const href = r.href.startsWith("//") ? `https:${r.href}` : r.href;
          const jobUrl = href.split("?")[0]; // tracking params hatao
          if (!jobUrl || seen.has(jobUrl)) continue;
          seen.add(jobUrl);

          const meta = parseCard(r.title, r.href, r.cardText);
          const email = extractEmailsFromText(r.cardText)[0] || "";
          out.push({
            source: "rozee",
            leadType: "JOB",
            company: meta.company,
            jobTitle: strip(r.title).slice(0, 90),
            jobUrl,
            jobDescription: strip(r.cardText).slice(0, 1000),
            email,
            location: meta.location,
            minYears: meta.minYears,
            salary: meta.salary,
            datePosted: meta.datePosted,
            hasEmail: Boolean(email),
          });
        }
        console.log(`   ✅ rozee "${q}": ${raw.length} cards`);
      } catch (e) {
        console.log(`   ⚠️  rozee "${q}" fail: ${e.message.split("\n")[0]}`);
      } finally {
        await page.close().catch(() => {});
      }
    }
  } catch (e) {
    console.log(`   ⚠️  rozee scrape fail: ${e.message.split("\n")[0]}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return out;
}

/* --------------------------------- standalone -------------------------------- */
import { fileURLToPath } from "url";
import { resolve } from "path";
const _norm = (p) => resolve(p).replace(/\\/g, "/").toLowerCase();
if (process.argv[1] && _norm(fileURLToPath(import.meta.url)) === _norm(process.argv[1])) {
  const arg = process.argv.slice(2).join(" ").trim();
  const queries = arg ? [arg.replace(/\s+/g, "-")] : DEFAULT_QUERIES;
  scrapeRozee(queries)
    .then((jobs) => {
      console.log(`\n📊 rozee: ${jobs.length} jobs\n`);
      jobs.slice(0, 15).forEach((j) =>
        console.log(`  • ${j.jobTitle} — ${j.company} (${j.location}) ${j.minYears != null ? j.minYears + "yr" : ""} ${j.salary}\n    ${j.jobUrl}`)
      );
      process.exitCode = 0;
    })
    .catch((e) => {
      console.error("❌", e.message);
      process.exitCode = 1;
    });
}
