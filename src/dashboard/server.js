/**
 * DASHBOARD + API SERVER — local web UI + extension ka backend.
 *
 *   npm run dashboard   →   http://localhost:4000        (leads)
 *                           http://localhost:4000/jobs   (AI job assistant)
 *
 * SECURITY (Phase 10) — pehle yahan 3 hole the:
 *   1. CORS `*`  → koi bhi website jo tumhare browser me khuli ho wo is API ko
 *      call kar sakti thi (Groq quota jala sakti thi). Ab sirf chrome-extension://
 *   2. Koi auth NAHI → ab har /api/* pe Bearer token (.env → API_TOKEN).
 *   3. 0.0.0.0 bind → same wifi pe koi bhi tumhare leads parh sakta tha.
 *      Ab 127.0.0.1 only.
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import Groq from "groq-sdk";
import { connectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";
import { PROFILE } from "../ai/profile.js";
import {
  API_TOKEN, suggestToken, applyCors, authorize, csvSafe, vStr, vNum,
} from "../core/httpAuth.js";
import {
  postJobs, postStatus, listJobs, jobStats, getAnalysis, postTailor, HttpError,
} from "../api/jobsApi.js";
import {
  listBusinesses, getBusiness, getContacts, refreshBusiness,
  businessStats, startScan, getScan,
} from "../api/businessesApi.js";
import {
  getSummary, getActivity, getInsights, globalSearch,
} from "../api/dashboardApi.js";
import { resumePending, queueStats } from "../core/analysisQueue.js";
import { handleOutreach } from "../api/outreachRoutes.js";
import { handleAssistant } from "../api/assistantRoutes.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.DASHBOARD_PORT || "4000", 10);

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

/* ------------------------------ body reading ----------------------------- */
const readBody = (req, maxBytes = 5 * 1024 * 1024) =>
  new Promise((resolve, reject) => {
    let b = "";
    let n = 0;
    req.on("data", (c) => {
      n += c.length;
      if (n > maxBytes) { reject(new HttpError("Payload bohat bara hai", 413)); req.destroy(); return; }
      b += c;
    });
    req.on("end", () => resolve(b));
    req.on("error", reject);
  });

const readJson = async (req) => {
  const raw = await readBody(req);
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw new HttpError("Kharab JSON", 400); }
};

/* ============================== /api/answer =============================== */
/* Extension ke apply-form ka sawaal → AI se candidate ki taraf se jawab. */
async function answerQuestion(body) {
  const q = vStr(body?.question, 600);
  const maxLen = vNum(body?.maxLen, 0, 5000) || 0;
  if (!q) return { answer: "" };
  if (!groq) throw new HttpError("GROQ_API_KEY set nahi hai", 503);

  const sys = `Tum is candidate ki taraf se ek job application form bhar rahe ho. Employer ke sawaal ka SIRF jawab do — first person, professional, honest, no markdown, no preamble, no quotes.
Rules:
- Open sawaal (why interested / what makes you unique / cover note) → specific & confident, candidate ke real background se.
- Salary → "Negotiable / as per company standards" (jab tak specific na manga ho).
- Earliest start / notice period → "Immediately available".
- Years of experience → about 1 year (junior).
- Languages → "English, Urdu".
- Jhooti degree/experience kabhi mat banao.
${maxLen ? `Jawab ${maxLen} characters se kam rakho.` : "1-3 sentences, concise."}

CANDIDATE:
Name: ${PROFILE.name}
Title: ${PROFILE.title}
Location: ${PROFILE.location}
Summary: ${PROFILE.summary}
Skills: ${PROFILE.skills.join(", ")}
Highlights: ${PROFILE.highlights.join(" | ")}
Portfolio: ${PROFILE.links.Portfolio} | GitHub: ${PROFILE.links.GitHub} | LinkedIn: ${PROFILE.links.LinkedIn}`;

  const c = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [{ role: "system", content: sys }, { role: "user", content: q }],
    temperature: 0.5,
    max_tokens: 220,
  });
  let a = (c.choices[0]?.message?.content || "").trim().replace(/^["']|["']$/g, "");
  if (maxLen && a.length > maxLen) a = a.slice(0, maxLen);
  return { answer: a };
}

/* ============================= leads (purana) ============================= */
const SENT_STATUSES = ["sent", "followup_1", "followup_2", "replied", "done", "bounced"];

async function getLeadData() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [byStatus, byType, sentToday, repliesArr] = await Promise.all([
    Lead.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    Lead.aggregate([{ $group: { _id: "$leadType", n: { $sum: 1 } } }]),
    Lead.countDocuments({ lastSentAt: { $gte: startOfDay }, status: { $in: SENT_STATUSES } }),
    Lead.find({ status: "replied" }).select("company businessName email").lean(),
  ]);

  const statusCounts = Object.fromEntries(byStatus.map((s) => [s._id || "unknown", s.n]));
  const typeCounts = Object.fromEntries(byType.map((s) => [s._id || "unknown", s.n]));
  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  const leads = await Lead.find({})
    .sort({ lastSentAt: -1, _id: -1 })
    .limit(300)
    .select("company businessName email leadType status score source subject jobTitle lastSentAt createdAt")
    .lean();

  return {
    total, statusCounts, typeCounts, sentToday, replies: repliesArr.length,
    leads: leads.map((l) => ({
      name: l.company || l.businessName || "—",
      email: l.email || "",
      leadType: l.leadType || "",
      status: l.status || "",
      score: l.score ?? 0,
      source: l.source || "",
      title: l.jobTitle || l.subject || "",
      lastSentAt: l.lastSentAt || null,
    })),
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------ extension → companies.csv (legacy) ------------------- */
function firstColNames(text) {
  const names = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    let name;
    if (line[0] === '"') { const m = line.match(/^"((?:[^"]|"")*)"/); name = m ? m[1].replace(/""/g, '"') : ""; }
    else name = line.split(",")[0];
    if (name) names.push(name.replace(/^'/, ""));   // csvSafe ka quote-prefix hatao
  }
  return names;
}

async function ingestCompanies(body) {
  const items = Array.isArray(body) ? body : (body?.companies || []);
  const file = path.join(process.cwd(), "data", "companies.csv");
  await fs.promises.mkdir(path.dirname(file), { recursive: true });

  let hasFile = false;
  const existing = new Set();
  try {
    const t = await fs.promises.readFile(file, "utf8");
    hasFile = true;
    for (const n of firstColNames(t)) existing.add(n.toLowerCase());
  } catch { /* file abhi nahi hai */ }

  const out = [];
  if (!hasFile) out.push("Company,Locations,Link");
  let added = 0;
  for (const it of items.slice(0, 500)) {
    const name = vStr(it?.company || it?.Company, 200);
    if (!name || existing.has(name.toLowerCase())) continue;
    existing.add(name.toLowerCase());
    // csvSafe: `=cmd|...` jaisi scraped value Excel me FORMULA ban jati thi
    out.push([
      csvSafe(name),
      csvSafe(vStr(it?.location || it?.Locations, 200) || ""),
      csvSafe(vStr(it?.link || it?.Link, 500) || ""),
    ].join(","));
    added++;
  }
  if (out.length) await fs.promises.appendFile(file, out.join("\n") + "\n", "utf8");
  return { added, total: existing.size };
}

/* ================================ routing ================================= */
const json = (res, code, data) => {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
};

const server = http.createServer(async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    // har /api/* pe auth. Extension Bearer token bhejta hai; dashboard UI
    // same-origin hai isliye usse token ki zaroorat nahi.
    if (p.startsWith("/api/")) {
      const auth = authorize(req);
      if (!auth.ok) return json(res, 401, { error: auth.reason });
    }

    /* ---------------------------- outreach API -------------------------- */
    // Task 5 — saari /api/outreach/* routing ek module me (server.js chhota rahe).
    const outreach = await handleOutreach(p, req, url, readJson);
    if (outreach) return json(res, outreach.status, outreach.body);

    /* --------------------------- assistant API -------------------------- */
    // Task 8 — AI Assistant. Chat SSE stream karta hai, isliye wo `res` khud
    // sambhalta hai aur { handled:true } deta hai (json() call nahi karna).
    const assistant = await handleAssistant(p, req, res, url, readJson);
    if (assistant?.handled) return;
    if (assistant) return json(res, assistant.status, assistant.body);

    /* ------------------------------ jobs API ---------------------------- */
    if (p === "/api/health") return json(res, 200, { ok: true, ts: Date.now(), aiQueue: queueStats() });

    if (p === "/api/jobs" && req.method === "POST") {
      const result = await postJobs(await readJson(req));
      console.log(`   📥 jobs sync: ${result.upserted} upserted · ${result.duplicates} dupes merged · AI queue ${result.aiQueue.queued}`);
      return json(res, 200, result);
    }
    if (p === "/api/jobs" && req.method === "GET") return json(res, 200, await listJobs(url.searchParams));
    if (p === "/api/jobs/status" && req.method === "POST") return json(res, 200, await postStatus(await readJson(req)));
    if (p === "/api/jobs/stats") return json(res, 200, await jobStats());
    if (p === "/api/jobs/analysis" && req.method === "GET") return json(res, 200, await getAnalysis(url.searchParams));
    if (p === "/api/jobs/tailor" && req.method === "POST") return json(res, 200, await postTailor(await readJson(req)));

    /* --------------------------- businesses API ------------------------- */
    // NOTE: /stats aur /:id ka takraav na ho — pehle exact paths, phir :id.
    if (p === "/api/businesses/stats") return json(res, 200, await businessStats());
    if (p === "/api/businesses" && req.method === "GET") return json(res, 200, await listBusinesses(url.searchParams));
    if (p === "/api/scan" && req.method === "POST") return json(res, 200, startScan(await readJson(req)));

    const scanM = p.match(/^\/api\/scan\/([\w]+)$/);
    if (scanM && req.method === "GET") return json(res, 200, getScan(scanM[1]));

    const bizM = p.match(/^\/api\/businesses\/([a-f0-9]{24})(\/contacts|\/refresh)?$/i);
    if (bizM) {
      const [, id, sub] = bizM;
      if (sub === "/contacts") return json(res, 200, await getContacts(id));
      if (sub === "/refresh" && req.method === "POST") return json(res, 200, await refreshBusiness(id));
      if (!sub) return json(res, 200, await getBusiness(id));
    }

    /* ------------------- command center (Task 7) ------------------------ */
    if (p === "/api/summary") return json(res, 200, await getSummary());
    if (p === "/api/activity") return json(res, 200, await getActivity(url.searchParams));
    if (p === "/api/insights") return json(res, 200, await getInsights());
    if (p === "/api/search") return json(res, 200, await globalSearch(url.searchParams));

    /* ---------------------------- legacy API ---------------------------- */
    if (p === "/api/companies" && req.method === "POST") {
      const result = await ingestCompanies(await readJson(req));
      console.log(`   📥 companies.csv: +${result.added} naye (total ${result.total})`);
      return json(res, 200, result);
    }
    if (p === "/api/answer" && req.method === "POST") return json(res, 200, await answerQuestion(await readJson(req)));
    if (p === "/api/data") return json(res, 200, await getLeadData());

    /* ------------------------------- UI --------------------------------- */
    const file = p.startsWith("/jobs")
      ? "jobs.html"
      : p.startsWith("/businesses")
        ? "businesses.html"
        : p.startsWith("/outreach")
          ? "outreach.html"
          : p.startsWith("/assistant") || p.startsWith("/chat")
            ? "assistant.html"
            : p.startsWith("/home")
              ? "home.html"
              : "index.html";
    const html = fs.readFileSync(path.join(__dirname, file), "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error("❌", err);
    json(res, status, { error: err.message });
  }
});

/* --------------------------------- boot ---------------------------------- */
connectDB()
  .then(async () => {
    if (!API_TOKEN) {
      console.error(`
❌  API_TOKEN .env me set nahi hai — extension API band rahegi (har request 401).

    Ye line .env me daalo:

    API_TOKEN=${suggestToken()}

    Phir wahi token extension popup ke ⚙️ Settings me paste kar do.
`);
    }
    const resumed = await resumePending();
    if (resumed) console.log(`   🤖 ${resumed} jobs AI analysis queue me wapas daali gayin`);

    // port pehle se kisi purane server ne pakda ho to CRASH mat karo — saaf
    // message do (warna node ka bhadda EADDRINUSE stack trace aata hai).
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(`\n❌  Port ${PORT} pehle se busy hai — ek aur dashboard pehle se chal raha hai.`);
        console.error(`    Ya to wahi khula rakho, ya doosre port pe chalao:`);
        console.error(`      Windows (cmd):  set DASHBOARD_PORT=4001 && npm run dashboard`);
        console.error(`      PowerShell:     $env:DASHBOARD_PORT=4001; npm run dashboard`);
        console.error(`      bash/mac/linux: DASHBOARD_PORT=4001 npm run dashboard\n`);
      } else {
        console.error("❌ Server error:", err.message);
      }
      process.exit(1);
    });

    // 127.0.0.1 pe bind — 0.0.0.0 pe NAHI. Warna same wifi pe koi bhi tumhare
    // saare leads (naam, emails) parh sakta tha.
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`\n📊 Leads     → http://localhost:${PORT}`);
      console.log(`🧩 Jobs (AI) → http://localhost:${PORT}/jobs`);
      console.log(`   API ${API_TOKEN ? "🔒 token-protected" : "⚠️  BAND (token missing)"} · local-only · Ctrl+C to stop\n`);
    });
  })
  .catch((err) => {
    console.error("❌ DB connect fail:", err.message);
    process.exit(1);
  });
