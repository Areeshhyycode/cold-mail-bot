/**
 * JOBS API — Phase 4 (sync), 5 (history), 6 (dashboard), 7 (resume), 8 (dedupe).
 *
 * Endpoints (sab /api/ ke neeche, sab Bearer-token protected):
 *   POST /api/jobs            bulk upsert (extension → MongoDB)
 *   POST /api/jobs/status     ek job ka status badlo (+ history)
 *   GET  /api/jobs            list + search + filters (dashboard)
 *   GET  /api/jobs/stats      counters (dashboard cards)
 *   GET  /api/jobs/analysis   ek job ka AI analysis (cache hit ya generate)
 *   POST /api/jobs/tailor     tailored resume + cover letter (Phase 7, on-demand)
 *   GET  /api/health          ping (extension sync badge)
 *
 * Ye file plain Node `http` ke saath chalti hai (koi Express add nahi kiya —
 * project ki koi HTTP dependency nahi thi aur ek route table kaafi hai).
 */
import { Job } from "../db/Job.js";
import { enqueueAnalysis, queueStats } from "../core/analysisQueue.js";
import { tailorResume } from "../ai/jobAnalyzer.js";
import { vStr, vNum, vBool, vArr, vEnum, vUrl } from "../core/httpAuth.js";

const STATUSES = ["new", "saved", "applied", "ignored", "archived", "rejected", "interview", "offer", "accepted"];
const SENIORITY = ["internship", "junior", "mid", "senior", "junk"];
const WORK_MODES = ["remote", "hybrid", "onsite"];

/* --------------------------- input sanitization --------------------------- */
/* Extension se aaya data = SCRAPED data = untrusted. Har field validate hoti hai
   (Phase 10). Jo field ghalat ho wo null ho jati hai, poora job reject nahi hota —
   warna ek kharab salary string poori job kho deti. */
function sanitizeJob(raw = {}) {
  const url = vUrl(raw.url);
  const title = vStr(raw.title, 300);
  if (!url || !title) return null;                 // ye do laazmi hain

  const dedupeKey = vStr(raw.dedupeKey, 400);
  if (!dedupeKey) return null;

  return {
    dedupeKey,
    fingerprint: vStr(raw.fingerprint, 400),
    url,
    jobId: vStr(raw.jobId, 100),
    atsId: vStr(raw.atsId, 100),
    atsPlatform: vStr(raw.atsPlatform, 40),

    title,
    company: vStr(raw.company, 200),
    companyLogo: vUrl(raw.companyLogo),
    companyWebsite: vUrl(raw.companyWebsite),
    companyLinkedin: vUrl(raw.companyLinkedin),
    companyDescription: vStr(raw.companyDescription, 4000),

    salary: vStr(raw.salary, 200),
    salaryCurrency: vStr(raw.salaryCurrency, 10),
    salaryMin: vNum(raw.salaryMin, 0, 1e9),
    salaryMax: vNum(raw.salaryMax, 0, 1e9),
    salaryPeriod: vEnum(raw.salaryPeriod, ["hour", "day", "week", "month", "year"]),

    experienceRequired: vStr(raw.experienceRequired, 120),
    skills: vArr(raw.skills, 30, 80),
    technologies: vArr(raw.technologies, 30, 80),
    employmentType: vStr(raw.employmentType, 60),
    seniority: vEnum(raw.seniority, SENIORITY),
    workMode: vEnum(raw.workMode, WORK_MODES),

    location: vStr(raw.location, 200),
    country: vStr(raw.country, 80),
    city: vStr(raw.city, 80),

    benefits: vArr(raw.benefits, 20, 200),
    recruiterName: vStr(raw.recruiterName, 120),
    recruiterProfile: vUrl(raw.recruiterProfile),
    datePosted: vStr(raw.datePosted, 60),
    applicantCount: vNum(raw.applicantCount, 0, 1e6),
    easyApply: vBool(raw.easyApply),

    description: vStr(raw.description, 30000),
    responsibilities: vArr(raw.responsibilities, 25, 400),
    requirements: vArr(raw.requirements, 25, 400),
    preferredQualifications: vArr(raw.preferredQualifications, 20, 400),

    fit: vNum(raw.fit, 0, 100) ?? 0,
    source: vStr(raw.source, 100),
    enriched: vBool(raw.enriched) ?? false,
    status: vEnum(raw.status, STATUSES) || "new",
  };
}

/* ============================ POST /api/jobs ============================== */
/**
 * Bulk upsert. Phase 8 — duplicate KABHI dobara insert nahi hoti:
 *   1. dedupeKey pe unique index → same job = same doc (upsert).
 *   2. dedupeKey na mile to fingerprint (company|title|city) check → agar wahi
 *      job kisi aur URL se aayi hai to USI doc ko update karte hain, naya nahi
 *      banate. (LinkedIn pe mili job + company career page pe wahi job.)
 *
 * Upsert par:
 *   - naye/khali fields bhar dete hain (enrichment ka data)
 *   - user ka `status`/`statusHistory` KABHI overwrite nahi hota (extension ka
 *     status sirf tab lagta hai jab doc naya ho)
 *   - description aayi to AI analysis dobara queue hoti hai (behtar data = behtar score)
 */
export async function postJobs(body) {
  const list = Array.isArray(body?.jobs) ? body.jobs : [];
  if (!list.length) return { ok: true, upserted: 0, duplicates: 0, results: [] };
  if (list.length > 200) throw new HttpError("Ek baar me 200 se zyada jobs nahi", 400);

  const results = [];
  let upserted = 0;
  let duplicates = 0;

  for (const raw of list) {
    const j = sanitizeJob(raw);
    if (!j) { results.push({ dedupeKey: raw?.dedupeKey || null, error: "invalid job (url/title/key missing)" }); continue; }

    // 1) strong key
    let doc = await Job.findOne({ dedupeKey: j.dedupeKey });

    // 2) weak key — wahi job, alag URL se
    if (!doc && j.fingerprint && j.company && j.title) {
      doc = await Job.findOne({ fingerprint: j.fingerprint });
      if (doc) duplicates++;
    }

    const isNew = !doc;
    const hadDescription = !!(doc && doc.description);

    if (isNew) {
      doc = new Job({
        ...j,
        firstSeen: new Date(),
        lastUpdated: new Date(),
        statusHistory: [{ status: j.status, at: new Date() }],
        aiStatus: "pending",
      });
    } else {
      // sirf khali fields bharo + authoritative fields refresh karo.
      // status / statusHistory / ai ko HAATH NAHI lagate — wo user ka data hai.
      for (const [k, v] of Object.entries(j)) {
        if (["status", "statusHistory", "dedupeKey", "firstSeen"].includes(k)) continue;
        const cur = doc[k];
        const curEmpty = cur == null || cur === "" || (Array.isArray(cur) && cur.length === 0);
        const hasNew = v != null && v !== "" && (!Array.isArray(v) || v.length > 0);
        if (hasNew && (curEmpty || AUTHORITATIVE.has(k))) doc[k] = v;
      }
      doc.lastUpdated = new Date();
    }

    await doc.save();
    upserted++;

    // AI analysis — Phase 3. Har naye job pe (tumne "auto-analyze every job"
    // choose kiya). Aur agar description ab AAYI hai (enrichment) par pehle
    // analysis sirf title pe hui thi, to dobara — behtar data, behtar score.
    const gotDescriptionNow = !hadDescription && !!doc.description;
    const needsAi = isNew || gotDescriptionNow || doc.aiStatus === "pending" || doc.aiStatus === "error";
    if (needsAi) {
      if (gotDescriptionNow && doc.aiStatus === "done") {
        await Job.updateOne({ _id: doc._id }, { $set: { aiStatus: "pending" } });
      }
      enqueueAnalysis(doc._id);
    }

    results.push({
      dedupeKey: doc.dedupeKey,
      id: String(doc._id),
      isNew,
      // agar analysis pehle se cache me hai to fauran wapas bhej do — extension
      // popup me turant match score dikhega, dobara maangna nahi padega
      ai: doc.aiStatus === "done" && doc.ai ? compactAi(doc.ai) : null,
    });
  }

  return { ok: true, upserted, duplicates, results, aiQueue: queueStats() };
}

/* description/salary jaise fields detail-page pe zyada bharosemand hain — inhe
   overwrite karne dete hain (card se aayi adhoori value ko). */
const AUTHORITATIVE = new Set([
  "description", "companyDescription", "salary", "salaryMin", "salaryMax",
  "salaryCurrency", "salaryPeriod", "skills", "technologies", "benefits",
  "responsibilities", "requirements", "preferredQualifications",
  "recruiterName", "recruiterProfile", "applicantCount", "experienceRequired",
  "employmentType", "workMode", "companyLogo", "companyWebsite", "companyLinkedin",
  "fit", "enriched",
]);

/** popup ke liye chhota AI payload (poora resume text nahi bhejte — bhaari hai) */
function compactAi(ai) {
  if (!ai) return null;
  return {
    matchScore: ai.matchScore ?? null,
    missingSkills: ai.missingSkills || [],
    strengths: ai.strengths || [],
    weaknesses: ai.weaknesses || [],
    resumeSuggestions: ai.resumeSuggestions || [],
    interviewDifficulty: ai.interviewDifficulty || null,
    salaryEstimate: ai.salaryEstimate || null,
    companySummary: ai.companySummary || null,
    verdict: ai.verdict || null,
    reasoning: ai.reasoning || null,
    basedOn: ai.basedOn || null,
  };
}

/* ========================= POST /api/jobs/status ========================== */
/** Phase 5 — status + full history. Har change history me append hota hai. */
export async function postStatus(body) {
  const key = vStr(body?.dedupeKey, 400);
  const status = vEnum(body?.status, STATUSES);
  const note = vStr(body?.note, 500);
  if (!key || !status) throw new HttpError("dedupeKey aur valid status chahiye", 400);

  const doc = await Job.findOne({ dedupeKey: key });
  if (!doc) throw new HttpError("Job nahi mili", 404);

  doc.status = status;
  doc.statusHistory.push({ status, at: new Date(), note });
  doc.lastUpdated = new Date();
  await doc.save();                       // pre-save hook appliedAt stamp karta hai

  return { ok: true, status: doc.status, history: doc.statusHistory.length };
}

/* ============================= GET /api/jobs ============================== */
/** Phase 6 — dashboard list. Search + saare filters. */
export async function listJobs(params) {
  const q = {};
  const search = vStr(params.get("q"), 120);
  if (search) {
    const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    q.$or = [{ title: re }, { company: re }, { location: re }, { skills: re }, { description: re }];
  }
  const status = params.get("status");
  if (status && status !== "all") q.status = { $in: status.split(",").filter((s) => STATUSES.includes(s)) };

  const workMode = params.get("workMode");
  if (workMode && workMode !== "all") q.workMode = { $in: workMode.split(",").filter((m) => WORK_MODES.includes(m)) };

  const seniority = params.get("seniority");
  if (seniority && seniority !== "all") q.seniority = { $in: seniority.split(",").filter((s) => SENIORITY.includes(s)) };

  const company = vStr(params.get("company"), 120);
  if (company) q.company = new RegExp(company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

  const tech = vStr(params.get("tech"), 120);
  if (tech) {
    const re = new RegExp(tech.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    q.$and = [...(q.$and || []), { $or: [{ skills: re }, { technologies: re }, { description: re }] }];
  }

  const minScore = vNum(params.get("minScore"), 0, 100);
  if (minScore != null) q["ai.matchScore"] = { $gte: minScore };

  const minSalary = vNum(params.get("minSalary"), 0, 1e9);
  if (minSalary != null) q.salaryMin = { $gte: minSalary };

  const hasSalary = params.get("hasSalary");
  if (hasSalary === "1") q.salary = { $ne: null };

  const exp = vStr(params.get("experience"), 60);
  if (exp) q.experienceRequired = new RegExp(exp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

  const sortKey = params.get("sort") || "score";
  const sort = sortKey === "fit" ? { fit: -1 }
    : sortKey === "recent" ? { lastUpdated: -1 }
    : sortKey === "salary" ? { salaryMax: -1, salaryMin: -1 }
    : { "ai.matchScore": -1, fit: -1 };

  const limit = Math.min(vNum(params.get("limit"), 1, 500) || 100, 500);
  const skip = vNum(params.get("skip"), 0, 1e6) || 0;

  const [jobs, total] = await Promise.all([
    Job.find(q).sort(sort).skip(skip).limit(limit)
      .select("-description -statusHistory -ai.tailoredResume -ai.tailoredCoverLetter")
      .lean(),
    Job.countDocuments(q),
  ]);

  return { ok: true, total, count: jobs.length, jobs };
}

/* ========================== GET /api/jobs/stats =========================== */
export async function jobStats() {
  const [byStatus, bySeniority, byMode, totals] = await Promise.all([
    Job.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    Job.aggregate([{ $group: { _id: "$seniority", n: { $sum: 1 } } }]),
    Job.aggregate([{ $group: { _id: "$workMode", n: { $sum: 1 } } }]),
    Job.aggregate([{
      $group: {
        _id: null,
        total: { $sum: 1 },
        enriched: { $sum: { $cond: ["$enriched", 1, 0] } },
        analyzed: { $sum: { $cond: [{ $eq: ["$aiStatus", "done"] }, 1, 0] } },
        avgScore: { $avg: "$ai.matchScore" },
        strong: { $sum: { $cond: [{ $gte: ["$ai.matchScore", 70] }, 1, 0] } },
      },
    }]),
  ]);
  const t = totals[0] || {};
  return {
    ok: true,
    total: t.total || 0,
    enriched: t.enriched || 0,
    analyzed: t.analyzed || 0,
    strong: t.strong || 0,
    avgScore: t.avgScore ? Math.round(t.avgScore) : 0,
    byStatus: Object.fromEntries(byStatus.map((s) => [s._id || "unknown", s.n])),
    bySeniority: Object.fromEntries(bySeniority.map((s) => [s._id || "unknown", s.n])),
    byWorkMode: Object.fromEntries(byMode.map((s) => [s._id || "unknown", s.n])),
    aiQueue: queueStats(),
  };
}

/* ======================== GET /api/jobs/analysis ========================== */
/** Cache hit → fauran. Miss → queue me daal ke `pending` bata do (poll karo). */
export async function getAnalysis(params) {
  const key = vStr(params.get("key"), 400);
  if (!key) throw new HttpError("?key= (dedupeKey) chahiye", 400);
  const doc = await Job.findOne({ dedupeKey: key });
  if (!doc) throw new HttpError("Job nahi mili", 404);

  const force = params.get("force") === "1";
  if (doc.aiStatus === "done" && doc.ai && !force) {
    return { ok: true, status: "done", ai: compactAi(doc.ai) };
  }
  if (force) await Job.updateOne({ _id: doc._id }, { $set: { aiStatus: "pending" } });
  enqueueAnalysis(doc._id);
  return { ok: true, status: "pending", ai: null };
}

/* ========================= POST /api/jobs/tailor ========================== */
/** Phase 7 — tailored resume + cover letter. Mehnga call hai, isliye cache.
 *  `force:true` bhejo to dobara generate hota hai. */
export async function postTailor(body) {
  const key = vStr(body?.dedupeKey, 400);
  if (!key) throw new HttpError("dedupeKey chahiye", 400);
  const doc = await Job.findOne({ dedupeKey: key });
  if (!doc) throw new HttpError("Job nahi mili", 404);

  if (!body?.force && doc.ai && doc.ai.tailoredResume) {
    return {
      ok: true, cached: true,
      tailoredResume: doc.ai.tailoredResume,
      tailoredCoverLetter: doc.ai.tailoredCoverLetter,
    };
  }

  const out = await tailorResume(doc.toObject());
  doc.ai = { ...(doc.ai ? doc.ai.toObject() : {}), ...out };
  doc.lastUpdated = new Date();
  await doc.save();

  return { ok: true, cached: false, ...out };
}

/* -------------------------------- helper --------------------------------- */
export class HttpError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}
