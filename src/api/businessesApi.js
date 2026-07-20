/**
 * BUSINESSES API (Phase 11) — lead-finder ke REST handlers.
 *
 * dashboard/server.js in functions ko routes se jodta hai. Wahi HttpError +
 * validation helpers use karte hain jo jobs API karta hai (consistency).
 *
 * Ye module SIRF parhta/refresh karta hai. Koi outreach nahi.
 */
import { Business } from "../db/Business.js";
import { scanArea, processBusiness } from "../modules/leadfinder/scan.js";
import { vStr, vNum } from "../core/httpAuth.js";
import { log } from "../core/logger.js";
// SAME HttpError class as jobsApi — warna server.js ka `err instanceof HttpError`
// mere errors ko na-pehchaan kar 500 de deta (404 ki jagah).
import { HttpError } from "./jobsApi.js";

export { HttpError };

/* ------------------------- GET /api/businesses --------------------------- */
/** Search + filter + pagination. Ye Phase 8 ki list/filter powers karta hai. */
export async function listBusinesses(params) {
  const q = {};

  const area = vStr(params.get("area"), 80);
  if (area) q.area = area;

  const category = vStr(params.get("category"), 40);
  if (category) q.ourCategory = category;

  // hasWebsite=false → "jinki website nahi" (user ka core filter)
  const hw = params.get("hasWebsite");
  if (hw === "true") q.hasWebsite = true;
  if (hw === "false") q.hasWebsite = false;

  if (params.get("hasWhatsapp") === "true") q.hasWhatsapp = true;
  if (params.get("hasEmail") === "true") q.hasEmail = true;

  const minScore = vNum(params.get("minScore"), 0, 100);
  if (minScore != null) q.score = { $gte: minScore };

  // free-text search business naam pe (case-insensitive)
  const text = vStr(params.get("q"), 100);
  if (text) q.businessName = { $regex: text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };

  const limit = vNum(params.get("limit"), 1, 500) || 100;
  const skip = vNum(params.get("skip"), 0, 1e6) || 0;

  const [items, total] = await Promise.all([
    Business.find(q).sort({ score: -1, updatedAt: -1 }).skip(skip).limit(limit).lean(),
    Business.countDocuments(q),
  ]);

  return { total, count: items.length, skip, limit, businesses: items };
}

/* ----------------------- GET /api/businesses/:id ------------------------- */
/** Ek business — audit + score + contacts sab embedded hain, isliye ek hi call. */
export async function getBusiness(id) {
  const b = await Business.findById(id).lean().catch(() => null);
  if (!b) throw new HttpError("Business nahi mila", 404);
  return b;
}

/** GET /api/businesses/:id/contacts — Phase 6 output */
export async function getContacts(id) {
  const b = await Business.findById(id).select("businessName contacts hasEmail hasWhatsapp").lean().catch(() => null);
  if (!b) throw new HttpError("Business nahi mila", 404);
  return { businessName: b.businessName, hasEmail: b.hasEmail, hasWhatsapp: b.hasWhatsapp, contacts: b.contacts || [] };
}

/* --------------------- POST /api/businesses/:id/refresh ------------------ */
/** Ek business ka website audit + contacts + score DOBARA nikaalo (website badla
 *  ho sakta hai, ya pehle down thi). Poora area re-scan kiye baghair. */
export async function refreshBusiness(id) {
  const b = await Business.findById(id).lean().catch(() => null);
  if (!b) throw new HttpError("Business nahi mila", 404);

  // stored Maps data ko wapas "raw" shape me de kar usi pipeline se guzaaro
  const raw = {
    businessName: b.businessName, website: b.website, phone: (b.contacts || []).find((c) => c.type === "phone")?.value || "",
    category: b.category, address: b.address, rating: b.rating, reviews: b.reviews,
    hours: b.hours, closed: b.closed, lat: b.lat, lng: b.lng, mapsUrl: b.mapsUrl,
  };
  const doc = await processBusiness(raw, b.area);
  await Business.updateOne({ _id: id }, { $set: doc });
  log.info("business.refreshed", { id, score: doc.score });
  return { ...b, ...doc };
}

/* ----------------------------- GET /api/businesses/stats ----------------- */
/** Phase 8 ke widgets. */
export async function businessStats() {
  const [total, noWebsite, poorWebsite, withEmail, withWhatsapp, highOpp, byArea, byCategory] =
    await Promise.all([
      Business.countDocuments(),
      Business.countDocuments({ hasWebsite: false }),
      Business.countDocuments({ hasWebsite: true, websiteQuality: { $in: ["outdated", "none"] } }),
      Business.countDocuments({ hasEmail: true }),
      Business.countDocuments({ hasWhatsapp: true }),
      Business.countDocuments({ score: { $gte: 60 } }),
      Business.aggregate([{ $group: { _id: "$area", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 20 }]),
      Business.aggregate([{ $group: { _id: "$ourCategory", n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
    ]);

  return {
    total, noWebsite, poorWebsite, withEmail, withWhatsapp, highOpp,
    areas: byArea.map((a) => ({ area: a._id || "?", count: a.n })),
    categories: byCategory.map((c) => ({ category: c._id || "other", count: c.n })),
  };
}

/* ----------------------------- POST /api/scan ---------------------------- */
/* Scan slow hai (Playwright, har business ka detail page). HTTP request ko block
 * nahi karte — background me chalao, status in-memory track karo, dashboard poll kare. */
const scans = new Map(); // scanId -> { area, status, found, created, updated, error, startedAt }
let scanCounter = 0;

export function startScan(body) {
  const area = vStr(body?.area, 80);
  if (!area) throw new HttpError("area chahiye", 400);
  const max = vNum(body?.max, 1, 60) || 20;

  const scanId = `scan_${Date.now()}_${++scanCounter}`;
  scans.set(scanId, { scanId, area, status: "running", startedAt: new Date().toISOString() });

  // fire-and-forget — result poll se milega
  scanArea(area, max)
    .then((r) => scans.set(scanId, { scanId, area, status: "done", ...r, businesses: undefined, finishedAt: new Date().toISOString() }))
    .catch((err) => {
      log.error("scan.api_fail", { area, error: err.message });
      scans.set(scanId, { scanId, area, status: "error", error: err.message });
    });

  return { scanId, area, status: "running" };
}

export function getScan(scanId) {
  const s = scans.get(scanId);
  if (!s) throw new HttpError("Scan id nahi mila (server restart hua?)", 404);
  return s;
}
