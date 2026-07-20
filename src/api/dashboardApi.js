/**
 * DASHBOARD / COMMAND CENTER API (Task 7).
 *
 * Ye sab modules ka data EK jagah aggregate karta hai:
 *   Jobs (Job) · Businesses (Business) · Leads (Lead) · Outreach (Message) · Replies (Reply)
 *
 * Koi NAYA collection nahi banaya — jo pehle se hai usi se live stats, activity
 * feed, insights aur global search deta hai. Isi liye ye "extend" hai, "rewrite" nahi.
 *
 * Sab handlers read-only hain. HttpError jobsApi wala hi (instanceof server.js me chalta).
 */
import { Job } from "../db/Job.js";
import { Business } from "../db/Business.js";
import { Lead } from "../db/Lead.js";
import { Message } from "../db/Message.js";
import { Reply } from "../db/Reply.js";
import { vStr, vNum } from "../core/httpAuth.js";
import { HttpError } from "./jobsApi.js";

export { HttpError };

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const DAY = 24 * 60 * 60 * 1000;
const pct = (a, b) => (b > 0 ? +((a / b) * 100).toFixed(1) : 0);

/* ============================ Phase 1 — SUMMARY =========================== */
/** Home ke live cards. Har number asli collection se aata hai. */
export async function getSummary() {
  const today = startOfToday();
  const weekAgo = new Date(Date.now() - 7 * DAY);

  const [
    jobsToday, jobsApplied, jobsTotal, avgMatch,
    bizTotal, bizNoSite, bizWhatsapp, bizHighOpp, audits,
    emailsSent, waDrafts, repliesTotal, repliesNew,
    sentAttempted, bounced,
  ] = await Promise.all([
    Job.countDocuments({ firstSeen: { $gte: today.toISOString() } }),
    Job.countDocuments({ status: { $in: ["applied", "interview", "offer", "accepted"] } }),
    Job.countDocuments(),
    Job.aggregate([{ $match: { "ai.matchScore": { $ne: null } } }, { $group: { _id: null, a: { $avg: "$ai.matchScore" } } }]),
    Business.countDocuments(),
    Business.countDocuments({ hasWebsite: false }),
    Business.countDocuments({ hasWhatsapp: true }),
    Business.countDocuments({ score: { $gte: 60 } }),
    Business.countDocuments({ hasWebsite: true, websiteScore: { $ne: null } }),
    Message.countDocuments({ channel: "email", status: "sent" }),
    Message.countDocuments({ channel: "whatsapp", status: { $in: ["pending", "draft", "approved"] } }),
    Reply.countDocuments(),
    Reply.countDocuments({ status: "new" }),
    Message.countDocuments({ status: { $in: ["sent", "delivered", "opened", "replied", "bounced"] } }),
    Message.countDocuments({ status: "bounced" }),
  ]);

  // LEGACY FALLBACK — purana outreach `Lead` me hai, naya `Message` me.
  // Jab tak Message khali hai, deliverability Lead se nikaalo warna dashboard
  // 0 sent / 700% reply-rate jaisi bakwas dikhata hai.
  const [legacyReplies, legacySent, legacyBounced] = await Promise.all([
    Lead.countDocuments({ status: "replied" }),
    Lead.countDocuments({ status: { $in: ["sent", "followup_1", "followup_2", "replied", "done", "bounced"] } }),
    Lead.countDocuments({ status: "bounced" }),
  ]);

  const useLegacy = sentAttempted === 0;
  const sent = useLegacy ? legacySent : sentAttempted;
  const bounces = useLegacy ? legacyBounced : bounced;
  const replies = repliesTotal || legacyReplies;

  return {
    cards: {
      jobsFoundToday: jobsToday,
      jobsApplied,
      businessesFound: bizTotal,
      businessesNoWebsite: bizNoSite,
      websiteAuditsCompleted: audits,
      emailsSent,
      whatsappDraftsReady: waDrafts,
      repliesReceived: replies,
      highOpportunityLeads: bizHighOpp,
      businessesWithWhatsapp: bizWhatsapp,
      avgMatchScore: avgMatch[0] ? Math.round(avgMatch[0].a) : null,
      newReplies: repliesNew,
    },
    deliverability: {
      sent,
      bounced: bounces,
      bounceRate: pct(bounces, sent),   // pct() khud 0 deta hai jab sent=0
      replyRate: pct(replies, sent),
      source: useLegacy ? "leads (legacy)" : "messages",
    },
    systemHealth: healthCheck({ bounced: bounces, sentAttempted: sent }),
    generatedAt: new Date().toISOString(),
  };
}

/** Simple health rollup — red/amber/green + reasons. */
function healthCheck({ bounced, sentAttempted }) {
  const issues = [];
  const bounceRate = pct(bounced, sentAttempted);
  if (bounceRate > 5) issues.push(`Bounce rate ${bounceRate}% (>5% hurts deliverability)`);
  return {
    status: issues.length ? "warning" : "ok",
    issues,
  };
}

/* ========================= Phase 1 — ACTIVITY FEED ======================= */
/** Recent activity — collections ke recent docs ko merge kar ke ek timeline. */
export async function getActivity(params) {
  const limit = vNum(params.get("limit"), 1, 100) || 25;

  const [jobs, biz, msgs, replies] = await Promise.all([
    Job.find().sort({ lastUpdated: -1 }).limit(limit).select("title company status lastUpdated").lean(),
    Business.find().sort({ updatedAt: -1 }).limit(limit).select("businessName area score hasWebsite updatedAt").lean(),
    Message.find({ sentAt: { $ne: null } }).sort({ sentAt: -1 }).limit(limit).select("channel subject sentAt").lean(),
    Reply.find().sort({ receivedAt: -1 }).limit(limit).select("from classification receivedAt").lean(),
  ]);

  const feed = [
    ...jobs.map((j) => ({ type: "job", icon: "🧩", at: j.lastUpdated, text: `${j.title || "Job"} @ ${j.company || "?"}`, meta: j.status })),
    ...biz.map((b) => ({ type: "business", icon: b.hasWebsite ? "🏢" : "🔥", at: b.updatedAt, text: `${b.businessName} (${b.area})`, meta: `score ${b.score}` })),
    ...msgs.map((m) => ({ type: "outreach", icon: m.channel === "whatsapp" ? "💬" : "✉️", at: m.sentAt, text: m.subject || `${m.channel} message`, meta: m.channel })),
    ...replies.map((r) => ({ type: "reply", icon: "📨", at: r.receivedAt, text: `Reply from ${r.from || "?"}`, meta: r.classification || "new" })),
  ]
    .filter((x) => x.at)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, limit);

  return { activity: feed };
}

/* ===================== Phase 7 + 17 — AI INSIGHTS ======================== */
/**
 * Rule-based insights (LLM nahi — deterministic, free, explainable). Ye wahi
 * "AI Analytics" widgets hain jo tumne maange: best send time, top skills, etc.
 */
export async function getInsights() {
  const [bestHour, topSkills, topCompanies, byArea, replyByClass, matchDist] = await Promise.all([
    // best send hour — jin messages ka reply aaya, unka sentHour
    Message.aggregate([
      { $match: { repliedAt: { $ne: null }, sentHour: { $ne: null } } },
      { $group: { _id: "$sentHour", n: { $sum: 1 } } },
      { $sort: { n: -1 } }, { $limit: 1 },
    ]),
    // most requested skills across scraped jobs
    Job.aggregate([
      { $unwind: "$technologies" },
      { $group: { _id: { $toLower: "$technologies" }, n: { $sum: 1 } } },
      { $sort: { n: -1 } }, { $limit: 8 },
    ]),
    // companies you've engaged most (applied)
    Job.aggregate([
      { $match: { status: { $in: ["applied", "interview", "offer"] } } },
      { $group: { _id: "$company", n: { $sum: 1 } } },
      { $sort: { n: -1 } }, { $limit: 5 },
    ]),
    // best area for no-website leads
    Business.aggregate([
      { $match: { hasWebsite: false } },
      { $group: { _id: "$area", n: { $sum: 1 } } },
      { $sort: { n: -1 } }, { $limit: 5 },
    ]),
    Reply.aggregate([{ $group: { _id: "$classification", n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
    Job.aggregate([{ $match: { "ai.matchScore": { $ne: null } } }, {
      $bucket: { groupBy: "$ai.matchScore", boundaries: [0, 40, 70, 101], default: "other", output: { n: { $sum: 1 } } },
    }]),
  ]);

  // insights ko insaan-parhne-layak lines me badlo (dashboard direct dikhata hai)
  const insights = [];
  if (bestHour[0]) insights.push({ icon: "🕐", title: "Best send time", value: `${bestHour[0]._id}:00`, note: `${bestHour[0].n} replies came from this hour` });
  if (byArea[0]) insights.push({ icon: "📍", title: "Best area for no-website leads", value: byArea[0]._id || "?", note: `${byArea[0].n} businesses without a website` });
  if (topSkills[0]) insights.push({ icon: "⚡", title: "Most requested skill", value: topSkills[0]._id, note: `appears in ${topSkills[0].n} scraped jobs` });
  if (matchDist.length) {
    const strong = matchDist.find((m) => m._id === 70)?.n || 0;
    insights.push({ icon: "🎯", title: "Strong-match jobs (70+)", value: String(strong), note: "worth applying to first" });
  }

  return {
    insights,
    topSkills: topSkills.map((s) => ({ skill: s._id, count: s.n })),
    topCompanies: topCompanies.map((c) => ({ company: c._id || "?", count: c.n })),
    noWebsiteByArea: byArea.map((a) => ({ area: a._id || "?", count: a.n })),
    repliesByClass: replyByClass.map((r) => ({ type: r._id || "unclassified", count: r.n })),
  };
}

/* ======================== Phase 11 — GLOBAL SEARCH ======================= */
/** Ek search box → jobs, businesses, leads, replies sab me. */
export async function globalSearch(params) {
  const q = vStr(params.get("q"), 100);
  if (!q) return { query: "", results: [] };
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const per = 6;

  const [jobs, biz, leads, replies] = await Promise.all([
    Job.find({ $or: [{ title: rx }, { company: rx }] }).limit(per).select("title company status dedupeKey").lean(),
    Business.find({ $or: [{ businessName: rx }, { "contacts.value": rx }, { area: rx }] }).limit(per).select("businessName area score hasWebsite").lean(),
    Lead.find({ $or: [{ businessName: rx }, { company: rx }, { email: rx }] }).limit(per).select("businessName company email status leadType").lean(),
    Reply.find({ $or: [{ from: rx }, { subject: rx }] }).limit(per).select("from subject classification").lean(),
  ]);

  const results = [
    ...jobs.map((j) => ({ kind: "job", label: `${j.title} @ ${j.company}`, meta: j.status, link: "/jobs" })),
    ...biz.map((b) => ({ kind: "business", label: `${b.businessName} (${b.area})`, meta: `score ${b.score}`, link: "/businesses" })),
    ...leads.map((l) => ({ kind: "lead", label: l.company || l.businessName || l.email, meta: l.status, link: "/" })),
    ...replies.map((r) => ({ kind: "reply", label: `Reply: ${r.from}`, meta: r.classification || "new", link: "/" })),
  ];

  return { query: q, count: results.length, results };
}
