/**
 * OUTREACH ORCHESTRATOR — `npm run outreach`.
 *
 * Har eligible lead ke liye:
 *   1. research (Phase 2, cached)
 *   2. channel decide (Phase 1) — email/form/whatsapp/social/manual
 *   3. compose draft(s) (Phase 3-6) — email pe A/B variants
 *
 * Result: Message docs status:"draft" (ya email pe "approved" agar auto-send on).
 * Kuch bhejta NAHI — bhejna dispatch.js ka kaam hai. Ye sirf drafts taiyar karta
 * hai jo tum dashboard me review karte ho.
 *
 * ⚠️ Purane ai/run.js (personalize) ko chhua nahi. Wo Lead.subject/body likhta
 * rehta hai. Ye alag Message docs banata hai. OUTREACH_V2 flag decide karta hai
 * daily pipeline kaunsa chalayega.
 */
import dotenv from "dotenv";
import pLimit from "p-limit";
import { connectDB, disconnectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";
import { Message } from "../db/Message.js";
import { Campaign, ensureDefault } from "../db/Campaign.js";
import { researchBusiness } from "./research/index.js";
import { decideChannel, AUTO_SEND } from "./decide.js";
import { composeForLead } from "./compose/index.js";
import { log } from "../core/logger.js";

dotenv.config();

const LIMIT = parseInt(process.env.OUTREACH_BATCH || "40", 10);
const CONCURRENCY = parseInt(process.env.OUTREACH_CONCURRENCY || "3", 10);
// email drafts auto-approve karun? (email hi auto-send hota hai). Default: yes,
// taake purane flow jaisa "personalize → send" seamless rahe. Manual channels
// hamesha approval maangte hain, is flag se farq nahi parta.
const AUTO_APPROVE_EMAIL = process.env.OUTREACH_AUTOAPPROVE !== "0";

/**
 * @param {object} [opts] - { campaignName, limit }
 */
export async function runOutreach(opts = {}) {
  await connectDB();
  await ensureDefault();

  const campaignName = opts.campaignName || process.env.OUTREACH_CAMPAIGN || "default";
  const campaign = await Campaign.findOne({ name: campaignName });
  if (!campaign) {
    log.error("outreach.no_campaign", { campaignName });
    await disconnectDB();
    return { error: "campaign nahi mili" };
  }

  // audience query (Phase 9) — campaign.audience se Lead filter
  const query = buildAudienceQuery(campaign);
  const limit = opts.limit || LIMIT;

  // wo leads jinke liye is campaign+step0 me abhi tak koi message nahi bana
  const already = new Set(
    (await Message.distinct("leadId", { campaign: campaignName, step: 0 })).map(String)
  );

  const candidates = await Lead.find(query).sort({ score: -1 }).limit(limit * 3).lean();
  const leads = candidates.filter((l) => !already.has(String(l._id))).slice(0, limit);

  if (!leads.length) {
    log.warn("outreach.no_leads", { campaignName, note: "koi naya eligible lead nahi" });
    await disconnectDB();
    return { drafted: 0, leads: 0 };
  }

  log.info("outreach.start", { campaignName, leads: leads.length });

  const gate = pLimit(CONCURRENCY);
  const channelTally = {};
  let drafted = 0;

  await Promise.all(
    leads.map((lead) =>
      gate(async () => {
        try {
          const research = await researchBusiness(lead);
          const decision = decideChannel(lead, research, campaign.style?.channels);
          channelTally[decision.channel] = (channelTally[decision.channel] || 0) + 1;

          const drafts = await composeForLead(lead, research, decision, campaign, { step: 0 });

          // email drafts ko auto-approve (auto-send channel) — flag se
          if (AUTO_APPROVE_EMAIL && AUTO_SEND.has(decision.channel)) {
            for (const d of drafts) {
              if (d.status === "draft") {
                d.status = "approved";
                d.approvedAt = new Date();
                d.requiresApproval = false;
                await d.save();
              }
            }
          }
          drafted += drafts.length;
        } catch (err) {
          log.warn("outreach.lead_fail", { lead: String(lead._id), err: err.message });
        }
      })
    )
  );

  // campaign counters refresh
  await Campaign.updateOne(
    { name: campaignName },
    { $set: { lastRunAt: new Date() }, $inc: { "stats.drafted": drafted } }
  );

  log.info("outreach.done", { drafted, channels: JSON.stringify(channelTally) });
  await disconnectDB();
  return { drafted, leads: leads.length, channels: channelTally };
}

/** campaign.audience → Mongo query on Lead */
function buildAudienceQuery(campaign) {
  const a = campaign.audience || {};
  const q = { status: { $in: ["new", "ready"] } };

  if (a.leadType && a.leadType !== "ANY") q.leadType = a.leadType;
  if (a.minScore) q.score = { $gte: a.minScore };
  if (Array.isArray(a.niches) && a.niches.length) {
    q.niche = { $in: a.niches.map((n) => new RegExp(n, "i")) };
  }
  if (Array.isArray(a.cities) && a.cities.length) {
    q.city = { $in: a.cities.map((c) => new RegExp(c, "i")) };
  }
  if (Array.isArray(a.websiteQuality) && a.websiteQuality.length) {
    q.websiteQuality = { $in: a.websiteQuality };
  }
  return q;
}

// CLI entry — `npm run outreach`
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("run.js")) {
  runOutreach()
    .then((r) => {
      console.log(`\n✅ Outreach drafts: ${r.drafted || 0} (leads: ${r.leads || 0})`);
      if (r.channels) console.log("   channels:", r.channels);
      process.exit(0);
    })
    .catch((err) => {
      log.error("outreach.fatal", { error: err.message });
      process.exit(1);
    });
}
