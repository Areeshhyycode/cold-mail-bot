/**
 * MULTI-PROVIDER AI — ek provider ka quota khatam ho to AGLE pe switch.
 *
 * KYUN: Groq ka free daily limit (200K tokens/day) khatam ho jata tha → apply
 * autofill/personalize chup-chaap band ho jate the (khali fields). Ab har call
 * providers ki list pe try hoti hai; 429 (rate-limit) ya fail → agla provider.
 * Har provider ka apna LEGIT free tier (alag account/key), apni ToS ke andar.
 *
 * ENV (jitni ho utni daalo — order yahi hai):
 *   GROQ_API_KEY        (comma-separated multiple keys allowed: "k1,k2")
 *   GEMINI_API_KEY      (Google AI Studio — free + generous)
 *   OPENROUTER_API_KEY  (free models)
 *   CEREBRAS_API_KEY    (free tier)
 *
 * Use: const text = await aiChat(messages, { temperature, max_tokens, json });
 */
import dotenv from "dotenv";
import { GROQ_MODEL } from "./model.js";

dotenv.config();

const keys = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);

/* ------------------------------- providers -------------------------------- */
// OpenAI-compatible (Groq, OpenRouter, Cerebras) — same request shape
async function callOpenAICompat({ url, key, model, messages, opts, extraHeaders }) {
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(extraHeaders || {}) },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.5,
      max_tokens: opts.max_tokens || 1024,
      ...(opts.reasoning_effort ? { reasoning_effort: opts.reasoning_effort } : {}),
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (r.status === 429) { const e = new Error("rate_limit"); e.rate = true; throw e; }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return (j.choices?.[0]?.message?.content || "").trim();
}

// Gemini — alag request shape
async function callGemini({ key, model, messages, opts }) {
  const sys = messages.find((m) => m.role === "system")?.content;
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  if (!contents.length && sys) contents.push({ role: "user", parts: [{ text: sys }] });

  const body = {
    contents,
    ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
    generationConfig: {
      temperature: opts.temperature ?? 0.5,
      maxOutputTokens: opts.max_tokens || 1024,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  if (r.status === 429) { const e = new Error("rate_limit"); e.rate = true; throw e; }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return (j.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "").trim();
}

/* provider list env se banao (order = fallback order) */
function buildProviders() {
  const list = [];
  for (const key of keys(process.env.GROQ_API_KEY))
    list.push({ name: "groq", call: (m, o) => callOpenAICompat({ url: "https://api.groq.com/openai/v1/chat/completions", key, model: GROQ_MODEL, messages: m, opts: o }) });
  for (const key of keys(process.env.GEMINI_API_KEY))
    list.push({ name: "gemini", call: (m, o) => callGemini({ key, model: process.env.GEMINI_MODEL || "gemini-2.0-flash", messages: m, opts: o }) });
  for (const key of keys(process.env.OPENROUTER_API_KEY))
    list.push({ name: "openrouter", call: (m, o) => callOpenAICompat({ url: "https://openrouter.ai/api/v1/chat/completions", key, model: process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free", messages: m, opts: o }) });
  for (const key of keys(process.env.CEREBRAS_API_KEY))
    list.push({ name: "cerebras", call: (m, o) => callOpenAICompat({ url: "https://api.cerebras.ai/v1/chat/completions", key, model: process.env.CEREBRAS_MODEL || "llama-3.3-70b", messages: m, opts: o }) });
  return list;
}

let _warned = false;

/**
 * Multi-provider chat. messages = [{role, content}], opts = { temperature,
 * max_tokens, json, reasoning_effort }. Returns text; sab fail ho to throw.
 */
export async function aiChat(messages, opts = {}) {
  const providers = buildProviders();
  if (!providers.length) throw new Error("Koi AI key set nahi (GROQ_API_KEY / GEMINI_API_KEY …)");

  let lastErr;
  for (const p of providers) {
    try {
      const text = await p.call(messages, opts);
      if (text) return text;
      lastErr = new Error(`${p.name}: empty`);
    } catch (e) {
      lastErr = e;
      // rate-limit ya fail → agle provider pe (chup-chaap)
      if (!_warned && e.rate) { console.log(`   ⚠️  ${p.name} rate-limited — agle provider pe switch`); _warned = true; }
    }
  }
  throw lastErr || new Error("Sab AI providers fail");
}

/** kitne providers configured hain (doctor/debug ke liye). */
export function aiProviderCount() {
  return buildProviders().length;
}
