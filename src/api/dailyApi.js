/**
 * DAILY HUB — ek jagah jahan se roz ka sab kaam ho jaye, taake alag-alag
 * LinkedIn/Indeed/dashboard na kholne pade.
 *
 * Deta hai:
 *   - todayJobs: best CV-match jobs (abhi tak apply nahi ki) — direct apply links
 *   - linkedin : applied companies ke HR-search links + captured recruiters (note ready)
 *   - emails   : kitni cold emails bhejne ko ready hain
 */
import { Job } from "../db/Job.js";
import { Lead } from "../db/Lead.js";
import { Person } from "../db/Person.js";
import { getAllMatchProfiles, matchJobToProfiles } from "../ai/profileSkills.js";
import { appliedCompanies } from "./linkedinApi.js";

export async function getDailyQueue() {
  const profiles = await getAllMatchProfiles().catch(() => []);

  // 1) jobs jo apply karne layak hain — status new + apply URL mojood
  const raw = await Job.find({
    status: { $in: ["new", "saved"] },
    url: { $nin: [null, ""] },
  })
    .sort({ firstSeen: -1 })
    .limit(150)
    .select("dedupeKey title company url location description ai.matchScore")
    .lean();

  const scored = raw.map((j) => {
    const text = `${j.title || ""} ${j.description || ""}`;
    const mp = profiles.length ? matchJobToProfiles(text, profiles) : { best: null, scores: [] };
    return {
      id: j.dedupeKey,
      title: j.title || "(role)",
      company: j.company || "",
      url: j.url,
      location: j.location || "",
      matchPct: mp.best ? mp.best.matchPct : (j.ai?.matchScore || 0),
      bestProfile: mp.best ? mp.best.name : "",
      profiles: mp.scores.slice(0, 4).map((s) => ({ name: s.name.split(" ")[0], pct: s.matchPct })),
    };
  });

  // best match pehle; sirf wo jahan koi fit ho (>0)
  const todayJobs = scored
    .filter((j) => j.matchPct > 0)
    .sort((a, b) => b.matchPct - a.matchPct)
    .slice(0, 15);

  // 2) linkedin — applied companies + captured recruiters (note ready)
  const [companies, people] = await Promise.all([
    appliedCompanies().then((r) => r.companies).catch(() => []),
    Person.find({ status: { $nin: ["connected", "replied", "skipped"] } })
      .sort({ priority: 1, capturedAt: -1 }).limit(10)
      .select("name role company profileUrl note status").lean().catch(() => []),
  ]);

  // 3) emails ready
  const emailsReady = await Lead.countDocuments({ status: "ready", email: { $nin: [null, ""] } }).catch(() => 0);

  return {
    todayJobs,
    linkedin: {
      companies: companies.slice(0, 10),
      recruiters: people.map((p) => ({
        id: String(p._id), name: p.name || "", role: p.role || "", company: p.company || "",
        profileUrl: p.profileUrl, note: p.note || "", status: p.status,
      })),
    },
    emailsReady,
    counts: {
      jobs: todayJobs.length,
      recruiters: people.length,
      companies: companies.length,
      emails: emailsReady,
    },
    generatedAt: new Date().toISOString(),
  };
}
