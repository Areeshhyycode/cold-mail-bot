/* Job Apply Assistant — background service worker (ES MODULE).
 *
 * Ye ab extension ka DIMAAG hai. Pehle popup aur SW dono `storage.jobs` likhte
 * the — dono poori array overwrite karte the, to jo doosre ne likha tha wo
 * chup-chaap gum ho jata tha (auto-scan har 2.5s pe likhta tha → race guaranteed).
 *
 * AB: `jobs` ka SIRF EK writer hai — ye file. Popup message bhejta hai
 * ({cmd:"..."}), SW state badalta hai, popup storage.onChanged se re-render karta
 * hai. Ek writer = koi lost update nahi.
 *
 * Extractor duplication bhi khatam: lib/extractor.js se IMPORT hota hai aur
 * function reference executeScript ko diya jata hai (wo self-contained hai).
 * Ek jagah selector fix = popup + auto-scrape dono theek.
 *
 * Queues (dono storage me — SW restart pe zinda rehti hain):
 *   syncQueue   — jo jobs abhi MongoDB me nahi gaye (backend offline tha)
 *   enrichQueue — jo jobs sirf card-level hain (detail page abhi visit nahi hui)
 *
 * MV3 note: SW ~30s idle pe mar jata hai. Isliye lamba kaam BATCHES me hota hai
 * aur har step ke baad state storage me likhi jati hai — beech me SW mar jaye to
 * agli alarm pe wahin se chalu ho jata hai. Kuch loss nahi hota.
 */
import { extractCards, extractDetail } from "./lib/extractor.js";
import {
  normalizeJob, dedupeKey, fingerprint, extractAtsId, detectAts,
  classify, fitScore, sleep, DEAD_STATUSES,
} from "./lib/core.js";
import { postJobs, patchJobStatus, ping, answerQuestion, ApiError } from "./lib/api.js";

/* --------------------------------- config -------------------------------- */
const ALARM_SCRAPE = "daily-scrape";
const ALARM_SYNC = "sync-queue";
const ALARM_ENRICH = "enrich-queue";

const SCRAPE_COOLDOWN_MS = 4 * 60 * 60 * 1000; // startup auto-scrape throttle
const PAGE_SETTLE_MS = 2500;                   // JS-rendered cards ko load hone do
const ENRICH_BATCH = 5;                        // ek alarm tick me kitni jobs enrich
const ENRICH_MIN_MS = 3000;                    // detail pages ke beech RANDOM gap —
const ENRICH_MAX_MS = 8000;                    // LinkedIn rate-limit se bachne ke liye
const MAX_ENRICH_ATTEMPTS = 2;
const SYNC_BATCH = 40;                         // ek POST me kitni jobs
const MAX_JOBS = 800;                          // storage quota guard (5MB limit)

const get = (keys) => new Promise((r) => chrome.storage.local.get(keys, r));
const set = (obj) => new Promise((r) => chrome.storage.local.set(obj, r));
const jitter = (a, b) => a + Math.random() * (b - a);

/* ------------------------------ state helpers ---------------------------- */
/* jobs ab ARRAY nahi, MAP hai: { [dedupeKey]: record }. Dedupe O(1), aur ek job
   update karne ke liye poori list rewrite nahi karni parti. */
async function loadJobs() {
  const { jobs } = await get(["jobs"]);
  if (Array.isArray(jobs)) return migrate(jobs);   // purana v1 format
  return jobs || {};
}

/* v1 (array of {title,company,location,link}) → v2 (map of full records).
   Purani list zaya NAHI hoti — sab kuch naye shape me aa jata hai. */
function migrate(arr) {
  const map = {};
  for (const old of arr) {
    const rec = wrap({
      title: old.title, company: old.company, location: old.location,
      url: old.link || old.url,
    }, "migrated");
    if (old.applied) rec.status = "applied";
    else if (old.skipped) rec.status = "ignored";
    map[rec.dedupeKey] = rec;
  }
  return map;
}

/** raw scraped job → stored record (meta + dedupe keys + lifecycle) */
function wrap(raw, source) {
  const j = normalizeJob(raw);
  if (!j.atsPlatform) j.atsPlatform = detectAts(j.url);
  if (!j.atsId) j.atsId = extractAtsId(j.url);
  if (!j.seniority) j.seniority = classify(`${j.title || ""} ${j.description || ""}`);
  const now = new Date().toISOString();
  return {
    ...j,
    dedupeKey: dedupeKey(j),
    fingerprint: fingerprint(j),
    source: source || null,
    firstSeen: now,
    lastUpdated: now,
    status: "new",
    statusHistory: [{ status: "new", at: now }],
    fit: fitScore(j),
    enriched: !!j.description,
    enrichAttempts: 0,
    syncState: "pending",   // pending | synced | error
    syncError: null,
    ai: null,               // backend bhejta hai (match score, missing skills, …)
  };
}

/** Naye scraped jobs state me merge karo. Duplicate = same dedupeKey YA same
 *  fingerprint (alag URL, wahi job — Phase 8). Purana record UPDATE hota hai
 *  (naye fields se), overwrite NAHI — user ka status/history bach jata hai. */
async function mergeJobs(rawJobs, source) {
  const jobs = await loadJobs();
  const fps = new Map();
  for (const [k, r] of Object.entries(jobs)) if (r.fingerprint) fps.set(r.fingerprint, k);

  const added = [];
  const updated = [];
  const NEVER_OVERWRITE = new Set(["dedupeKey", "fingerprint", "firstSeen", "status",
    "statusHistory", "syncState", "syncError", "ai", "enrichAttempts", "enriched", "source"]);

  for (const raw of rawJobs) {
    if (!raw || !raw.title || !raw.url) continue;
    const rec = wrap(raw, source);

    const existingKey = jobs[rec.dedupeKey]
      ? rec.dedupeKey
      : (rec.fingerprint && fps.get(rec.fingerprint)) || null;

    if (existingKey) {
      const cur = jobs[existingKey];
      const merged = { ...cur };
      let changed = false;
      for (const [k, v] of Object.entries(rec)) {
        if (NEVER_OVERWRITE.has(k)) continue;
        const empty = cur[k] == null || cur[k] === "" || (Array.isArray(cur[k]) && !cur[k].length);
        const hasNew = v != null && v !== "" && (!Array.isArray(v) || v.length);
        if (empty && hasNew) { merged[k] = v; changed = true; }
      }
      if (!changed) continue;                     // kuch naya nahi — sync mat karo
      merged.lastUpdated = new Date().toISOString();
      merged.fit = fitScore(merged);
      merged.syncState = "pending";
      jobs[existingKey] = merged;
      updated.push(existingKey);
      continue;
    }

    jobs[rec.dedupeKey] = rec;
    fps.set(rec.fingerprint, rec.dedupeKey);
    added.push(rec.dedupeKey);
  }

  await saveJobs(jobs);
  const touched = [...added, ...updated];
  if (touched.length) {
    await enqueue("syncQueue", touched);
    await enqueue(
      "enrichQueue",
      touched.filter((k) => jobs[k] && !jobs[k].enriched && !DEAD_STATUSES.has(jobs[k].status))
    );
    kickSync();
  }
  return { added: added.length, updated: updated.length };
}

/** Storage quota guard (5MB). Sirf wo jobs prune hoti hain jo SYNCED hain
 *  (yaani MongoDB me mehfooz) aur jinpe koi kaam nahi hua. "No scraped job
 *  should ever be lost" — UNSYNCED job kabhi delete nahi hoti. */
async function saveJobs(jobs) {
  const keys = Object.keys(jobs);
  if (keys.length > MAX_JOBS) {
    const prunable = keys
      .filter((k) => jobs[k].syncState === "synced" &&
        (DEAD_STATUSES.has(jobs[k].status) || jobs[k].status === "new"))
      .sort((a, b) => new Date(jobs[a].lastUpdated) - new Date(jobs[b].lastUpdated));
    for (const k of prunable.slice(0, keys.length - MAX_JOBS)) delete jobs[k];
  }
  await set({ jobs });
}

/* -------------------------------- queues --------------------------------- */
async function enqueue(name, keys) {
  if (!keys || !keys.length) return;
  const d = await get([name]);
  const q = new Set(d[name] || []);
  for (const k of keys) q.add(k);
  await set({ [name]: [...q] });
}
async function dequeue(name, n) {
  const d = await get([name]);
  const q = d[name] || [];
  await set({ [name]: q.slice(n) });
  return q.slice(0, n);
}
async function setSyncStatus(patch) {
  const { syncStatus = {} } = await get(["syncStatus"]);
  await set({ syncStatus: { ...syncStatus, ...patch } });
}

/* ================================ SCRAPING ================================ */
function waitForComplete(tabId, timeoutMs = 25000) {
  return new Promise((resolve) => {
    let done = false;
    let timer;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);                        // pehle ye timer leak hota tha
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => { if (id === tabId && info.status === "complete") finish(); };
    chrome.tabs.onUpdated.addListener(listener);
    timer = setTimeout(finish, timeoutMs);
  });
}

/** Ek URL background tab me kholo, extractor chalao, tab band karo. */
async function scrapeInTab(url, func) {
  if (!/^https?:\/\//i.test(url)) return null;
  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await waitForComplete(tab.id);
    await sleep(PAGE_SETTLE_MS);
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func });
    return (res && res.result) || null;
  } catch {
    return null;
  } finally {
    if (tab && tab.id) { try { await chrome.tabs.remove(tab.id); } catch { /* band ho chuka */ } }
  }
}

let SCRAPING = false;
async function autoScrape(reason, force = false) {
  if (SCRAPING) return 0;
  const { autoDaily, searches = [], lastRun = 0 } = await get(["autoDaily", "searches", "lastRun"]);
  if (!force && !autoDaily) return 0;
  if (!searches.length) return 0;
  if (reason === "startup" && !force && Date.now() - lastRun < SCRAPE_COOLDOWN_MS) return 0;

  SCRAPING = true;
  let added = 0;
  try {
    for (const url of searches) {
      const found = await scrapeInTab(url, extractCards);
      if (!found || !found.length) continue;
      const r = await mergeJobs(found, hostOf(url));
      added += r.added;
    }
    await set({ lastRun: Date.now(), lastAdded: added, lastReason: reason });
    if (added) notify(`🎯 ${added} new job${added === 1 ? "" : "s"} mile — popup khol ke dekho.`);
    return added;
  } finally {
    SCRAPING = false;
  }
}

const hostOf = (u) => { try { return new URL(u).hostname; } catch { return null; } };

/** Popup ka "Scan this page".
 *  tabId POPUP se aata hai — SW me `chrome.tabs.query({currentWindow:true})`
 *  bharosemand nahi hai (service worker ka koi window nahi hota). */
async function scanActiveTab({ tabId, url }) {
  if (!tabId || !/^https?:/i.test(url || "")) {
    throw new Error("Is tab pe scan nahi ho sakta (chrome:// page?)");
  }
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: extractCards });
  const found = (res && res.result) || [];
  if (!found.length) return { added: 0, updated: 0 };
  return mergeJobs(found, hostOf(url));
}

/* =============================== ENRICHMENT ============================== */
/* Detail page se poora record (30+ fields). THROTTLED — ek waqt me ek tab,
   beech me 3–8s ka random gap. LinkedIn tez-tez job pages kholne pe account
   restrict kar deta hai, isliye ye jaan-boojh ke dheema hai. */
let ENRICHING = false;
async function runEnrichQueue() {
  if (ENRICHING) return;
  ENRICHING = true;
  try {
    const keys = await dequeue("enrichQueue", ENRICH_BATCH);
    if (!keys.length) return;

    for (const key of keys) {
      const jobs = await loadJobs();
      const rec = jobs[key];
      if (!rec || rec.enriched || DEAD_STATUSES.has(rec.status)) continue;
      if ((rec.enrichAttempts || 0) >= MAX_ENRICH_ATTEMPTS) continue;

      const detail = await scrapeInTab(rec.url, extractDetail);

      const fresh = await loadJobs();             // beech me user ne status badla ho sakta hai
      const cur = fresh[key];
      if (!cur) continue;
      cur.enrichAttempts = (cur.enrichAttempts || 0) + 1;
      if (detail && (detail.description || detail.salary)) Object.assign(cur, applyDetail(cur, detail));
      cur.lastUpdated = new Date().toISOString();
      cur.syncState = "pending";
      await saveJobs(fresh);
      await enqueue("syncQueue", [key]);

      await sleep(jitter(ENRICH_MIN_MS, ENRICH_MAX_MS));
    }
    kickSync();
  } finally {
    ENRICHING = false;
  }
}

/** Detail-page data record pe chadhao. Khali fields bharo; kuch fields
 *  (description, salary, skills…) detail page pe HAMESHA zyada bharosemand hain
 *  card ke muqable — wo overwrite karte hain. */
const AUTHORITATIVE = new Set([
  "description", "companyDescription", "salary", "salaryMin", "salaryMax",
  "salaryCurrency", "salaryPeriod", "skills", "technologies", "benefits",
  "responsibilities", "requirements", "preferredQualifications",
  "recruiterName", "recruiterProfile", "applicantCount", "experienceRequired",
  "employmentType", "workMode", "companyLogo", "companyWebsite", "companyLinkedin",
]);
function applyDetail(cur, detail) {
  const d = normalizeJob(detail);
  const out = { ...cur };
  for (const [k, v] of Object.entries(d)) {
    const hasNew = v != null && v !== "" && (!Array.isArray(v) || v.length);
    if (!hasNew) continue;
    const empty = out[k] == null || out[k] === "" || (Array.isArray(out[k]) && !out[k].length);
    if (empty || AUTHORITATIVE.has(k)) out[k] = v;
  }
  if (out.description) {
    out.seniority = classify(`${out.title || ""} ${out.description}`);
    out.enriched = true;
  }
  out.fit = fitScore(out);
  return out;
}

/* ================================== SYNC ================================= */
/* Phase 4 — retry queue. Backend offline ho to jobs storage me `pending` rehti
   hain aur har 5 min (ya jab bhi kuch naya aaye) dobara koshish hoti hai.
   Koi job kabhi gum nahi hoti. */
let SYNCING = false;
let syncTimer = null;
function kickSync() {                              // debounce — burst me ek hi sync
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => runSyncQueue().catch(() => {}), 1200);
}

async function runSyncQueue() {
  if (SYNCING) return;
  SYNCING = true;
  try {
    const { syncQueue = [] } = await get(["syncQueue"]);
    if (!syncQueue.length) { await setSyncStatus({ pending: 0 }); return; }

    const jobs = await loadJobs();
    const batch = syncQueue.slice(0, SYNC_BATCH);
    const payload = batch.map((k) => jobs[k]).filter(Boolean);

    if (!payload.length) {                         // queue me dead keys thi
      await set({ syncQueue: syncQueue.slice(batch.length) });
      return;
    }

    try {
      const res = await postJobs(payload);
      const fresh = await loadJobs();
      for (const k of batch) {
        if (!fresh[k]) continue;
        fresh[k].syncState = "synced";
        fresh[k].syncError = null;
        const r = res && res.results && res.results.find((x) => x.dedupeKey === k);
        if (r && r.ai) fresh[k].ai = r.ai;         // backend ne AI analysis bhi bhej di
      }
      await saveJobs(fresh);

      const { syncQueue: nowQ = [] } = await get(["syncQueue"]);
      const rest = nowQ.filter((k) => !batch.includes(k));
      await set({ syncQueue: rest });
      await setSyncStatus({
        online: true, lastSync: Date.now(), pending: rest.length, lastError: null,
      });
      if (rest.length) kickSync();                 // aur baaki hai — chalte raho
    } catch (e) {
      const retryable = !(e instanceof ApiError) || e.retryable;
      await setSyncStatus({
        online: false, pending: syncQueue.length,
        lastError: e.message, lastErrorAt: Date.now(),
      });
      if (!retryable) {
        // 401 (ghalat token) / 400 (kharab payload) — retry bekaar hai. Queue se
        // hatao, par job storage me RAHEGI (error mark ke saath) — gum nahi hogi.
        // Popup ka "Retry failed" button inhe wapas queue me daal deta hai.
        const fresh = await loadJobs();
        for (const k of batch) {
          if (fresh[k]) { fresh[k].syncState = "error"; fresh[k].syncError = e.message; }
        }
        await saveJobs(fresh);
        await set({ syncQueue: syncQueue.filter((k) => !batch.includes(k)) });
      }
      // retryable → queue jyun ki tyun, agli alarm pe phir koshish
    }
  } finally {
    SYNCING = false;
  }
}

/** error-state jobs ko queue me wapas daalo (popup ka "Retry" button) */
async function retryFailed() {
  const jobs = await loadJobs();
  const failed = Object.keys(jobs).filter((k) => jobs[k].syncState === "error");
  for (const k of failed) { jobs[k].syncState = "pending"; jobs[k].syncError = null; }
  await saveJobs(jobs);
  await enqueue("syncQueue", failed);
  await runSyncQueue();
  return failed.length;
}

/* ============================== STATUS / CRUD ============================ */
async function setStatus(key, status, note) {
  const jobs = await loadJobs();
  const rec = jobs[key];
  if (!rec) throw new Error("Job nahi mili");
  const now = new Date().toISOString();
  rec.status = status;
  rec.statusHistory = [...(rec.statusHistory || []), { status, at: now, note: note || null }];
  rec.lastUpdated = now;
  rec.syncState = "pending";
  await saveJobs(jobs);
  await enqueue("syncQueue", [key]);
  patchJobStatus(key, status, note).catch(() => {});  // offline ho to queue sambhal legi
  kickSync();
  return rec;
}

async function deleteJob(key) {
  const jobs = await loadJobs();
  delete jobs[key];
  await saveJobs(jobs);
  const { syncQueue = [], enrichQueue = [] } = await get(["syncQueue", "enrichQueue"]);
  await set({
    syncQueue: syncQueue.filter((k) => k !== key),
    enrichQueue: enrichQueue.filter((k) => k !== key),
  });
  return { ok: true };
}

async function clearJobs() {
  await set({ jobs: {}, syncQueue: [], enrichQueue: [] });
  await setSyncStatus({ pending: 0 });
  return { ok: true };
}

/* ------------------------------ notifications ---------------------------- */
function notify(message) {
  chrome.notifications.create("jaa-" + Date.now(), {
    type: "basic", iconUrl: "icon.png", title: "Job Apply Assistant",
    message, priority: 1,
  }, (id) => setTimeout(() => chrome.notifications.clear(id), 12000));
}

/* --------------------------------- alarms -------------------------------- */
async function syncAlarms() {
  const { autoDaily } = await get(["autoDaily"]);
  if (autoDaily) chrome.alarms.create(ALARM_SCRAPE, { periodInMinutes: 1440 });
  else chrome.alarms.clear(ALARM_SCRAPE);
  // sync + enrich hamesha on — queue khali ho to no-op (sasta hai)
  chrome.alarms.create(ALARM_SYNC, { periodInMinutes: 5 });
  chrome.alarms.create(ALARM_ENRICH, { periodInMinutes: 1 });
}

chrome.runtime.onStartup.addListener(async () => {
  await syncAlarms();
  await autoScrape("startup");
  runSyncQueue().catch(() => {});
});

chrome.runtime.onInstalled.addListener(async () => {
  await syncAlarms();
  await set({ jobs: await loadJobs() });   // v1 array → v2 map migration (idempotent)
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM_SCRAPE) autoScrape("alarm").catch(() => {});
  if (a.name === ALARM_SYNC) runSyncQueue().catch(() => {});
  if (a.name === ALARM_ENRICH) runEnrichQueue().catch(() => {});
});

chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && ch.autoDaily) syncAlarms();
});

chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith("jaa-") && chrome.action && typeof chrome.action.openPopup === "function") {
    chrome.action.openPopup().catch(() => {});
  }
});

/* ------------------------------ message bus ------------------------------ */
/* Popup aur content script SIRF yahan se state badalte hain. */
const HANDLERS = {
  scanTab: (m) => scanActiveTab(m),
  scrapeNow: () => autoScrape("manual", true).then((added) => ({ added })),
  syncNow: async () => { await runSyncQueue(); return (await get(["syncStatus"])).syncStatus || {}; },
  retryFailed: () => retryFailed().then((n) => ({ retried: n })),
  enrichNow: async (m) => { await enqueue("enrichQueue", [m.key]); await runEnrichQueue(); return { ok: true }; },
  setStatus: (m) => setStatus(m.key, m.status, m.note),
  deleteJob: (m) => deleteJob(m.key),
  clearJobs: () => clearJobs(),
  // content script kisi job detail page pe hai → MUFT enrichment (koi extra tab nahi)
  pageDetail: (m) => mergeJobs([m.job], m.source || "page"),
  // apply-form ka sawaal → backend se AI jawab. Content script KHUD fetch nahi
  // karta: API token SW me rehta hai, job-site page me nahi (agar page compromise
  // ho to token leak na ho).
  answerQuestion: (m) => answerQuestion(m.question, m.maxLen),
  ping: async () => {
    try { await ping(); await setSyncStatus({ online: true, lastError: null }); return { online: true }; }
    catch (e) { await setSyncStatus({ online: false, lastError: e.message }); return { online: false, error: e.message }; }
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const fn = msg && HANDLERS[msg.cmd];
  if (!fn) return false;
  Promise.resolve(fn(msg))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: e.message }));
  return true; // async response
});
