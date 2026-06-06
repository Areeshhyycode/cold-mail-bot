/**
 * DEMO: "Jo log openly kaam de rahe hain" un job-posts ko scrape karta hai.
 *
 * Upwork/Fiverr client emails public nahi karte (ToS + Connects wall), isliye
 * yahan woh sources use karte hain jahan log KHUD openly hiring post karte hain
 * aur contact bhi aksar public hota hai:
 *
 *   1. Hacker News "Who is hiring" -> monthly thread, log openly hiring post karte
 *      hain, aksar EMAIL ke saath (free public Algolia API, login nahi chahiye)
 *   2. RemoteOK          -> companies jo remote hiring kar rahi hain (public API)
 *
 * Standalone demo hai — DB nahi chahiye. Bas chalao:
 *   node src/scraper/jobBoards.js
 *   node src/scraper/jobBoards.js "developer designer wordpress"   # keyword filter
 *
 * Output: ek list of leads { source, title, contact, link }.
 * Jahan email/contact mila woh aapki existing pipeline (AI personalize -> send)
 * me seedha plug ho sakta hai.
 */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,24}/g;
const BAD = ["example.com", ".png", ".jpg", ".svg", "u/", "reddit.com", "@2x", "removed"];

// text me se pehla asli-dikhne wala email nikaalo (junk skip)
function findEmail(text = "") {
  const hits = [...new Set((text.match(EMAIL_RE) || []).map((e) => e.toLowerCase()))];
  return hits.find((e) => !BAD.some((b) => e.includes(b))) || "";
}

// HTML/markdown ko thoda saaf karke plain-ish text (email/contact dhoondne ke liye)
function strip(text = "") {
  return text.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

/* ------------------------- Hacker News "Who is hiring" ---------------------- */
async function scrapeHN(keyword = "") {
  // 1. latest "Ask HN: Who is hiring?" thread dhoondo
  const search = await fetch(
    "https://hn.algolia.com/api/v1/search_by_date" +
      "?tags=story,author_whoishiring&query=" + encodeURIComponent("Ask HN: Who is hiring"),
    { signal: AbortSignal.timeout(15000) }
  );
  if (!search.ok) throw new Error(`HN search HTTP ${search.status}`);
  const story = (await search.json()).hits?.[0];
  if (!story) throw new Error("HN: koi 'Who is hiring' thread nahi mila");

  // 2. us thread ke top-level comments (= job posts) laao
  const thread = await fetch(`https://hn.algolia.com/api/v1/items/${story.objectID}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!thread.ok) throw new Error(`HN thread HTTP ${thread.status}`);
  const data = await thread.json();

  const kw = keyword.toLowerCase();
  return (data.children || [])
    .filter((c) => c && c.text)
    .map((c) => {
      const body = strip(c.text);
      return { body, email: findEmail(body) };
    })
    .filter((c) => (kw ? kw.split(/\s+/).some((w) => c.body.toLowerCase().includes(w)) : true))
    .slice(0, 50)
    .map((c) => ({
      source: "hn/whoishiring",
      title: c.body.slice(0, 90),
      contact: c.email || "(text me apply instructions)",
      hasEmail: Boolean(c.email),
      link: `https://news.ycombinator.com/item?id=${story.objectID}`,
    }));
}

/* -------------------------------- RemoteOK -------------------------------- */
async function scrapeRemoteOK(keyword = "") {
  const res = await fetch("https://remoteok.com/api", {
    headers: { "User-Agent": "lead-demo/1.0" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`RemoteOK HTTP ${res.status}`);
  const json = await res.json();

  // pehla element legal/metadata hota hai -> skip
  const jobs = json.filter((j) => j && j.position);
  const kw = keyword.toLowerCase();
  return jobs
    .filter((j) => {
      if (!kw) return true;
      const hay = `${j.position} ${j.company} ${(j.tags || []).join(" ")}`.toLowerCase();
      return kw.split(/\s+/).some((w) => hay.includes(w));
    })
    .slice(0, 40)
    .map((j) => {
      const email = findEmail(strip(j.description || ""));
      return {
        source: "remoteok",
        title: `${j.position} @ ${j.company}`.slice(0, 90),
        contact: email || j.apply_url || j.url || "",
        hasEmail: Boolean(email),
        link: j.url || j.apply_url || "",
      };
    });
}

/* ---------------------------------- main ---------------------------------- */
async function main() {
  const keyword = process.argv.slice(2).join(" ").trim();
  console.log(
    `\n🔎 Job-board demo${keyword ? ` (filter: "${keyword}")` : ""} — "jo log kaam de rahe hain"\n`
  );

  const results = await Promise.allSettled([scrapeHN(keyword), scrapeRemoteOK(keyword)]);

  const leads = [];
  for (const r of results) {
    if (r.status === "fulfilled") leads.push(...r.value);
    else console.log(`   ⚠️  ek source fail: ${r.reason.message}`);
  }

  if (!leads.length) {
    console.log("   Kuch nahi mila (network/rate-limit ho sakta hai — dobara try karo).");
    return;
  }

  // jin me email mila woh upar (ready-to-email leads)
  leads.sort((a, b) => Number(b.hasEmail) - Number(a.hasEmail));

  const withEmail = leads.filter((l) => l.hasEmail);
  for (const l of leads) {
    const tag = l.hasEmail ? "📧" : "  ";
    console.log(`${tag} [${l.source}] ${l.title}`);
    console.log(`     → ${l.contact}`);
    console.log(`     ${l.link}\n`);
  }

  console.log(
    `📊 Total ${leads.length} hiring-posts | ${withEmail.length} me direct EMAIL mila (ready to outreach)\n`
  );
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
