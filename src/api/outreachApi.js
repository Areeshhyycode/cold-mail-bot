/**
 * OUTREACH API — Task 5 ke saare dashboard/extension endpoints.
 *
 * Plain Node http ke saath (Express nahi, project ke usool ke mutabiq). Sab
 * /api/outreach/* ke neeche, sab Bearer-token protected (server.js authorize()).
 *
 * HttpError + validators jobsApi/httpAuth se reuse karta hai — SAME HttpError class
 * (warna server ka `instanceof HttpError` check fail ho jata aur status kho jata).
 */
import { HttpError } from "./jobsApi.js";
import { vStr, vNum, vEnum } from "../core/httpAuth.js";
import { Message } from "../db/Message.js";
import { Reply } from "../db/Reply.js";
import { Lead } from "../db/Lead.js";
import { Campaign, ensureDefault } from "../db/Campaign.js";
import { outreachAnalytics, bestSubjectLines, bestSendTimes } from "../outreach/analytics.js";
import { isTone } from "../outreach/compose/tones.js";
import { buildSignature } from "../outreach/compose/email.js";
import { getOffer } from "../ai/offers.js";
import { sendEmail } from "../sender/mailer.js";

const CHANNELS = ["email", "contact_form", "whatsapp", "linkedin", "facebook", "instagram", "manual"];

/* ============================ approval queue ============================== */
/** GET /api/outreach/queue?channel&status&campaign&limit */
export async function listQueue(params) {
  const q = {};
  const status = params.get("status");
  q.status = status && status !== "all"
    ? { $in: status.split(",").filter((s) => Message.schema.path("status").enumValues.includes(s)) }
    : { $in: ["draft", "approved"] };

  const channel = vEnum(params.get("channel"), CHANNELS);
  if (channel) q.channel = channel;
  const campaign = vStr(params.get("campaign"), 100);
  if (campaign && campaign !== "all") q.campaign = campaign;

  const limit = Math.min(vNum(params.get("limit"), 1, 500) || 100, 500);

  const messages = await Message.find(q).sort({ createdAt: -1 }).limit(limit).lean();

  // lead info attach (naam/email dikhane ke liye) — ek query me
  const leadIds = [...new Set(messages.map((m) => String(m.leadId)))];
  const leads = await Lead.find({ _id: { $in: leadIds } })
    .select("businessName company email phone website leadType city niche")
    .lean();
  const leadMap = Object.fromEntries(leads.map((l) => [String(l._id), l]));

  return {
    ok: true,
    count: messages.length,
    messages: messages.map((m) => ({
      ...m,
      lead: leadMap[String(m.leadId)] || null,
    })),
  };
}

/** POST /api/outreach/approve  { id }  → status:approved */
export async function approveMessage(body) {
  const id = vStr(body?.id, 40);
  if (!id) throw new HttpError("message id chahiye", 400);
  const msg = await Message.findById(id);
  if (!msg) throw new HttpError("message nahi mili", 404);
  if (!["draft"].includes(msg.status)) throw new HttpError(`is status (${msg.status}) me approve nahi hota`, 400);

  msg.status = "approved";
  msg.approvedAt = new Date();
  await msg.save();
  return { ok: true, status: msg.status };
}

/** POST /api/outreach/reject  { id } */
export async function rejectMessage(body) {
  const id = vStr(body?.id, 40);
  if (!id) throw new HttpError("message id chahiye", 400);
  const msg = await Message.findByIdAndUpdate(id, { status: "rejected" }, { new: true });
  if (!msg) throw new HttpError("message nahi mili", 404);
  return { ok: true, status: msg.status };
}

/**
 * POST /api/outreach/mark-sent  { id }
 * Manual channels (WhatsApp/form/social) — tumne khud bhej diya, ab record karo.
 * Lead.status bhi update taake reply tracking chale.
 */
export async function markSent(body) {
  const id = vStr(body?.id, 40);
  if (!id) throw new HttpError("message id chahiye", 400);
  const msg = await Message.findById(id);
  if (!msg) throw new HttpError("message nahi mili", 404);

  const now = new Date();
  msg.status = "sent";
  msg.sentAt = now;
  msg.sentHour = now.getHours();
  await msg.save();

  await Lead.updateOne(
    { _id: msg.leadId, status: { $in: ["new", "ready"] } },
    { $set: { status: "sent", lastSentAt: now }, $inc: { sentCount: 1 } }
  );
  return { ok: true, status: msg.status };
}

/**
 * POST /api/outreach/edit  { id, subject?, body?, previewText? }
 * Draft ko haath se tweak karna (approve se pehle).
 */
export async function editMessage(body) {
  const id = vStr(body?.id, 40);
  if (!id) throw new HttpError("message id chahiye", 400);
  const msg = await Message.findById(id);
  if (!msg) throw new HttpError("message nahi mili", 404);
  if (["sent", "delivered", "opened", "replied"].includes(msg.status)) {
    throw new HttpError("ye message ja chuki — edit nahi hoti", 400);
  }
  const subject = vStr(body?.subject, 300);
  const bodyText = vStr(body?.body, 20000);
  const preview = vStr(body?.previewText, 200);
  if (subject != null) msg.subject = subject;
  if (bodyText != null) msg.body = bodyText;
  if (preview != null) msg.previewText = preview;
  await msg.save();
  return { ok: true };
}

/* =============================== replies ================================= */
/** GET /api/outreach/replies?classification&status */
export async function listReplies(params) {
  const q = {};
  const cls = params.get("classification");
  if (cls && cls !== "all") q.classification = cls;
  const status = vEnum(params.get("status"), ["new", "approved", "sent", "dismissed"]);
  if (status) q.status = status;

  const replies = await Reply.find(q).sort({ receivedAt: -1 }).limit(200).lean();
  const leadIds = [...new Set(replies.map((r) => String(r.leadId)))];
  const leads = await Lead.find({ _id: { $in: leadIds } }).select("businessName company email").lean();
  const leadMap = Object.fromEntries(leads.map((l) => [String(l._id), l]));

  return {
    ok: true,
    count: replies.length,
    replies: replies.map((r) => ({ ...r, lead: leadMap[String(r.leadId)] || null })),
  };
}

/**
 * POST /api/outreach/replies/send  { id }
 * Suggested jawab bhejo — SIRF jab tum approve karo (auto kabhi nahi).
 */
export async function sendReply(body) {
  const id = vStr(body?.id, 40);
  if (!id) throw new HttpError("reply id chahiye", 400);
  const reply = await Reply.findById(id);
  if (!reply) throw new HttpError("reply nahi mili", 404);
  if (!reply.suggestedReply) throw new HttpError("is reply ka koi suggested jawab nahi", 400);
  if (reply.status === "sent") throw new HttpError("ye jawab pehle ja chuka", 400);

  const lead = await Lead.findById(reply.leadId);
  const to = reply.from || lead?.email;
  if (!to) throw new HttpError("kis ko bhejein? (email nahi mili)", 400);

  await sendEmail({
    to,
    subject: reply.suggestedSubject || `Re: ${reply.subject}`,
    text: reply.suggestedReply,
    leadId: String(reply.leadId),
    leadType: lead?.leadType || "SERVICE",
  });

  reply.status = "sent";
  reply.sentAt = new Date();
  await reply.save();
  return { ok: true };
}

/** POST /api/outreach/replies/dismiss { id } */
export async function dismissReply(body) {
  const id = vStr(body?.id, 40);
  const r = await Reply.findByIdAndUpdate(id, { status: "dismissed" }, { new: true });
  if (!r) throw new HttpError("reply nahi mili", 404);
  return { ok: true };
}

/* ============================== campaigns ================================ */
/** GET /api/outreach/campaigns */
export async function listCampaigns() {
  await ensureDefault();
  const campaigns = await Campaign.find({}).sort({ createdAt: 1 }).lean();
  return { ok: true, campaigns };
}

/** POST /api/outreach/campaigns  (create/update) */
export async function upsertCampaign(body) {
  const name = vStr(body?.name, 60);
  if (!name) throw new HttpError("campaign name (slug) chahiye", 400);
  const slug = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");

  const update = {};
  if (body.label != null) update.label = vStr(body.label, 120) || "";
  if (body.goal != null) update.goal = vStr(body.goal, 300) || "";
  if (body.status) update.status = vEnum(body.status, ["draft", "active", "paused", "completed"]) || "active";
  if (body.audience && typeof body.audience === "object") {
    update.audience = {
      leadType: vEnum(body.audience.leadType, ["JOB", "SERVICE", "ANY"]) || "SERVICE",
      minScore: vNum(body.audience.minScore, 0, 100) || 0,
      niches: Array.isArray(body.audience.niches) ? body.audience.niches.map((n) => vStr(n, 60)).filter(Boolean).slice(0, 20) : [],
      cities: Array.isArray(body.audience.cities) ? body.audience.cities.map((c) => vStr(c, 60)).filter(Boolean).slice(0, 20) : [],
      websiteQuality: Array.isArray(body.audience.websiteQuality) ? body.audience.websiteQuality.filter((w) => ["none", "outdated", "ok", "unknown"].includes(w)) : [],
    };
  }
  if (body.style && typeof body.style === "object") {
    update.style = {
      tone: isTone(body.style.tone) ? body.style.tone : "professional",
      variants: vNum(body.style.variants, 1, 3) || 2,
      channels: Array.isArray(body.style.channels) ? body.style.channels.filter((c) => CHANNELS.includes(c)) : ["email", "contact_form", "whatsapp"],
    };
  }

  const doc = await Campaign.findOneAndUpdate(
    { name: slug },
    { $set: update, $setOnInsert: { name: slug } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return { ok: true, campaign: doc };
}

/** POST /api/outreach/campaigns/status  { name, status }  — pause/resume */
export async function setCampaignStatus(body) {
  const name = vStr(body?.name, 60);
  const status = vEnum(body?.status, ["draft", "active", "paused", "completed"]);
  if (!name || !status) throw new HttpError("name + valid status chahiye", 400);
  const c = await Campaign.findOneAndUpdate({ name }, { status }, { new: true });
  if (!c) throw new HttpError("campaign nahi mili", 404);
  return { ok: true, status: c.status };
}

/* ============================== analytics =============================== */
/** GET /api/outreach/analytics?campaign */
export async function getAnalytics(params) {
  const campaign = vStr(params.get("campaign"), 100);
  const [overview, subjects, times] = await Promise.all([
    outreachAnalytics(campaign),
    bestSubjectLines(campaign),
    bestSendTimes(campaign),
  ]);
  return { ok: true, ...overview, bestSubjects: subjects, sendTimes: times };
}

/* ============================= stats card =============================== */
/** GET /api/outreach/stats — dashboard cards */
export async function outreachStats() {
  const [queue, pendingReplies, campaigns] = await Promise.all([
    Message.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    Reply.countDocuments({ status: "new" }),
    Campaign.countDocuments({ status: "active" }),
  ]);
  const byStatus = Object.fromEntries(queue.map((s) => [s._id || "unknown", s.n]));
  return {
    ok: true,
    byStatus,
    pendingApproval: (byStatus.draft || 0),
    readyToSend: (byStatus.approved || 0),
    pendingReplies,
    activeCampaigns: campaigns,
  };
}
