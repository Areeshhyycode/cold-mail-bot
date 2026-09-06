/**
 * ANALYTICS + REPLIES API (Lead-based).
 *
 * Ye ACTIVE (legacy) email flow ka data deta hai — jo sender/run.js `Lead`
 * collection me likhta hai (opened/openCount/status/subject/lastSentAt). Naya
 * v2 outreach `Message`/`Reply` me hai (uska analytics outreach/analytics.js me
 * pehle se hai) — ye us se alag, wahi flow cover karta hai jo abhi chal raha hai.
 *
 * Deta hai:
 *   - overview: sent / open-rate / reply-rate / bounce-rate / unsub
 *   - bestSubjects: subject-wise open & reply rate (kaunsi subject line kaam karti)
 *   - byType (JOB vs SERVICE), byCampaign
 *   - timeline: last 14 din ke sends
 *   - replies list + draft (reply auto-draft ke saath) + "mark handled"
 */
import { Lead } from "../db/Lead.js";
import { HttpError } from "./jobsApi.js";
import { vStr } from "../core/httpAuth.js";

export { HttpError };

const pct = (a, b) => (b > 0 ? +((a / b) * 100).toFixed(1) : 0);
const DAY = 24 * 60 * 60 * 1000;
const SENT_STATUSES = ["sent", "followup_1", "followup_2", "replied", "unsubscribed", "done", "bounced"];

/* ============================== OVERVIEW =============================== */
export async function leadAnalytics(params) {
  const campaign = vStr(params?.get?.("campaign")) || null;
  const base = campaign && campaign !== "all" ? { campaign } : {};

  const [
    total, sent, opened, replied, bounced, unsub,
    byType, byCampaign, bestSubjects, timeline,
  ] = await Promise.all([
    Lead.countDocuments(base),
    Lead.countDocuments({ ...base, sentCount: { $gt: 0 } }),
    Lead.countDocuments({ ...base, opened: true }),
    Lead.countDocuments({ ...base, status: "replied" }),
    Lead.countDocuments({ ...base, status: "bounced" }),
    Lead.countDocuments({ ...base, status: "unsubscribed" }),

    // JOB vs SERVICE breakdown (sent / opened / replied)
    Lead.aggregate([
      { $match: { ...base, sentCount: { $gt: 0 } } },
      { $group: {
        _id: "$leadType",
        sent: { $sum: 1 },
        opened: { $sum: { $cond: ["$opened", 1, 0] } },
        replied: { $sum: { $cond: [{ $eq: ["$status", "replied"] }, 1, 0] } },
      } },
    ]),

    // campaign breakdown
    Lead.aggregate([
      { $match: { sentCount: { $gt: 0 } } },
      { $group: {
        _id: "$campaign",
        sent: { $sum: 1 },
        opened: { $sum: { $cond: ["$opened", 1, 0] } },
        replied: { $sum: { $cond: [{ $eq: ["$status", "replied"] }, 1, 0] } },
      } },
      { $sort: { sent: -1 } }, { $limit: 10 },
    ]),

    // BEST SUBJECT LINES — subject-wise open & reply rate
    Lead.aggregate([
      { $match: { ...base, sentCount: { $gt: 0 }, subject: { $nin: [null, ""] } } },
      { $group: {
        _id: "$subject",
        sent: { $sum: 1 },
        opened: { $sum: { $cond: ["$opened", 1, 0] } },
        replied: { $sum: { $cond: [{ $eq: ["$status", "replied"] }, 1, 0] } },
      } },
      { $sort: { replied: -1, opened: -1, sent: -1 } },
      { $limit: 20 },
    ]),

    // TIMELINE — last 14 din ke sends (lastSentAt ke din se group)
    Lead.aggregate([
      { $match: { ...base, lastSentAt: { $gte: new Date(Date.now() - 14 * DAY) } } },
      { $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$lastSentAt" } },
        sent: { $sum: 1 },
        opened: { $sum: { $cond: ["$opened", 1, 0] } },
        replied: { $sum: { $cond: [{ $eq: ["$status", "replied"] }, 1, 0] } },
      } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  return {
    overview: {
      total,
      sent,
      opened, openRate: pct(opened, sent),
      replied, replyRate: pct(replied, sent),
      bounced, bounceRate: pct(bounced, sent),
      unsub, unsubRate: pct(unsub, sent),
    },
    byType: byType.map((t) => ({
      type: t._id || "unknown",
      sent: t.sent, opened: t.opened, replied: t.replied,
      openRate: pct(t.opened, t.sent), replyRate: pct(t.replied, t.sent),
    })),
    byCampaign: byCampaign.map((c) => ({
      campaign: c._id || "default",
      sent: c.sent, opened: c.opened, replied: c.replied,
      openRate: pct(c.opened, c.sent), replyRate: pct(c.replied, c.sent),
    })),
    bestSubjects: bestSubjects.map((s) => ({
      subject: s._id,
      sent: s.sent, opened: s.opened, replied: s.replied,
      openRate: pct(s.opened, s.sent), replyRate: pct(s.replied, s.sent),
    })),
    timeline: timeline.map((d) => ({ date: d._id, sent: d.sent, opened: d.opened, replied: d.replied })),
    generatedAt: new Date().toISOString(),
  };
}

/* ============================== REPLIES =============================== */
/** Reply karne walon ki list — unka reply + AI draft ke saath (reply auto-draft). */
export async function listReplies(params) {
  const showHandled = params?.get?.("all") === "1";
  const q = { status: "replied" };
  if (!showHandled) q.replyHandled = { $ne: true };

  const leads = await Lead.find(q)
    .sort({ repliedAt: -1, updatedAt: -1 })
    .limit(100)
    .select("company businessName email leadType jobTitle subject replyText draftReply repliedAt replyHandled")
    .lean();

  return {
    replies: leads.map((l) => ({
      id: String(l._id),
      who: l.company || l.businessName || l.email || "—",
      email: l.email || "",
      leadType: l.leadType || "",
      jobTitle: l.jobTitle || "",
      subject: l.subject || "",
      replyText: l.replyText || "",
      draftReply: l.draftReply || "",
      repliedAt: l.repliedAt || null,
      handled: !!l.replyHandled,
    })),
  };
}

/** Reply ko "handled" (jawab bhej diya) mark karo — dashboard toggle. */
export async function markReplyHandled(body) {
  const id = vStr(body?.id, 40);
  if (!id) throw new HttpError("id chahiye", 400);
  const handled = body?.handled !== false; // default true
  const res = await Lead.updateOne({ _id: id }, { $set: { replyHandled: handled } });
  if (!res.matchedCount) throw new HttpError("Lead nahi mila", 404);
  return { ok: true, id, handled };
}

/** Draft edit karo (dashboard me tweak karke save) — optional. */
export async function saveDraft(body) {
  const id = vStr(body?.id, 40);
  const text = vStr(body?.draftReply, 5000);
  if (!id) throw new HttpError("id chahiye", 400);
  const res = await Lead.updateOne({ _id: id }, { $set: { draftReply: text || "" } });
  if (!res.matchedCount) throw new HttpError("Lead nahi mila", 404);
  return { ok: true, id };
}
