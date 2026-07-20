/**
 * ATS PUBLIC JOB-BOARD SCRAPERS — Greenhouse, Lever, Ashby.
 *
 * Kyun: Indeed/LinkedIn/Glassdoor bots ko block karte hain (aur account ban ho
 * sakta hai). Lekin HAZARON companies apni careers page in 3 ATS pe chalati hain,
 * aur teeno ka PUBLIC JSON API hai — no key, no scraping, no blocking. Ye APIs
 * SIRF currently-open jobs return karte hain, isliye "still accepting?" automatic
 * verify ho jata hai.
 *
 * Har scraper wahi normalized shape return karta hai jo jobBoards.js deta hai:
 *   { source, leadType:"JOB", company, jobTitle, jobUrl, jobDescription,
 *     email, location, datePosted, hasEmail }
 *
 * COMPANIES list expandable hai — koi token 404 de to gracefully skip hota hai
 * (runner batata hai kaunse resolve hue). Naye remote-JS employers yahan add karo.
 */
import { extractEmailsFromText } from "./emailExtractor.js";

function strip(text = "") {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findEmail(text = "") {
  return extractEmailsFromText(text)[0] || "";
}

async function getJSON(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "lead-bot/1.0", accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* =========================================================================
   COMPANY SEED LISTS — remote-friendly employers jo JS/MERN devs hire karte
   hain. Har provider ka apna board-token format hai. List expand karte raho.
   ========================================================================= */

// Greenhouse: boards-api.greenhouse.io/v1/boards/{token}/jobs
const GREENHOUSE = [
  "gitlab", "dropbox", "airbnb", "coinbase", "robinhood", "doordash",
  "asana", "hashicorp", "cloudflare", "twilio", "sofi", "flexport",
  "gusto", "benchling", "samsara", "affirm", "webflow", "grafanalabs",
  "sourcegraph", "docker", "elastic", "mongodb", "postman", "hopin",
  "clevertech", "closeio", "toggl", "andela", "crossover",
];

// Lever: api.lever.co/v0/postings/{token}?mode=json
const LEVER = [
  "netflix", "plaid", "brex", "ramp", "notion", "figma", "loom",
  "mixpanel", "customerio", "voiceflow", "getlago", "spacelift",
  "hometap", "podium", "swiftly", "welocalize", "leadsimple",
];

// Ashby: api.ashbyhq.com/posting-api/job-board/{token}
const ASHBY = [
  "linear", "posthog", "replit", "mintlify", "resend", "supabase",
  "clerk", "trigger.dev", "cal", "hex", "runwayml", "tailscale",
  "browserbase", "helius", "hyperbolic", "vanta", "opensea", "deel",
];

/* --------------------------------- Greenhouse --------------------------------- */
export async function scrapeGreenhouse(tokens = GREENHOUSE) {
  const out = [];
  await Promise.allSettled(
    tokens.map(async (token) => {
      const data = await getJSON(
        `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`
      );
      for (const j of data.jobs || []) {
        const desc = strip(j.content || "");
        out.push({
          source: "greenhouse",
          leadType: "JOB",
          company: j.company_name || token,
          jobTitle: j.title || "",
          jobUrl: j.absolute_url || "",
          jobDescription: desc.slice(0, 6000),
          email: findEmail(desc),
          location: j.location?.name || "",
          datePosted: j.updated_at ? new Date(j.updated_at) : undefined,
          hasEmail: Boolean(findEmail(desc)),
        });
      }
    })
  );
  return out;
}

/* ------------------------------------ Lever ----------------------------------- */
export async function scrapeLever(tokens = LEVER) {
  const out = [];
  await Promise.allSettled(
    tokens.map(async (token) => {
      const jobs = await getJSON(`https://api.lever.co/v0/postings/${token}?mode=json`);
      for (const j of jobs || []) {
        const desc = strip(`${j.descriptionPlain || j.description || ""} ${(j.lists || []).map((l) => l.content).join(" ")}`);
        out.push({
          source: "lever",
          leadType: "JOB",
          company: token,
          jobTitle: j.text || "",
          jobUrl: j.hostedUrl || j.applyUrl || "",
          jobDescription: desc.slice(0, 6000),
          email: findEmail(desc),
          location: j.categories?.location || (j.workplaceType === "remote" ? "Remote" : ""),
          datePosted: j.createdAt ? new Date(j.createdAt) : undefined,
          hasEmail: Boolean(findEmail(desc)),
        });
      }
    })
  );
  return out;
}

/* ------------------------------------ Ashby ----------------------------------- */
export async function scrapeAshby(tokens = ASHBY) {
  const out = [];
  await Promise.allSettled(
    tokens.map(async (token) => {
      const data = await getJSON(
        `https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`
      );
      for (const j of data.jobs || []) {
        const desc = strip(j.descriptionPlain || j.description || "");
        const comp = j.compensation?.compensationTierSummary || "";
        out.push({
          source: "ashby",
          leadType: "JOB",
          company: token,
          jobTitle: j.title || "",
          jobUrl: j.jobUrl || j.applyUrl || "",
          jobDescription: `${comp ? `Comp: ${comp}. ` : ""}${desc}`.slice(0, 6000),
          email: findEmail(desc),
          location: j.location || (j.isRemote ? "Remote" : ""),
          datePosted: j.publishedAt ? new Date(j.publishedAt) : undefined,
          hasEmail: Boolean(findEmail(desc)),
          salary: comp || "",
        });
      }
    })
  );
  return out;
}

/**
 * Teeno ATS providers ek saath chalao. Flat array return karta hai (DB save nahi).
 */
export async function scrapeAllATS() {
  const settled = await Promise.allSettled([
    scrapeGreenhouse(),
    scrapeLever(),
    scrapeAshby(),
  ]);
  const names = ["greenhouse", "lever", "ashby"];
  const leads = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      leads.push(...r.value);
      console.log(`   ✅ ${names[i]}: ${r.value.length} postings`);
    } else {
      console.log(`   ⚠️  ${names[i]} fail: ${r.reason.message}`);
    }
  });
  return leads;
}
