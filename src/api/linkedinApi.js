/**
 * LINKEDIN OUTREACH API — captured recruiters/HR + AI connection notes.
 *
 * Extension (user-initiated) ek profile capture karke POST /api/linkedin/capture
 * bhejta hai. Backend person save karta hai, priority nikaalta hai, aur AI note
 * generate karta hai. Dashboard /linkedin pe list dikhti hai: open profile, note
 * copy, status update (sent/connected). Bhejna user khud karti — koi auto-send NAHI.
 */
import { Person, rolePriority } from "../db/Person.js";
import { CareerProfile } from "../db/CareerProfile.js";
import { Job } from "../db/Job.js";
import { Lead } from "../db/Lead.js";
import { getMatchProfile } from "../ai/profileSkills.js";
import { generateConnectionNote } from "../ai/connectionNote.js";
import { HttpError } from "./jobsApi.js";
import { vStr } from "../core/httpAuth.js";

export { HttpError };

const cleanUrl = (u = "") => String(u).split("?")[0].replace(/\/$/, "");

/** current matching profile (default CV) — note personalize karne ko */
async function activeProfile() {
  const p = await getMatchProfile().catch(() => null);
  if (p) {
    // getMatchProfile { name, skills, ... } — fullName/title chahiye note ko
    const cp = await CareerProfile.findOne({ isDefault: true }).lean().catch(() => null);
    return {
      fullName: cp?.parsed?.fullName || "",
      name: p.name,
      title: cp?.parsed?.title || p.name,
      skills: p.skills || [],
    };
  }
  return { fullName: "", name: "candidate", title: "developer", skills: [] };
}

/* ===================== POST /api/linkedin/capture ====================== */
/** Extension se ek captured person. AI note bhi bana deta hai. */
export async function capturePerson(body) {
  const profileUrl = cleanUrl(vStr(body?.profileUrl, 300) || "");
  if (!/^https?:\/\/([a-z]+\.)?linkedin\.com\/in\//i.test(profileUrl)) {
    throw new HttpError("Valid LinkedIn profile URL chahiye (linkedin.com/in/...)", 400);
  }
  const name = vStr(body?.name, 120) || "";
  const role = vStr(body?.role, 200) || "";
  const company = vStr(body?.company, 160) || "";
  const location = vStr(body?.location, 120) || "";
  const jobTitle = vStr(body?.jobTitle, 160) || "";
  const jobUrl = vStr(body?.jobUrl, 400) || "";

  const { priority, priorityLabel } = rolePriority(role);

  // AI connection note (fail ho to fallback note module khud deta hai)
  const profile = await activeProfile();
  let note = "";
  try {
    note = await generateConnectionNote({ person: { name, role }, company, jobTitle, profile, maxLen: 280 });
  } catch { note = ""; }

  const doc = await Person.findOneAndUpdate(
    { profileUrl },
    {
      $set: {
        name, role, company, location, jobTitle, jobUrl,
        priority, priorityLabel,
        ...(note ? { note, noteAt: new Date() } : {}),
        status: note ? "note-ready" : "new",
        source: "linkedin-extension",
      },
      $setOnInsert: { capturedAt: new Date() },
    },
    { upsert: true, new: true }
  );

  return { ok: true, id: String(doc._id), person: shape(doc), note: doc.note };
}

/* ================ GET /api/linkedin/applied-companies ================== */
/**
 * Jin companies pe tumne apply kiya (Job: applied/interview/offer) + JOB leads
 * jinhe contact kiya — un sab ke liye ek LinkedIn HR-search link KHUD bana deta
 * hai. Ye "auto-find" ka SAFE hissa: system companies + searches tayyar karta hai;
 * browsing + connect tum karti ho (LinkedIn scraping/auto-connect = account ban).
 */
export async function appliedCompanies() {
  const [jobCos, leadCos] = await Promise.all([
    Job.distinct("company", { status: { $in: ["applied", "interview", "offer"] } }).catch(() => []),
    Lead.distinct("company", {
      leadType: "JOB",
      status: { $in: ["sent", "followup_1", "followup_2", "replied"] },
    }).catch(() => []),
  ]);

  // normalize + dedupe (case-insensitive), junk hatao
  const seen = new Map();
  for (const c of [...jobCos, ...leadCos]) {
    const name = String(c || "").trim();
    if (!name || name.length < 2) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }
  const companies = [...seen.values()].sort((a, b) => a.localeCompare(b));

  // har company ke liye captured-count nikaalo
  const counts = Object.fromEntries(
    (await Person.aggregate([{ $group: { _id: { $toLower: "$company" }, n: { $sum: 1 } } }]).catch(() => []))
      .map((x) => [x._id, x.n])
  );

  return {
    companies: companies.map((name) => ({
      company: name,
      // LinkedIn ka NORMAL people-search (jaise tum khud type karti) — recruiter/HR
      searchUrl:
        "https://www.linkedin.com/search/results/people/?keywords=" +
        encodeURIComponent(`${name} recruiter OR "talent acquisition" OR HR`),
      captured: counts[name.toLowerCase()] || 0,
    })),
  };
}

/* ======================= GET /api/linkedin/people ====================== */
export async function listPeople(params) {
  const showDone = params?.get?.("all") === "1";
  const q = showDone ? {} : { status: { $nin: ["connected", "replied", "skipped"] } };
  const people = await Person.find(q)
    .sort({ priority: 1, capturedAt: -1 })
    .limit(200)
    .lean();
  return { people: people.map(shape) };
}

/* ============= GET /api/linkedin/note-for?url= (content script) ========= */
/** Is profile URL ka note hai? (LinkedIn page pe floating panel ke liye) */
export async function noteForUrl(params) {
  const url = cleanUrl(vStr(params?.get?.("url"), 300) || "");
  if (!url) return { found: false };
  const p = await Person.findOne({ profileUrl: url }).lean();
  if (!p) return { found: false };
  return { found: true, id: String(p._id), name: p.name || "", note: p.note || "", status: p.status };
}

/* ==================== POST /api/linkedin/note (regen) ================== */
export async function regenerateNote(body) {
  const id = vStr(body?.id, 40);
  if (!id) throw new HttpError("id chahiye", 400);
  const p = await Person.findById(id);
  if (!p) throw new HttpError("Person nahi mila", 404);

  const profile = await activeProfile();
  const note = await generateConnectionNote({
    person: { name: p.name, role: p.role },
    company: p.company, jobTitle: p.jobTitle, profile, maxLen: 280,
  });
  p.note = note;
  p.noteAt = new Date();
  if (p.status === "new") p.status = "note-ready";
  await p.save();
  return { ok: true, id, note };
}

/* =================== POST /api/linkedin/status ========================= */
export async function updatePersonStatus(body) {
  const id = vStr(body?.id, 40);
  const status = vStr(body?.status, 20);
  const allowed = ["new", "note-ready", "sent", "connected", "replied", "skipped"];
  if (!id || !allowed.includes(status)) throw new HttpError("id + valid status chahiye", 400);
  const res = await Person.updateOne({ _id: id }, { $set: { status } });
  if (!res.matchedCount) throw new HttpError("Person nahi mila", 404);
  return { ok: true, id, status };
}

function shape(p) {
  return {
    id: String(p._id),
    name: p.name || "",
    role: p.role || "",
    company: p.company || "",
    location: p.location || "",
    profileUrl: p.profileUrl,
    jobTitle: p.jobTitle || "",
    priority: p.priority,
    priorityLabel: p.priorityLabel || "other",
    note: p.note || "",
    status: p.status || "new",
    capturedAt: p.capturedAt || p.createdAt || null,
  };
}
