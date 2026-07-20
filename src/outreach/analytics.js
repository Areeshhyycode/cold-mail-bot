/**
 * PHASE 10 — OUTREACH ANALYTICS.
 *
 * Sab kuch Message + Reply collections se derive hota hai (Lead pe kuch add nahi
 * kiya). Ye wo sawaal jawab deta hai jo purane report.js structurally nahi de
 * sakta tha — kyunki tab har lead ka sirf EK subject/body tha, history nahi.
 */
import { Message } from "../db/Message.js";
import { Reply, POSITIVE, NEGATIVE, AUTOMATED } from "../db/Reply.js";

/** Overall funnel + per-channel + reply breakdown */
export async function outreachAnalytics(campaign = null) {
  const match = campaign && campaign !== "all" ? { campaign } : {};

  const [funnel, byChannel, replyBreak, followRate] = await Promise.all([
    Message.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          drafted: { $sum: { $cond: [{ $eq: ["$status", "draft"] }, 1, 0] } },
          approved: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] } },
          sent: { $sum: { $cond: [{ $in: ["$status", ["sent", "delivered", "opened", "replied"]] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $in: ["$status", ["delivered", "opened", "replied"]] }, 1, 0] } },
          opened: { $sum: { $cond: [{ $in: ["$status", ["opened", "replied"]] }, 1, 0] } },
          bounced: { $sum: { $cond: [{ $eq: ["$status", "bounced"] }, 1, 0] } },
          total: { $sum: 1 },
        },
      },
    ]),
    Message.aggregate([
      { $match: match },
      { $group: { _id: "$channel", n: { $sum: 1 },
        sent: { $sum: { $cond: [{ $in: ["$status", ["sent", "delivered", "opened", "replied"]] }, 1, 0] } } } },
    ]),
    Reply.aggregate([
      { $match: match },
      { $group: { _id: "$classification", n: { $sum: 1 } } },
    ]),
    // follow-up rate = kitne messages step>0 (reminders)
    Message.aggregate([
      { $match: match },
      { $group: { _id: null,
        first: { $sum: { $cond: [{ $eq: ["$step", 0] }, 1, 0] } },
        follow: { $sum: { $cond: [{ $gt: ["$step", 0] }, 1, 0] } } } },
    ]),
  ]);

  const f = funnel[0] || {};
  const replyCounts = Object.fromEntries(replyBreak.map((r) => [r._id || "unknown", r.n]));
  const totalReplies = replyBreak.reduce((a, r) => a + r.n, 0);
  const positive = replyBreak.filter((r) => POSITIVE.includes(r._id)).reduce((a, r) => a + r.n, 0);
  const negative = replyBreak.filter((r) => NEGATIVE.includes(r._id)).reduce((a, r) => a + r.n, 0);
  const automated = replyBreak.filter((r) => AUTOMATED.includes(r._id)).reduce((a, r) => a + r.n, 0);
  const humanReplies = totalReplies - automated;

  const fr = followRate[0] || {};
  const sent = f.sent || 0;

  return {
    emailsSent: sent,
    delivered: f.delivered || 0,
    bounced: f.bounced || 0,
    bounceRate: sent ? +((f.bounced || 0) / sent * 100).toFixed(1) : 0,
    opened: f.opened || 0,
    openRate: (f.delivered || 0) ? +((f.opened || 0) / f.delivered * 100).toFixed(1) : 0,
    replies: humanReplies,
    replyRate: sent ? +(humanReplies / sent * 100).toFixed(1) : 0,
    positiveReplies: positive,
    negativeReplies: negative,
    followUpRate: (fr.first || 0) ? +((fr.follow || 0) / fr.first * 100).toFixed(1) : 0,
    drafted: f.drafted || 0,
    pendingApproval: f.approved || 0,
    replyBreakdown: replyCounts,
    byChannel: byChannel.map((c) => ({ channel: c._id || "unknown", total: c.n, sent: c.sent })),
  };
}

/**
 * Phase 10 — best subject lines (reply rate ke hisaab se). Sirf wo subjects jo
 * kam-se-kam N baar bheji gayi (chhote sample noise se bachne ke liye).
 */
export async function bestSubjectLines(campaign = null, minSends = 3) {
  const match = { channel: "email", subject: { $ne: "" }, status: { $in: ["sent", "delivered", "opened", "replied"] } };
  if (campaign && campaign !== "all") match.campaign = campaign;

  const rows = await Message.aggregate([
    { $match: match },
    { $group: {
      _id: "$subject",
      sent: { $sum: 1 },
      replied: { $sum: { $cond: [{ $eq: ["$status", "replied"] }, 1, 0] } },
      opened: { $sum: { $cond: [{ $in: ["$status", ["opened", "replied"]] }, 1, 0] } },
    } },
    { $match: { sent: { $gte: minSends } } },
    { $addFields: { replyRate: { $multiply: [{ $divide: ["$replied", "$sent"] }, 100] } } },
    { $sort: { replyRate: -1, sent: -1 } },
    { $limit: 15 },
  ]);

  return rows.map((r) => ({
    subject: r._id,
    sent: r.sent,
    opened: r.opened,
    replied: r.replied,
    replyRate: +r.replyRate.toFixed(1),
  }));
}

/**
 * Phase 10 — best sending times (hour of day, reply rate). sentHour denormalized
 * hai isliye ye ek saaf aggregate hai (timezone-safe).
 */
export async function bestSendTimes(campaign = null) {
  const match = { channel: "email", sentHour: { $ne: null } };
  if (campaign && campaign !== "all") match.campaign = campaign;

  const rows = await Message.aggregate([
    { $match: match },
    { $group: {
      _id: "$sentHour",
      sent: { $sum: 1 },
      replied: { $sum: { $cond: [{ $eq: ["$status", "replied"] }, 1, 0] } },
    } },
    { $sort: { _id: 1 } },
  ]);

  return rows.map((r) => ({
    hour: r._id,
    sent: r.sent,
    replied: r.replied,
    replyRate: r.sent ? +((r.replied / r.sent) * 100).toFixed(1) : 0,
  }));
}
