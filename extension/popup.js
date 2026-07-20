/* AI Job Assistant — popup (ES MODULE).
 *
 * BARA FARQ (v1 → v2): popup ab `jobs` ko KHUD NAHI likhta.
 * Pehle popup aur service worker dono poori jobs-array overwrite karte the —
 * auto-scan har 2.5s pe likhta tha, background scrape usi waqt likhta tha, aur
 * jo pehle likha gaya wo chup-chaap gum ho jata tha (lost update race).
 *
 * Ab: popup sirf MESSAGE bhejta hai (send("scanTab"), send("setStatus", …)),
 * service worker akela writer hai, aur popup storage.onChanged pe re-render
 * karta hai. Ek writer = koi race nahi.
 */
import {
  STATUSES, STATUS_LABEL, DEAD_STATUSES, classify, fitScore, skillsFor,
  esc, safeUrl, normQ,
} from "./lib/core.js";

const $ = (id) => document.getElementById(id);

let JOBS = {};        // { dedupeKey: record }  — SW se aata hai, read-only
let PROFILE = {};
let SEARCHES = [];
let ANSWERS = {};
let SYNC = {};
let FILTER = "all";   // all | junior | strong | applied

/* ----------------------------- SW messaging ------------------------------ */
function send(cmd, extra = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ cmd, ...extra }, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res) return reject(new Error("Background ne jawab nahi diya"));
      if (!res.ok) return reject(new Error(res.error || "Unknown error"));
      resolve(res.data);
    });
  });
}

function toast(msg, ms = 1800) {
  const t = $("toast");
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.style.display = "none"), ms);
}

/* -------------------------------- filters -------------------------------- */
function visible(j) {
  if (FILTER === "junior") return ["internship", "junior", "mid"].includes(j.seniority || classify(j.title));
  if (FILTER === "strong") return (j.ai?.matchScore ?? j.fit ?? 0) >= 70;
  if (FILTER === "applied") return ["applied", "interview", "offer", "accepted"].includes(j.status);
  return !DEAD_STATUSES.has(j.status);      // "all" me ignored/archived chhupe rehte hain
}

/** AI score jab tak na aaye, local fit score dikhao (turant, bina Groq ke) */
const scoreOf = (j) => j.ai?.matchScore ?? j.fit ?? fitScore(j);
const isAiScore = (j) => j.ai?.matchScore != null;

/* -------------------------------- rendering ------------------------------ */
function scoreBadge(j) {
  const s = scoreOf(j);
  const cls = s >= 70 ? "hi" : s >= 45 ? "mid" : "lo";
  const ai = isAiScore(j);
  const title = ai ? `AI match score: ${s}/100` : `local fit score (AI pending): ${s}/100`;
  return `<span class="fit ${cls}" title="${esc(title)}">${ai ? "🤖" : ""}${s}</span>`;
}

function syncDot(j) {
  if (j.syncState === "synced") return '<span class="dot ok" title="MongoDB me saved"></span>';
  if (j.syncState === "error") return `<span class="dot err" title="Sync fail: ${esc(j.syncError || "")}"></span>`;
  return '<span class="dot pend" title="Sync pending"></span>';
}

function jobCard(j) {
  const k = j.dedupeKey;
  const lvl = j.seniority || classify(j.title);
  const chips = [];
  if (j.workMode) chips.push(`<span class="badge wm">${esc(j.workMode)}</span>`);
  if (j.employmentType) chips.push(`<span class="badge et">${esc(j.employmentType)}</span>`);
  if (j.salary) chips.push(`<span class="badge sal">💰 ${esc(j.salary.slice(0, 28))}</span>`);
  else if (j.ai?.salaryEstimate) chips.push(`<span class="badge sal est" title="AI estimate (posting me salary nahi thi)">≈ ${esc(j.ai.salaryEstimate.slice(0, 28))}</span>`);
  if (j.easyApply) chips.push('<span class="badge ez">⚡ easy apply</span>');
  if (j.applicantCount != null) chips.push(`<span class="badge ap">👥 ${j.applicantCount}</span>`);
  if (!j.enriched) chips.push('<span class="badge pend" title="Detail page abhi visit nahi hui — background me queue hai">⏳ card only</span>');

  const skills = (j.skills?.length ? j.skills : skillsFor(j.title)).slice(0, 6);
  const missing = j.ai?.missingSkills || [];

  const opts = STATUSES.map((s) =>
    `<option value="${s}"${j.status === s ? " selected" : ""}>${esc(STATUS_LABEL[s])}</option>`).join("");

  return `
  <div class="job ${lvl === "senior" ? "snr" : ""} ${DEAD_STATUSES.has(j.status) ? "dead" : ""}">
    <div class="t">${syncDot(j)}${esc(j.title)}${scoreBadge(j)}
      ${lvl === "senior" ? '<span class="badge s">senior</span>' : ""}
      ${lvl === "internship" ? '<span class="badge j">intern</span>' : ""}
      ${lvl === "junior" ? '<span class="badge j">junior</span>' : ""}
    </div>
    <div class="c">${j.companyLogo ? `<img class="logo" src="${esc(safeUrl(j.companyLogo))}" alt="" />` : ""}${esc(j.company || "—")}</div>
    <div class="m">${esc(j.location || "")} ${chips.join("")}</div>
    ${skills.length ? `<div class="m">${skills.map((s) => `<span class="badge sk">${esc(s)}</span>`).join("")}</div>` : ""}
    ${missing.length ? `<div class="m miss">⚠️ missing: ${missing.slice(0, 5).map(esc).join(", ")}</div>` : ""}
    ${j.ai?.verdict ? `<div class="m verdict v-${esc(j.ai.verdict)}">${esc(j.ai.verdict.toUpperCase())} — ${esc(j.ai.reasoning || "")}</div>` : ""}
    <a href="${esc(safeUrl(j.url))}" target="_blank" rel="noopener noreferrer">open job ↗</a>
    <div class="acts">
      <select data-status="${esc(k)}" class="stsel">${opts}</select>
      <button data-ai="${esc(k)}" class="ghost" title="AI analysis + tailored resume/cover letter">🤖 AI</button>
      <button data-del="${esc(k)}" class="ghost">✕</button>
    </div>
  </div>`;
}

function render() {
  const all = Object.values(JOBS);
  const items = all.filter(visible).sort((a, b) => {
    const dead = (x) => (["applied", "interview", "offer", "accepted"].includes(x.status) ? 1 : 0);
    return dead(a) - dead(b) || scoreOf(b) - scoreOf(a);
  });

  const applied = all.filter((j) => j.status === "applied").length;
  const pending = all.filter((j) => j.syncState !== "synced").length;
  const unenriched = all.filter((j) => !j.enriched).length;

  const bits = [`${items.length} shown`, `${all.length} total`];
  if (applied) bits.push(`${applied} applied`);
  if (unenriched) bits.push(`⏳ ${unenriched} enriching`);
  $("count").innerHTML = all.length ? bits.join(" · ") : "";

  // sync status line
  const online = SYNC.online;
  $("syncBar").innerHTML = all.length
    ? `<span class="dot ${online ? "ok" : "err"}"></span>
       ${online ? "MongoDB connected" : `Offline — ${esc(SYNC.lastError || "backend band hai")}`}
       ${pending ? ` · <b>${pending}</b> pending` : " · all synced"}
       <button id="syncNow" class="ghost mini">↻ sync</button>
       ${all.some((j) => j.syncState === "error") ? '<button id="retryFailed" class="ghost mini">retry failed</button>' : ""}`
    : "";

  $("list").innerHTML = items.length
    ? items.map(jobCard).join("")
    : all.length
      ? '<div class="empty">Is filter me koi job nahi.</div>'
      : '<div class="empty">Koi job nahi. Kisi job-search page pe jao aur "Scan this page" dabao.</div>';

  // handlers
  const btn = $("syncNow");
  if (btn) btn.onclick = async () => { toast("↻ syncing…"); await send("syncNow").catch(() => {}); toast("Sync done"); };
  const rf = $("retryFailed");
  if (rf) rf.onclick = async () => { const r = await send("retryFailed"); toast(`↻ ${r.retried} jobs retry hui`); };

  document.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = () => send("deleteJob", { key: b.dataset.del }).catch((e) => toast(e.message));
  });
  document.querySelectorAll("[data-status]").forEach((sel) => {
    sel.onchange = () => send("setStatus", { key: sel.dataset.status, status: sel.value })
      .then(() => toast(`Status → ${sel.value}`))
      .catch((e) => toast(e.message));
  });
  document.querySelectorAll("[data-ai]").forEach((b) => {
    b.onclick = () => showAi(JOBS[b.dataset.ai]);
  });
}

/* ------------------------------- AI panel -------------------------------- */
async function showAi(job) {
  if (!job) return;
  const box = $("aiBox");
  box.style.display = "block";
  box.open = true;
  $("aiTitle").textContent = `${job.title} — ${job.company || ""}`;
  box.scrollIntoView({ behavior: "smooth" });

  const ai = job.ai;
  if (!ai) {
    $("aiBody").innerHTML = '<div class="empty">AI analysis abhi pending hai. Backend chal raha hai? (npm run dashboard) — thodi der me sync ho jayegi.</div>';
  } else {
    const list = (label, items, cls = "") => items?.length
      ? `<div class="aisec"><b>${label}</b><ul class="${cls}">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "";
    $("aiBody").innerHTML = `
      <div class="aitop">
        <span class="fit ${ai.matchScore >= 70 ? "hi" : ai.matchScore >= 45 ? "mid" : "lo"}">🤖 ${ai.matchScore ?? "—"}/100</span>
        ${ai.verdict ? `<span class="badge v-${esc(ai.verdict)}">${esc(ai.verdict)}</span>` : ""}
        ${ai.interviewDifficulty ? `<span class="badge et">interview: ${esc(ai.interviewDifficulty)}</span>` : ""}
        ${ai.basedOn === "card" ? '<span class="badge pend" title="Job description abhi scrape nahi hui — score approximate hai">⏳ card only</span>' : ""}
      </div>
      ${ai.reasoning ? `<div class="aisec">${esc(ai.reasoning)}</div>` : ""}
      ${ai.companySummary ? `<div class="aisec"><b>Company</b><div>${esc(ai.companySummary)}</div></div>` : ""}
      ${ai.salaryEstimate ? `<div class="aisec"><b>Salary estimate</b><div>${esc(ai.salaryEstimate)}</div></div>` : ""}
      ${list("✅ Strengths", ai.strengths)}
      ${list("⚠️ Missing skills", ai.missingSkills, "miss")}
      ${list("❌ Weaknesses", ai.weaknesses)}
      ${list("📝 Resume suggestions", ai.resumeSuggestions)}
      <div class="row" style="margin-top:8px">
        <button id="tailorBtn">✍️ Tailored resume + cover letter</button>
      </div>
      <div id="tailorOut"></div>`;

    $("tailorBtn").onclick = () => tailor(job);
  }
}

/* Phase 7 — backend se tailored resume + cover letter (cached) */
async function tailor(job) {
  const out = $("tailorOut");
  out.innerHTML = '<div class="empty">✍️ AI likh raha hai… (10-20s)</div>';
  try {
    const { base, token } = await cfg();
    const res = await fetch(base + "/api/jobs/tailor", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ dedupeKey: job.dedupeKey }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
    out.innerHTML = `
      <label>Tailored cover letter</label>
      <textarea id="clOut" rows="10">${esc(d.tailoredCoverLetter || "")}</textarea>
      <div class="row"><button id="copyCl" class="ghost">📋 Copy cover letter</button></div>
      <label>Tailored resume</label>
      <textarea id="cvOut" rows="14">${esc(d.tailoredResume || "")}</textarea>
      <div class="row"><button id="copyCv" class="ghost">📋 Copy resume</button></div>`;
    $("copyCl").onclick = () => { navigator.clipboard.writeText($("clOut").value); toast("📋 Cover letter copied"); };
    $("copyCv").onclick = () => { navigator.clipboard.writeText($("cvOut").value); toast("📋 Resume copied"); };
    // apply karte waqt content script isse form me paste kar dega
    chrome.storage.local.set({ applyCoverLetter: d.tailoredCoverLetter || "" });
  } catch (e) {
    out.innerHTML = `<div class="empty">❌ ${esc(e.message)}<br/>Backend chal raha hai? <code>npm run dashboard</code></div>`;
  }
}

const cfg = () => new Promise((r) => chrome.storage.local.get(["botUrl", "apiToken"], (d) =>
  r({ base: (d.botUrl || "http://localhost:4000").replace(/\/+$/, ""), token: d.apiToken || "" })));

/* -------------------------------- actions -------------------------------- */
$("scan").onclick = async () => {
  try {
    // tabId yahin se bhejo — SW me tabs.query({currentWindow}) reliable nahi hai
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return toast("Koi active tab nahi");
    const r = await send("scanTab", { tabId: tab.id, url: tab.url });
    toast(r.added || r.updated
      ? `✅ ${r.added} naye · ${r.updated} update — enrich + AI background me`
      : "Koi naya job nahi mila (ya is page pe support nahi)");
  } catch (e) { toast("Scan fail: " + e.message); }
};

$("clear").onclick = async () => {
  if (!confirm("Saari jobs local list se hat jayengi (MongoDB me jo sync ho chuki hain wo rahengi). Sure?")) return;
  await send("clearJobs");
  toast("List clear");
};

$("export").onclick = () => {
  const list = Object.values(JOBS).filter(visible);
  if (!list.length) return toast("Is filter me koi job nahi");
  const cols = ["title", "company", "location", "workMode", "employmentType", "seniority",
    "salary", "salaryMin", "salaryMax", "salaryCurrency", "experienceRequired",
    "applicantCount", "easyApply", "atsPlatform", "status", "fit", "url"];
  const q = (v) => {
    let s = Array.isArray(v) ? v.join(" / ") : String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;      // Excel formula injection guard
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = [...cols, "aiScore", "missingSkills", "verdict"];
  const rows = list.map((j) => [
    ...cols.map((c) => q(j[c])),
    q(j.ai?.matchScore), q(j.ai?.missingSkills), q(j.ai?.verdict),
  ].join(","));
  const csv = [head.join(","), ...rows].join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = "jobs.csv"; a.click();
  URL.revokeObjectURL(url);
  toast(`⬇ jobs.csv (${list.length} jobs)`);
};

document.querySelectorAll("[data-filter]").forEach((c) => {
  c.onclick = () => {
    FILTER = c.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((x) => x.classList.toggle("on", x === c));
    render();
  };
});

/* ----------------------- daily auto-scrape (searches) -------------------- */
const saveAuto = () => chrome.storage.local.set({ searches: SEARCHES, autoDaily: $("autoDaily").checked });

const shortUrl = (u) => {
  try { const x = new URL(u); return x.hostname.replace(/^www\./, "") + x.pathname + (x.search ? " ?…" : ""); }
  catch { return u; }
};

function renderSearches() {
  $("searches").innerHTML = SEARCHES.length
    ? SEARCHES.map((u, i) => `<div class="srch"><span title="${esc(u)}">${esc(shortUrl(u))}</span><button data-rms="${i}" class="ghost">✕</button></div>`).join("")
    : '<div class="empty" style="padding:8px">Koi saved search nahi. Indeed/LinkedIn pe search kholo → "➕ Add current page".</div>';
  document.querySelectorAll("[data-rms]").forEach((b) =>
    (b.onclick = () => { SEARCHES.splice(+b.dataset.rms, 1); saveAuto(); renderSearches(); }));
}

async function updateAutoInfo() {
  const d = await new Promise((r) => chrome.storage.local.get(["lastRun", "lastAdded"], r));
  $("autoInfo").textContent = d.lastRun
    ? `Last auto-run: ${new Date(d.lastRun).toLocaleString()} · +${d.lastAdded || 0} new`
    : "Abhi tak auto-run nahi hua.";
}

$("addSearch").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/i.test(tab.url || "")) return toast("Pehle koi job-search page kholo");
  if (SEARCHES.includes(tab.url)) return toast("Ye search already saved hai");
  SEARCHES.push(tab.url); saveAuto(); renderSearches(); toast("➕ Search saved");
};

$("scrapeNow").onclick = async () => {
  if (!SEARCHES.length) return toast("Pehle koi search add karo");
  toast("▶ Scraping… (tabs khulenge & band honge)", 4000);
  try {
    const r = await send("scrapeNow");
    toast(r.added ? `✅ ${r.added} naye jobs — AI analyze kar raha hai` : "Koi naya job nahi mila");
  } catch (e) { toast(e.message); }
};

$("autoDaily").onchange = () => {
  saveAuto();
  toast($("autoDaily").checked ? "🤖 Daily auto-scrape ON" : "Auto-scrape OFF");
};

/* -------------------------------- settings ------------------------------- */
$("saveSettings").onclick = async () => {
  chrome.storage.local.set({
    botUrl: $("s_url").value.trim() || "http://localhost:4000",
    apiToken: $("s_token").value.trim(),
  }, async () => {
    const r = await send("ping").catch(() => ({ online: false, error: "SW error" }));
    toast(r.online ? "✅ Backend connected" : `❌ ${r.error || "connect fail"}`, 3000);
  });
};

$("saveProfile").onclick = () => {
  PROFILE = {
    name: $("p_name").value.trim(), email: $("p_email").value.trim(),
    phone: $("p_phone").value.trim(), portfolio: $("p_portfolio").value.trim(),
    pitch: $("p_pitch").value.trim(),
    expTitle: $("p_exptitle").value.trim(), expCompany: $("p_expcompany").value.trim(),
    interview: $("p_interview").value.trim(),
  };
  chrome.storage.local.set({ profile: PROFILE });
  toast("💾 Profile saved");
};

$("autoAdvance").onchange = () => {
  chrome.storage.local.set({ autoAdvance: $("autoAdvance").checked });
  toast($("autoAdvance").checked ? "⚡ Auto-advance ON (Submit tum dabao)" : "Auto-advance OFF");
};

/* ----------------------- auto-answers (learn once) ----------------------- */
const saveAnswers = () => chrome.storage.local.set({ answers: ANSWERS });

function collectAnswers() {
  const obj = {};
  for (const r of document.querySelectorAll("#ansList .ans")) {
    const q = normQ(r.querySelector(".ansq").value);
    const a = (r.querySelector(".ansa").value || "").trim();
    if (q && a) obj[q] = a;
  }
  ANSWERS = obj;
  saveAnswers();
}

const ansRowHTML = (q, a) => `<div class="ans">
  <input class="ansq" value="${esc(q)}" placeholder="Question (e.g. expected salary)" />
  <textarea class="ansa" rows="2" placeholder="Your answer">${esc(a)}</textarea>
  <button class="ghost ansdel">✕ remove</button>
</div>`;

function renderAnswers() {
  const entries = Object.entries(ANSWERS);
  $("ansList").innerHTML = entries.length
    ? entries.map(([q, a]) => ansRowHTML(q, a)).join("")
    : '<div class="empty" style="padding:8px" id="ansEmpty">Koi saved answer nahi. "➕ Add answer" ya "✨ Common sawaal" se shuru karo.</div>';
}

function addAnsRow(q = "", a = "") {
  const empty = $("ansList").querySelector("#ansEmpty");
  if (empty) empty.remove();
  $("ansList").insertAdjacentHTML("beforeend", ansRowHTML(q, a));
}

const COMMON_Q = [
  ["expected salary", "Negotiable / as per company standards"],
  ["notice period", "Immediately available"],
  ["years of experience", "Around 1 year of professional experience"],
  ["why are you interested in this role", "I'm excited about this role because it lines up closely with my MERN / Next.js full-stack work, and I'd love to contribute and keep growing with your team."],
  ["are you willing to relocate", "I'm open to fully remote work and can relocate for the right opportunity."],
  ["do you require visa sponsorship", "No sponsorship required for remote work."],
  ["earliest start date", "Immediately"],
  ["what languages do you speak", "English and Urdu"],
];

$("addAns").onclick = () => addAnsRow("", "");
$("seedAns").onclick = () => {
  let added = 0;
  for (const [q, a] of COMMON_Q) if (!ANSWERS[normQ(q)]) { addAnsRow(q, a); added++; }
  collectAnswers();
  toast(added ? `✨ ${added} common sawaal add hue` : "Sab common sawaal pehle se saved hain");
};

$("ansList").addEventListener("input", collectAnswers);
$("ansList").addEventListener("click", (e) => {
  if (e.target.classList.contains("ansdel")) {
    e.target.closest(".ans").remove();
    collectAnswers();
    if (!Object.keys(ANSWERS).length) renderAnswers();
  }
});

/* ------------------------------ live updates ----------------------------- */
/* SW state badalta hai → popup khud refresh (koi polling nahi) */
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local") return;
  if (ch.jobs) { JOBS = ch.jobs.newValue || {}; render(); }
  if (ch.syncStatus) { SYNC = ch.syncStatus.newValue || {}; render(); }
  if (ch.lastRun || ch.lastAdded) updateAutoInfo();
  if (ch.answers) {
    ANSWERS = ch.answers.newValue || {};
    const editing = document.activeElement?.closest?.("#ansList");
    if (!editing) renderAnswers();
  }
});

/* --------------------------------- init ---------------------------------- */
chrome.storage.local.get(
  ["jobs", "profile", "searches", "autoDaily", "autoAdvance", "answers", "syncStatus", "botUrl", "apiToken"],
  (d) => {
    // v1 array ho to SW migrate karega; popup tab tak khali dikhata hai
    JOBS = Array.isArray(d.jobs) ? {} : (d.jobs || {});
    PROFILE = d.profile || {};
    SEARCHES = d.searches || [];
    ANSWERS = d.answers || {};
    SYNC = d.syncStatus || {};

    $("autoDaily").checked = !!d.autoDaily;
    $("autoAdvance").checked = !!d.autoAdvance;
    $("s_url").value = d.botUrl || "http://localhost:4000";
    $("s_token").value = d.apiToken || "";
    for (const [k, id] of Object.entries({
      name: "p_name", email: "p_email", phone: "p_phone", portfolio: "p_portfolio",
      pitch: "p_pitch", expTitle: "p_exptitle", expCompany: "p_expcompany", interview: "p_interview",
    })) $(id).value = PROFILE[k] || "";

    render();
    renderSearches();
    renderAnswers();
    updateAutoInfo();
    send("ping").catch(() => {});     // sync badge refresh
  }
);
