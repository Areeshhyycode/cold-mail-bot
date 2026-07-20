import mongoose from "mongoose";

/**
 * CONVERSATION — AI Assistant ki yaadasht (Task 8, Phase 4).
 *
 * Ek doc = ek chat thread. Isme poori history, ek rolling summary, aur wo
 * entities (jobs/businesses/campaigns) jinki baat hui.
 *
 * Kyun rolling summary? Groq ka context limited hai. 100 messages ke baad poori
 * history bhejna mehnga + slow hai. Isliye purane turns ko ek `summary` me
 * compress kar dete hain aur sirf aakhri N messages verbatim bhejte hain.
 * Assistant ko phir bhi "pichli baat" yaad rehti hai.
 *
 * `entities` isliye alag rakhi hain: jab tum kaho "us business ko email bhejo",
 * to assistant ko pata ho "us" ka matlab kya hai — bina poori history parhe.
 */

/* Ek tool call ka record — explainability (Phase 10) ke liye. UI isse
   "kaunse module se data aaya" dikhata hai. */
const toolCallSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    args: { type: mongoose.Schema.Types.Mixed, default: {} },
    ok: { type: Boolean, default: true },
    error: { type: String, default: null },
    // result poora store NAHI karte (bohat bara ho sakta) — sirf meta
    meta: { type: mongoose.Schema.Types.Mixed, default: null }, // { source, count, tookMs }
    tookMs: { type: Number, default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant", "system"], required: true },
    content: { type: String, default: "" },
    // is turn me AI ne kaunse tools chalaye (assistant messages pe)
    toolCalls: { type: [toolCallSchema], default: [] },
    // Phase 10 — AI ne jo bola uske peeche ka reasoning/confidence
    explain: {
      sources: { type: [String], default: [] },   // ["jobs", "businesses"]
      confidence: { type: Number, default: null }, // 0-100
      reasoning: { type: String, default: null },
      nextAction: { type: String, default: null },
    },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

/* Jin cheezon ki baat hui — "us wale business" jaisi baat samajhne ke liye */
const entitySchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["job", "business", "lead", "campaign", "reply", "message"], required: true },
    refId: { type: String, default: null },     // Mongo _id ya dedupeKey
    label: { type: String, default: "" },       // "Junior React Dev @ Acme"
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    title: { type: String, default: "New chat" },   // pehle user message se auto-bnta
    messages: { type: [messageSchema], default: [] },

    // purane turns ka compressed version (jab messages badh jayein)
    summary: { type: String, default: "" },
    summarizedUpTo: { type: Number, default: 0 },   // kitne messages summary me aa chuke

    // Phase 4 — context
    entities: { type: [entitySchema], default: [] },
    // user ki preferences jo AI ne seekhi ("main sirf remote jobs dekhti hoon")
    preferences: { type: mongoose.Schema.Types.Mixed, default: {} },

    // kis role se ye chat chali (permissions — Phase 12)
    role: { type: String, default: "admin" },

    lastMessageAt: { type: Date, default: Date.now, index: true },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// conversation search (Phase 1) — title + message content pe text search
conversationSchema.index({ title: "text", "messages.content": "text" });
conversationSchema.index({ lastMessageAt: -1, archived: 1 });

export const Conversation =
  mongoose.models.Conversation || mongoose.model("Conversation", conversationSchema);
