import mongoose from "mongoose";

/**
 * MESSAGE — outreach engine ka keystone. Ek doc = EK outreach attempt.
 *
 * MASLA (jo pehle tha): message HI lead tha. `subject`/`body` Lead document pe
 * fields thin, aur har lead ko sirf EK milta tha — jo har baar overwrite ho jata.
 * Us design me ye chaar cheezein MUMKIN HI NAHI thin:
 *   - do subject lines A/B test karna       (ek hi subject string thi)
 *   - 3-step follow-up sequence track karna (pichla message kahin save hi nahi hota)
 *   - do channels pe bhejna (email + WhatsApp) (channel ka concept hi nahi tha)
 *   - "best subject line kaunsi hai?" poochna (history hi nahi thi)
 *
 * HAL: message ko apni collection do. Lead wapas wahi ban jata hai jo hona chahiye
 * tha — ek BUSINESS. Message = us business se ek RAABTA.
 *
 * ⚠️ Lead collection ko HAATH NAHI lagaya. Purana sender/followup/report bilkul
 * pehle jaisa chalta rehta hai — wo Lead.subject/body parhte hain, aur dispatcher
 * un fields ko bhi likhta hai (backward compat), taake kuch na toote.
 */

const reasonSchema = new mongoose.Schema(
  { ok: Boolean, text: String },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    /* --------------------------- kis ko, kis liye --------------------------- */
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    // campaign SLUG (string) — Lead.campaign bhi string hai, isliye purane leads
    // bina kisi migration ke naye Campaign docs pe map ho jate hain.
    campaign: { type: String, default: "default", index: true },

    /* ------------------------------- routing -------------------------------- */
    channel: {
      type: String,
      enum: ["email", "contact_form", "whatsapp", "linkedin", "facebook", "instagram", "manual"],
      required: true,
    },
    // Phase 1 — "ye channel kyun choose hua". Dashboard pe dikhta hai.
    channelReasons: { type: [reasonSchema], default: [] },

    step: { type: Number, default: 0 },      // 0 = first touch, 1..n = follow-ups
    variant: { type: String, default: "A" }, // Phase 4 — A/B testing
    tone: {
      type: String,
      enum: ["friendly", "professional", "casual", "corporate"],
      default: "professional",
    },

    /* ------------------------------- content -------------------------------- */
    subject: { type: String, default: "" },
    previewText: { type: String, default: "" },  // inbox preview line (Phase 4)
    body: { type: String, default: "" },
    cta: { type: String, default: "" },
    signature: { type: String, default: "" },
    // Phase 6 — contact form ke fields ka payload (form ke hisaab se adapt)
    formFields: { type: mongoose.Schema.Types.Mixed, default: null },
    // Phase 5 — wa.me deep link (click karke WhatsApp khulta hai, pre-filled)
    waLink: { type: String, default: "" },

    /* ------------------------------ lifecycle ------------------------------- */
    status: {
      type: String,
      enum: [
        "draft",      // AI ne likha, tumhari approval ka intezaar
        "approved",   // tumne OK kiya
        "queued",     // dispatcher ne utha liya
        "sent",       // chala gaya (email) / tumne bheja (whatsapp)
        "delivered",  // SMTP ne accept kiya
        "opened",     // pixel hit
        "replied",
        "bounced",
        "failed",
        "skipped",    // guard ne roka (unsubscribed / bounced domain / rate limit)
        "rejected",   // tumne reject kiya
      ],
      default: "draft",
      index: true,
    },
    // EMAIL auto-send hota hai. Baaki har channel pe ye TRUE — koi WhatsApp/LinkedIn/
    // DM tumhari approval ke bagair kabhi nahi jayega (user ki explicit requirement).
    requiresApproval: { type: Boolean, default: true },
    skipReason: { type: String, default: "" },

    approvedAt: { type: Date },
    sentAt: { type: Date },
    deliveredAt: { type: Date },
    openedAt: { type: Date },
    repliedAt: { type: Date },

    // Phase 10 — "best sending time" ek aggregate me nikle, isliye denormalized.
    // sentAt se har baar $hour nikalna aggregate ko timezone-dependent bana deta.
    sentHour: { type: Number, default: null },

    /* ----------------------------- provenance ------------------------------ */
    providerMessageId: { type: String, default: "" },
    error: { type: String, default: "" },
    aiModel: { type: String, default: "" },
    // prompt badla to purane messages ka data ab compare-able nahi. Version stamp
    // karo taake analytics bata sake "naya prompt behtar tha ya nahi".
    promptVersion: { type: String, default: "v1" },
  },
  { timestamps: true }
);

/* Duplicate prevention (Phase 11): ek lead ko, ek campaign me, ek step pe, ek
   variant sirf EK BAAR. Dispatcher dobara chale to naya message nahi banta. */
messageSchema.index(
  { leadId: 1, campaign: 1, step: 1, variant: 1 },
  { unique: true }
);
messageSchema.index({ status: 1, channel: 1 });     // approval queue
messageSchema.index({ campaign: 1, sentAt: -1 });   // analytics

export const Message =
  mongoose.models.Message || mongoose.model("Message", messageSchema);
