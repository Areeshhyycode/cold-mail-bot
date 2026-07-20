import mongoose from "mongoose";

/**
 * REPLY — Phase 8.
 *
 * Purana replyChecker sirf 3 cheezein jaanta tha: bounce / unsubscribe / "koi reply
 * aaya". Us ke baad tumhe KHUD Gmail kholna parta tha ye samajhne ke liye ke banda
 * interested tha ya bas out-of-office auto-reply tha.
 *
 * Ab har reply AI se classify hoti hai aur uska ek suggested jawab pehle se taiyar
 * hota hai. Lekin — user ki explicit requirement — koi jawab KHUD-BA-KHUD nahi jata.
 * `status` "new" pe rehta hai jab tak tum approve na karo.
 *
 * ⚠️ Ye CRM nahi hai. Yahan pipeline/deal/stage kuch nahi. Bas: reply aayi, ye
 * uski qism hai, ye mumkin jawab hai. Bas.
 */

const replySchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", required: true, index: true },
    // kis message ka jawab hai (mil jaye to) — analytics isse "kaunsi subject line
    // ne reply karwaya" nikaalti hai
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    campaign: { type: String, default: "default", index: true },

    from: { type: String, default: "" },
    subject: { type: String, default: "" },
    text: { type: String, default: "" },
    receivedAt: { type: Date, default: Date.now },
    // Gmail ka message-id — dobara process na ho (idempotent reply checking)
    externalId: { type: String, default: "" },

    /* ------------------------------ Phase 8 -------------------------------- */
    classification: {
      type: String,
      enum: [
        "interested",
        "not_interested",
        "need_info",
        "meeting_request",
        "quote_request",
        "auto_reply",
        "out_of_office",
        "spam",
        "unknown",
      ],
      default: "unknown",
      index: true,
    },
    confidence: { type: Number, default: 0 },   // 0-1
    sentiment: {
      type: String,
      enum: ["positive", "neutral", "negative"],
      default: "neutral",
    },
    summary: { type: String, default: "" },     // ek line: banda keh kya raha hai

    // AI ka tajweez-karda jawab. KABHI khud nahi jata.
    suggestedReply: { type: String, default: "" },
    suggestedSubject: { type: String, default: "" },

    status: {
      type: String,
      enum: ["new", "approved", "sent", "dismissed"],
      default: "new",
      index: true,
    },
    sentAt: { type: Date },
  },
  { timestamps: true }
);

// ek Gmail message dobara process na ho. PARTIAL — externalId na ho to index me nahi
// (warna sab "" pe collide karte, jaisa Lead.jobUrl ke saath hua tha).
replySchema.index(
  { externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: "string", $ne: "" } } }
);
replySchema.index({ status: 1, classification: 1 });

export const Reply = mongoose.models.Reply || mongoose.model("Reply", replySchema);

/** Positive intent = follow up karne layak (analytics + notify ke liye) */
export const POSITIVE = ["interested", "meeting_request", "quote_request", "need_info"];
export const NEGATIVE = ["not_interested", "spam"];
/** Insaan ne likha hi nahi — reply-rate me count nahi hona chahiye */
export const AUTOMATED = ["auto_reply", "out_of_office"];
