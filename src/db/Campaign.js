import mongoose from "mongoose";

/**
 * CAMPAIGN — Phase 9.
 *
 * Pehle `campaign` sirf Lead pe ek string field thi ("default"). Us se ye nahi
 * ho sakta tha: goal set karna, audience define karna, schedule dena, ya
 * PAUSE/RESUME karna. Ab campaign ka apna document hai.
 *
 * BACKWARD COMPAT: `name` wahi SLUG hai jo Lead.campaign me pehle se pari hai.
 * Isliye purane 523 leads bina kisi migration ke "default" campaign me aa jate
 * hain — bas ek `default` doc banana kaafi hai (ensureDefault()).
 */

const campaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true }, // slug — Lead.campaign se match
    label: { type: String, default: "" },                 // insaan ke parhne layak
    goal: { type: String, default: "" },                  // "book 5 discovery calls/week"

    /* ------ audience: kaunse leads is campaign me aayenge (query banti hai) ---- */
    audience: {
      leadType: { type: String, enum: ["JOB", "SERVICE", "ANY"], default: "SERVICE" },
      niches: { type: [String], default: [] },
      cities: { type: [String], default: [] },
      minScore: { type: Number, default: 0 },
      // "outdated"/"none" website wale = sabse achhe agency targets
      websiteQuality: { type: [String], default: [] },
    },

    /* --------------------------- message style ------------------------------ */
    style: {
      tone: {
        type: String,
        enum: ["friendly", "professional", "casual", "corporate"],
        default: "professional",
      },
      // Phase 4 — A/B: 1 = koi test nahi, 2 = A/B, 3 = A/B/C
      variants: { type: Number, default: 2, min: 1, max: 3 },
      channels: {
        type: [String],
        default: ["email", "contact_form", "whatsapp"],
      },
    },

    /* ----------------------------- schedule --------------------------------- */
    schedule: {
      dailyLimit: { type: Number, default: 40 },   // email cap (sender ka DAILY_SEND_LIMIT)
      whatsappDailyLimit: { type: Number, default: 15 }, // drafts/day — bulk nahi
      sendWindowStart: { type: Number, default: 9 },  // local hour
      sendWindowEnd: { type: Number, default: 18 },
      days: { type: [Number], default: [1, 2, 3, 4, 5] }, // 0=Sun … 6=Sat
    },

    status: {
      type: String,
      enum: ["draft", "active", "paused", "completed"],
      default: "active",
      index: true,
    },

    // denormalized counters — dashboard cards ke liye (har baar Message aggregate
    // karna 10k messages pe mehnga ho jata; ye dispatcher/analytics refresh karte hain)
    stats: {
      drafted: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      opened: { type: Number, default: 0 },
      replies: { type: Number, default: 0 },
      positive: { type: Number, default: 0 },
      negative: { type: Number, default: 0 },
      bounced: { type: Number, default: 0 },
    },

    lastRunAt: { type: Date },
  },
  { timestamps: true }
);

export const Campaign =
  mongoose.models.Campaign || mongoose.model("Campaign", campaignSchema);

/**
 * "default" campaign hamesha mojood ho — purane leads (jinki campaign === "default")
 * ka ghar. Idempotent.
 */
export async function ensureDefault() {
  const existing = await Campaign.findOne({ name: "default" });
  if (existing) return existing;
  return Campaign.create({
    name: "default",
    label: "Default agency outreach",
    goal: "Book discovery calls with businesses that need a better online presence",
    audience: { leadType: "SERVICE", minScore: 0 },
  });
}

/** Campaign abhi bhej sakti hai? (paused/draft/completed → nahi) */
export function isSendable(campaign) {
  if (!campaign) return { ok: false, reason: "campaign nahi mili" };
  if (campaign.status !== "active") {
    return { ok: false, reason: `campaign "${campaign.name}" ${campaign.status} hai` };
  }
  return { ok: true };
}

/**
 * Abhi sending window ke andar hain? Phase 11 — raat 3 baje cold email bhejna
 * spam-folder ka pakka rasta hai, aur domain reputation girata hai.
 * @param {object} campaign
 * @param {Date} [now]
 */
export function inSendWindow(campaign, now = new Date()) {
  const s = campaign?.schedule;
  if (!s) return { ok: true };

  const day = now.getDay();
  if (Array.isArray(s.days) && s.days.length && !s.days.includes(day)) {
    return { ok: false, reason: `aaj (day ${day}) is campaign ka sending day nahi` };
  }
  const hour = now.getHours();
  if (hour < s.sendWindowStart || hour >= s.sendWindowEnd) {
    return {
      ok: false,
      reason: `abhi ${hour}:00 — window ${s.sendWindowStart}:00–${s.sendWindowEnd}:00 hai`,
    };
  }
  return { ok: true };
}
