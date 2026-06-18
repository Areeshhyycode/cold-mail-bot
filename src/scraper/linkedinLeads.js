/**
 * DEMO (safe semi-auto): LinkedIn pe woh freelancers/agencies dhoondta hai jo
 * Upwork/Fiverr karte hain — taaki aap unka OVERFLOW/subcontract kaam le sako.
 *
 * SAFE kyun: LinkedIn pe LOGIN karke scrape NAHI karta (woh account ban karwata
 * hai). Iske bajaye "X-ray search" — search engine se PUBLIC LinkedIn profile
 * URLs dhoondta hai:  site:linkedin.com/in (upwork OR fiverr) <skill>
 *
 * Phir har profile ke liye:
 *   - connection note (≤280 chars, LinkedIn limit ke andar)
 *   - accept hone ke baad ka follow-up message
 * AI se likhta hai (GROQ_API_KEY ho to), warna ready template.
 *
 * Output: data/linkedin-leads.json — list of { name, headline, url, note, message }.
 * Aap ye drafts conservatively (15-20/din, human-paced) MANUALLY bhejna. Bot
 * se auto-connect mat karna — wahi ban ka risk hai.
 *
 * Usage:
 *   node src/scraper/linkedinLeads.js "web developer"
 *   node src/scraper/linkedinLeads.js "shopify expert" 15
 */
import dotenv from "dotenv";
import * as cheerio from "cheerio";
import fs from "fs/promises";
import path from "path";

dotenv.config();

const MAX_NOTE = 280; // LinkedIn connection-note safe limit

/* --------------------- X-ray search (no LinkedIn login) -------------------- */
// DuckDuckGo ka HTML endpoint — public, scrapeable, login nahi chahiye.
async function xraySearch(skill, max) {
  const q = `site:linkedin.com/in (upwork OR fiverr OR freelancer) ${skill}`;
  const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q);

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Search HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const seen = new Set();
  const leads = [];
  $("a.result__a").each((_, el) => {
    let href = $(el).attr("href") || "";
    // DDG redirect wrapper: //duckduckgo.com/l/?uddg=<encoded real url>
    const m = href.match(/uddg=([^&]+)/);
    if (m) href = decodeURIComponent(m[1]);
    if (!/linkedin\.com\/in\//i.test(href)) return;

    // clean profile url (query strip)
    const clean = href.split("?")[0].replace(/\/$/, "");
    if (seen.has(clean)) return;
    seen.add(clean);

    // title format aksar: "Name - Headline | LinkedIn"
    const raw = $(el).text().replace(/\s*\|\s*LinkedIn\s*$/i, "").trim();
    const [name, ...rest] = raw.split(/\s+[-–—]\s+/);
    leads.push({
      name: (name || "").trim() || "there",
      headline: rest.join(" - ").trim(),
      url: clean,
    });
  });

  return leads.slice(0, max);
}

/* ------------------------------ message drafts ----------------------------- */
const SENDER = process.env.SENDER_NAME || "Areesha Rafiq";

function templateDrafts(lead, skill) {
  const first = lead.name.split(/\s+/)[0] || "there";
  let note = `Hi ${first}, I see your ${skill} work — really solid. I take on overflow/subcontract ${skill} projects for busy freelancers. Would love to connect in case you ever need a reliable extra hand.`;
  if (note.length > MAX_NOTE) note = note.slice(0, MAX_NOTE - 1) + "…";

  const message = [
    `Hi ${first}, thanks for connecting!`,
    "",
    `I reached out because you clearly stay busy with ${skill} work. I work as a reliable subcontractor — when you're overloaded or want to take on more clients without the extra hours, you can hand the overflow to me (white-label, you stay the client's point of contact).`,
    "",
    "Fast turnaround, your standards, no drama. If that's ever useful, happy to share a couple of samples and rates — no pressure.",
    "",
    `Best,`,
    SENDER,
  ].join("\n");

  return { note, message };
}

async function aiDrafts(lead, skill) {
  if (!process.env.GROQ_API_KEY) return templateDrafts(lead, skill);
  try {
    const { default: Groq } = await import("groq-sdk");
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

    const prompt = `Tum ek B2B outreach copywriter ho. Main (${SENDER}) ek ${skill} subcontractor hoon jo busy freelancers ka OVERFLOW/extra kaam white-label leta hoon.

TARGET PERSON:
- Name: ${lead.name}
- LinkedIn headline: ${lead.headline || "(unknown)"}

JSON return karo EXACTLY is format me (English, warm but professional, no emojis, no hype, no fake claims):
{
  "note": "LinkedIn connection request note. MAX ${MAX_NOTE} characters. Personalized to their ${skill} work. Mention I take overflow/subcontract work. Soft, not salesy.",
  "message": "Message to send AFTER they accept. 4-6 short lines. Offer to be their reliable white-label subcontractor for overflow ${skill} work. End with my name: ${SENDER}. No pressure."
}`;

    const c = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      response_format: { type: "json_object" },
    });
    const p = JSON.parse(c.choices[0]?.message?.content || "{}");
    let note = (p.note || "").trim();
    if (!note) return templateDrafts(lead, skill);
    if (note.length > MAX_NOTE) note = note.slice(0, MAX_NOTE - 1) + "…";
    return { note, message: (p.message || templateDrafts(lead, skill).message).trim() };
  } catch {
    return templateDrafts(lead, skill); // AI fail -> template fallback
  }
}

/* ------------------------ readable worklist (HTML page) -------------------- */
// Ek browser-page banata hai: har banda ek card me, uska LinkedIn link + uske
// 2 message saath. "Copy" button se note/message copy ho jata hai. Isse saaf
// pata chalta hai KISKO KYA bhejna hai.
function buildHtml(leads, skill) {
  const esc = (s = "") =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const cards = leads
    .map(
      (l, i) => `
    <div class="card">
      <div class="head">
        <span class="num">${i + 1}</span>
        <div>
          <div class="name">${esc(l.name)}</div>
          <div class="headline">${esc(l.headline || skill)}</div>
        </div>
      </div>
      <a class="open" href="${esc(l.url)}" target="_blank" rel="noopener">🔗 LinkedIn profile kholo →</a>

      <div class="label">1️⃣ Connection request ke saath ye NOTE bhejo:</div>
      <div class="box"><pre id="n${i}">${esc(l.note)}</pre><button onclick="cp('n${i}',this)">Copy</button></div>

      <div class="label">2️⃣ Accept ho jaaye to ye MESSAGE bhejo:</div>
      <div class="box"><pre id="m${i}">${esc(l.message)}</pre><button onclick="cp('m${i}',this)">Copy</button></div>
    </div>`
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8">
<title>LinkedIn worklist — ${esc(skill)}</title>
<style>
  body{font-family:system-ui,Segoe UI,Arial;background:#f3f4f6;margin:0;padding:24px;color:#111}
  h1{font-size:20px}.sub{color:#555;margin-bottom:20px}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px;margin-bottom:18px;max-width:720px}
  .head{display:flex;gap:12px;align-items:center;margin-bottom:10px}
  .num{background:#0a66c2;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:600;flex:0 0 auto}
  .name{font-weight:700;font-size:16px}.headline{color:#666;font-size:13px}
  .open{display:inline-block;color:#0a66c2;text-decoration:none;font-weight:600;margin-bottom:12px}
  .open:hover{text-decoration:underline}
  .label{font-size:13px;font-weight:600;margin:12px 0 6px}
  .box{position:relative;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 12px}
  pre{margin:0;white-space:pre-wrap;font-family:inherit;font-size:14px;line-height:1.5}
  button{position:absolute;top:8px;right:8px;background:#0a66c2;color:#fff;border:0;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px}
  button:hover{background:#08518f}
</style></head><body>
  <h1>📋 LinkedIn outreach worklist — "${esc(skill)}"</h1>
  <div class="sub">${leads.length} log. Roz upar se 15–20 karo. Har banda → uska note bhejo, accept ho to message bhejo. Auto-bot mat — manual.</div>
  ${cards}
  <script>
    function cp(id,btn){navigator.clipboard.writeText(document.getElementById(id).innerText);
      var t=btn.innerText;btn.innerText='Copied ✓';setTimeout(function(){btn.innerText=t},1200);}
  </script>
</body></html>`;
}

/* ---------------------------------- main ---------------------------------- */
async function main() {
  const skill = (process.argv[2] || "web developer").trim();
  const max = parseInt(process.argv[3] || "12", 10);
  const ai = Boolean(process.env.GROQ_API_KEY);

  console.log(`\n🔎 LinkedIn X-ray: "${skill}" freelancers (max ${max}) | AI drafts: ${ai ? "ON" : "off (template)"}\n`);

  const leads = await xraySearch(skill, max);
  if (!leads.length) {
    console.log("   Kuch profile nahi mila (search rate-limit ho sakta hai — thodi der baad try karo).");
    return;
  }

  const out = [];
  for (const lead of leads) {
    const { note, message } = await aiDrafts(lead, skill);
    out.push({ ...lead, skill, note, message });
    console.log(`👤 ${lead.name}${lead.headline ? ` — ${lead.headline}` : ""}`);
    console.log(`   ${lead.url}`);
    console.log(`   📝 Note: ${note}\n`);
  }

  const dir = path.join(process.cwd(), "data");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "linkedin-leads.json"), JSON.stringify(out, null, 2));
  const htmlPath = path.join(dir, "linkedin-worklist.html");
  await fs.writeFile(htmlPath, buildHtml(out, skill));

  console.log(`📊 ${out.length} profiles saved.`);
  console.log(`👉 Ye file browser me kholo (kisko kya bhejna saaf dikhega):`);
  console.log(`   ${htmlPath}\n`);
  console.log(`⚠️  Drafts MANUALLY bhejna (15-20/din, human-paced). Auto-bot = ban risk.\n`);

  // Windows pe page khud khol do
  if (process.platform === "win32") {
    const { spawn } = await import("child_process");
    spawn("cmd", ["/c", "start", "", htmlPath], { detached: true, stdio: "ignore" }).unref();
  }
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
