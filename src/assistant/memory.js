/**
 * MEMORY — Task 8, Phase 4.
 *
 * Assistant ko teen tarah ki yaad chahiye:
 *
 *   1. SHORT-TERM  — is chat ke aakhri kuch messages (verbatim)
 *   2. LONG-TERM   — us se purane turns ka compressed summary
 *   3. ENTITIES    — kin jobs/businesses ki baat hui (taake "usko email bhejo" samajh aaye)
 *
 * Design faisla: hum poori history har baar Groq ko NAHI bhejte. 50-message
 * chat me wo har turn pe hazaaron tokens jala deti aur dheere dheere context
 * limit se takra jati. Iske bajaye: aakhri RECENT_TURNS verbatim + purane ka
 * ek summary paragraph. Yaad rehti hai, prompt chhota rehta hai.
 */
import { Conversation } from "../db/Conversation.js";
import { askJSON, groq, hasGroq, MODEL } from "../outreach/ai.js";

const RECENT_TURNS = 12;        // itne messages verbatim jate hain
const SUMMARIZE_AFTER = 20;     // itne se zyada hue to purane compress karo
const MAX_ENTITIES = 40;

/** Nayi chat banao ya mojooda load karo */
export async function getConversation(id, role = "admin") {
  if (id) {
    const c = await Conversation.findById(id);
    if (c) return c;
  }
  return Conversation.create({ role, messages: [], title: "New chat" });
}

/**
 * Groq ke liye messages banao: summary (agar hai) + aakhri N turns.
 * @returns {Array<{role:string, content:string}>}
 */
export function buildHistory(conv) {
  const out = [];

  if (conv.summary) {
    out.push({
      role: "system",
      content:
        `PICHLI BAATCHEET KA KHULASA (purane turns, compressed):\n${conv.summary}\n\n` +
        `Isse context ke liye use karo — user isi chat ko jaari rakhe hue hai.`,
    });
  }

  if (conv.entities?.length) {
    const recent = conv.entities.slice(-12);
    out.push({
      role: "system",
      content:
        "IS CHAT ME JIN CHEEZON KI BAAT HUI (jab user 'us', 'wo wala', 'isko' kahe to inme se samjho):\n" +
        recent.map((e) => `- [${e.kind}] ${e.label}${e.refId ? ` (id: ${e.refId})` : ""}`).join("\n"),
    });
  }

  // sirf recent messages verbatim (summary wale skip)
  const recentMsgs = conv.messages.slice(conv.summarizedUpTo).slice(-RECENT_TURNS);
  for (const m of recentMsgs) {
    if (m.role === "system") continue;
    out.push({ role: m.role, content: m.content || "" });
  }

  return out;
}

/** User ka message save karo */
export async function addUserMessage(conv, content) {
  conv.messages.push({ role: "user", content, at: new Date() });
  if (conv.messages.length === 1) {
    // pehle message se title banao (chat list me dikhega)
    conv.title = content.slice(0, 60).replace(/\s+/g, " ").trim() || "New chat";
  }
  conv.lastMessageAt = new Date();
  await conv.save();
  return conv;
}

/** Assistant ka jawab + jo tools chale + explainability save karo */
export async function addAssistantMessage(conv, { content, toolCalls = [], explain = {} }) {
  conv.messages.push({
    role: "assistant",
    content,
    toolCalls: toolCalls.map((t) => ({
      name: t.name,
      args: t.args,
      ok: t.ok,
      error: t.error || null,
      meta: t.meta || null,
      tookMs: t.tookMs ?? null,
      at: new Date(),
    })),
    explain: {
      sources: explain.sources || [],
      confidence: explain.confidence ?? null,
      reasoning: explain.reasoning || null,
      nextAction: explain.nextAction || null,
    },
    at: new Date(),
  });
  conv.lastMessageAt = new Date();
  await conv.save();
  return conv;
}

/**
 * Tool results se entities nikaal ke yaad rakho — taake agle turn me
 * "us business" / "wo job" ka matlab pata ho.
 */
export async function rememberEntities(conv, toolName, result) {
  if (!result || typeof result !== "object") return;
  const add = (kind, refId, label) => {
    if (!label) return;
    // duplicate na ho
    if (conv.entities.some((e) => e.kind === kind && e.refId === refId)) return;
    conv.entities.push({ kind, refId: refId ? String(refId) : null, label, at: new Date() });
  };

  for (const j of result.jobs || []) add("job", j.dedupeKey, `${j.title}${j.company ? ` @ ${j.company}` : ""}`);
  for (const b of result.businesses || []) add("business", b.id, `${b.businessName}${b.area ? ` (${b.area})` : ""}`);
  for (const m of result.messages || []) add("message", m.id, `${m.channel} → ${m.business || m.to || "?"}`);
  for (const r of result.replies || []) add("reply", r.id, `Reply from ${r.from}`);
  for (const c of result.campaigns || []) add("campaign", c.name, c.label || c.name);

  // single-entity results
  if (result.businessName && !result.businesses) add("business", result.id || null, result.businessName);
  if (result.campaign?.name) add("campaign", result.campaign.name, result.campaign.label || result.campaign.name);

  if (conv.entities.length > MAX_ENTITIES) {
    conv.entities = conv.entities.slice(-MAX_ENTITIES);
  }
}

/**
 * Chat lambi ho gayi? Purane turns ko ek paragraph me compress karo.
 * Ye best-effort hai — fail ho jaye to chat normal chalti rehti hai
 * (bas purani baatein bhoolne lagti hain).
 */
export async function maybeSummarize(conv) {
  const unsummarized = conv.messages.length - conv.summarizedUpTo;
  if (unsummarized <= SUMMARIZE_AFTER || !hasGroq()) return conv;

  // jo messages summary me jayenge (aakhri RECENT_TURNS chhod ke)
  const upTo = conv.messages.length - RECENT_TURNS;
  if (upTo <= conv.summarizedUpTo) return conv;

  const chunk = conv.messages
    .slice(conv.summarizedUpTo, upTo)
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role.toUpperCase()}: ${(m.content || "").slice(0, 600)}`)
    .join("\n");

  if (!chunk.trim()) return conv;

  try {
    const r = await askJSON(
      `Ye ek AI assistant aur user ki baatcheet ka hissa hai. Ise compress karo taake assistant ko aage context yaad rahe.

PEHLE SE MOJOOD KHULASA (isme merge karo):
${conv.summary || "(koi nahi)"}

NAYE MESSAGES:
${chunk}

JSON return karo: { "summary": "<200 lafzon tak ka khulasa — user ne kya poocha, kya faisle hue, kaunsi cheezein (business/job naam) discuss huin, user ki preferences>" }`,
      { temperature: 0.2, maxTokens: 500 }
    );
    if (r?.summary) {
      conv.summary = String(r.summary).slice(0, 2000);
      conv.summarizedUpTo = upTo;
      await conv.save();
    }
  } catch {
    /* summarize fail — koi baat nahi, chat chalti rahegi */
  }
  return conv;
}

/** Chat list (sidebar ke liye) */
export async function listConversations(limit = 30) {
  return Conversation.find({ archived: { $ne: true } })
    .sort({ lastMessageAt: -1 })
    .limit(limit)
    .select("title lastMessageAt createdAt")
    .lean();
}

/** Conversation search (Phase 1) — title + messages me */
export async function searchConversations(q, limit = 20) {
  if (!q) return listConversations(limit);
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return Conversation.find({
    archived: { $ne: true },
    $or: [{ title: rx }, { "messages.content": rx }],
  })
    .sort({ lastMessageAt: -1 })
    .limit(limit)
    .select("title lastMessageAt createdAt")
    .lean();
}

export { groq, MODEL };
