/**
 * AGENT LOOP — Task 8, Phases 2/3/5/6/10.
 *
 * Ye wo jagah hai jahan natural language → tool calls → jawab banta hai.
 *
 * Loop:
 *   1. history + system prompt banao
 *   2. Groq ko tools ke saath bhejo (streaming)
 *   3. model tool_calls maange → permission check → chalao → result wapas
 *   4. jab tak model tools maangta rahe, dohrao (max MAX_HOPS)
 *   5. aakhri text stream kar do
 *
 * SEND-GATE (sabse ahem safety):
 *   Jo tools bahar duniya me kuch bhejte hain (asli email) wo PEHLI baar me
 *   kabhi nahi chalte. Wo ek `confirmationRequired` event return karte hain,
 *   UI confirm button dikhata hai, aur agla request `confirm: [toolName]` ke
 *   saath aata hai. Iska matlab: AI ka ghalat samajhna ya prompt-injection
 *   kabhi bhi khud-ba-khud tumhare client ko email nahi bhej sakta.
 *
 * Streaming: har event ek callback (`emit`) se jata hai — SSE, WebSocket, ya
 * test me array, sab chal jate hain.
 */
import { groq, hasGroq, MODEL } from "../outreach/ai.js";
import { TOOL_MAP, toolSchemas } from "./tools.js";
import { checkPermission, describeRole } from "./permissions.js";
import { rememberEntities } from "./memory.js";
import { PROFILE } from "../ai/profile.js";

const MAX_HOPS = 6;              // tool → model → tool … kitni baar
const TOOL_TIMEOUT_MS = 60000;

/* ------------------------------ system prompt ---------------------------- */
function systemPrompt({ role, now }) {
  return `Tum "Nova" ho — is platform ki AI assistant. Platform ka maalik ${PROFILE.name} hai (${PROFILE.title}, ${PROFILE.location}).

Ye platform do kaam karta hai:
  1. JOB HUNTING — jobs scrape hoti hain (Chrome extension + job boards), AI match score lagta hai, resume/cover letter banta hai, application track hoti hai.
  2. AGENCY OUTREACH — Karachi ke businesses dhoonde jate hain (khaas kar jinki website nahi), unki website audit hoti hai, personalized outreach emails/WhatsApp bhejte hain, replies AI classify karti hai.

TUMHARA KAAM: user se normal baat karo aur andar hi andar sahi tools chala ke kaam kar do. User ko kabhi ye na poochho "kaunsa module use karun" — ye tumhara kaam hai.

TOOLS KA ISTEMAL:
- Jab bhi asli data chahiye — TOOL CHALAO. Apne paas se numbers KABHI mat banao.
- Ek se zyada tool chal sakte hain. Jaise "DHA ke restaurants jinki website nahi" → search_businesses(area, category, hasWebsite=false).
- Bara kaam? Pehle chhote steps me todo, phir ek ek kar ke chalao.
- Agar tool khali result de to saaf bolo "kuch nahi mila" — jhoota data mat banao.
- Kisi cheez ka id/key chahiye to pehle search wala tool chalao.

JAWAB KA ANDAAZ:
- Markdown use karo. LIST ka data hamesha TABLE me do.
- Chhota rakho. User ko faisla lene layak baat do, JSON dump nahi.
- Numbers hamesha wahi jo tool se aaye.
- Roman Urdu + English mix theek hai (user aise hi baat karta hai).

EXPLAINABILITY (zaroori):
Jab bhi koi recommendation ya faisla do, aakhir me ye block lagao:

> **Why:** <ek line — kis cheez ki bina par>
> **Confidence:** <0-100>% · **Sources:** <kaunse tools/collections se data aaya>
> **Next:** <ek concrete agla qadam>

Ye block sirf recommendations pe lagao — simple sawaal ("kitni jobs hain") pe zaroori nahi.

SAFETY:
- Jo tool asli email bhejta hai wo user ki confirmation ke baghair KABHI nahi chalega — system khud rok dega. Tum bas bata do ke kya bhejne wale ho.
- Draft banana safe hai. Bhejna nahi.

TUMHARA ROLE ABHI: ${describeRole(role)}
ABHI KA WAQT: ${now}`;
}

/* --------------------------- tool execution ------------------------------ */
async function runTool(tool, args, { role, confirmed }) {
  const perm = checkPermission(tool, role);
  if (!perm.ok) {
    return { ok: false, error: `PERMISSION DENIED: ${perm.reason}`, denied: true };
  }

  // send-risk → pehli baar sirf confirmation maango
  if (perm.needsConfirm && !confirmed.includes(tool.name)) {
    return {
      ok: false,
      needsConfirmation: true,
      error:
        `CONFIRMATION REQUIRED: "${tool.name}" asli duniya me kuch bhejta hai (wapas nahi ho sakta). ` +
        `User ko batao ke tum kya bhejne wale ho aur explicit "haan bhejo" ka intezaar karo. Tool abhi NAHI chala.`,
    };
  }

  const started = Date.now();
  try {
    const result = await Promise.race([
      tool.run(args || {}),
      new Promise((_, rej) => setTimeout(() => rej(new Error("Tool timeout (60s)")), TOOL_TIMEOUT_MS)),
    ]);
    return { ok: true, result, tookMs: Date.now() - started };
  } catch (e) {
    return { ok: false, error: e.message, tookMs: Date.now() - started };
  }
}

/**
 * Poora ek turn chalao.
 *
 * @param {object} o
 * @param {Array}  o.history   — buildHistory() se
 * @param {string} o.role      — permissions
 * @param {string[]} o.confirmed — jin send-tools ko user ne haan ki
 * @param {function} o.emit    — (event, data) => void   [SSE ke liye]
 * @param {object} o.conv      — Conversation doc (entities yaad rakhne ke liye)
 * @returns {Promise<{content:string, toolCalls:Array, needsConfirmation:object|null}>}
 */
export async function runAgent({ history, role = "admin", confirmed = [], emit = () => {}, conv = null }) {
  if (!hasGroq()) {
    const msg = "GROQ_API_KEY set nahi hai — AI assistant kaam nahi kar sakti. .env me key daalo.";
    emit("token", { text: msg });
    return { content: msg, toolCalls: [], needsConfirmation: null };
  }

  const client = groq();
  const messages = [
    { role: "system", content: systemPrompt({ role, now: new Date().toLocaleString() }) },
    ...history,
  ];

  const allToolCalls = [];
  let pendingConfirmation = null;
  let finalText = "";

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const stream = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: toolSchemas(),
      tool_choice: "auto",
      temperature: 0.4,
      max_tokens: 1800,
      stream: true,
    });

    let text = "";
    const toolCalls = [];      // { id, name, args(string) }

    for await (const chunk of stream) {
      const d = chunk.choices?.[0]?.delta;
      if (!d) continue;

      if (d.content) {
        text += d.content;
        emit("token", { text: d.content });
      }

      // tool calls streaming me TUKRON me aate hain — index se jodna parta hai
      for (const tc of d.tool_calls || []) {
        const i = tc.index ?? 0;
        if (!toolCalls[i]) toolCalls[i] = { id: tc.id || "", name: "", args: "" };
        if (tc.id) toolCalls[i].id = tc.id;
        if (tc.function?.name) toolCalls[i].name += tc.function.name;
        if (tc.function?.arguments) toolCalls[i].args += tc.function.arguments;
      }
    }

    const calls = toolCalls.filter(Boolean).filter((c) => c.name);

    // koi tool nahi maanga → yehi final jawab hai
    if (!calls.length) {
      finalText = text;
      break;
    }

    // model ka tool-call turn history me daalo
    messages.push({
      role: "assistant",
      content: text || null,
      tool_calls: calls.map((c) => ({
        id: c.id, type: "function", function: { name: c.name, arguments: c.args || "{}" },
      })),
    });

    // har tool chalao
    for (const c of calls) {
      const tool = TOOL_MAP[c.name];
      let args = {};
      try { args = c.args ? JSON.parse(c.args) : {}; } catch { args = {}; }

      emit("tool_start", { name: c.name, args });

      if (!tool) {
        messages.push({ role: "tool", tool_call_id: c.id, content: `ERROR: "${c.name}" naam ka koi tool nahi hai.` });
        emit("tool_end", { name: c.name, ok: false, error: "unknown tool" });
        continue;
      }

      const out = await runTool(tool, args, { role, confirmed });

      if (out.needsConfirmation) {
        pendingConfirmation = { tool: c.name, args, description: tool.description };
        emit("confirm_required", pendingConfirmation);
      }

      const record = {
        name: c.name,
        args,
        ok: out.ok,
        error: out.error || null,
        meta: out.result?._meta || null,
        tookMs: out.tookMs ?? null,
      };
      allToolCalls.push(record);
      emit("tool_end", record);

      if (out.ok && conv) {
        try { await rememberEntities(conv, c.name, out.result); } catch { /* non-fatal */ }
      }

      messages.push({
        role: "tool",
        tool_call_id: c.id,
        content: out.ok
          ? JSON.stringify(out.result).slice(0, 12000)   // context guard
          : `ERROR: ${out.error}`,
      });
    }
  }

  // MAX_HOPS khatam par model ne kuch nahi likha
  if (!finalText) {
    finalText = allToolCalls.length
      ? "Maine data nikal liya hai (upar tool results dekho), par jawab likhte hue ruk gayi. Dobara poochho ya sawaal thoda specific karo."
      : "Samajh nahi aayi — thoda aur detail se batao?";
    emit("token", { text: finalText });
  }

  return { content: finalText, toolCalls: allToolCalls, needsConfirmation: pendingConfirmation };
}

/* --------------------- explainability extraction ------------------------- */
/** Jawab ke "Why/Confidence/Sources/Next" block ko structured shape me nikaalo */
export function extractExplain(text, toolCalls = []) {
  const grab = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
  const conf = grab(/\*\*Confidence:\*\*\s*(\d{1,3})\s*%/i);
  return {
    sources: [...new Set(toolCalls.filter((t) => t.ok).map((t) => t.meta?.source || t.name))],
    confidence: conf ? Math.min(100, parseInt(conf, 10)) : null,
    reasoning: grab(/\*\*Why:\*\*\s*(.+?)(?:\n|$)/i),
    nextAction: grab(/\*\*Next:\*\*\s*(.+?)(?:\n|$)/i),
  };
}
