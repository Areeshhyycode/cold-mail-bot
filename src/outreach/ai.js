/**
 * OUTREACH ka Groq client — ek jagah.
 *
 * Model string pehle TEEN jagah duplicate thi (jobEmail.js, personalizer.js,
 * dashboard/server.js). Outreach engine me wo galti dobara nahi karte.
 *
 * Har call JSON mode me hoti hai (`response_format: json_object`) aur JS us JSON
 * se final message assemble karta hai — LLM se poora email likhwana kabhi nahi.
 * Yehi is project ka mojooda usool hai: rules faisla karte hain, LLM sirf alfaaz
 * deta hai. Isse hallucination ka nuqsaan mehdood rehta hai (ek bura bullet, poora
 * bekaar email nahi).
 */
import Groq from "groq-sdk";
import dotenv from "dotenv";
import { log } from "../core/logger.js";

dotenv.config();

export const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

/** Prompt badlo to ye bump karo — analytics tab bata sakti hai naya prompt behtar tha ya nahi */
export const PROMPT_VERSION = "outreach-v1";

let client = null;
export function groq() {
  if (client) return client;
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY .env me missing hai");
  client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return client;
}

export const hasGroq = () => Boolean(process.env.GROQ_API_KEY);

/**
 * JSON completion. Groq ka free tier ~30 req/min hai — 429 pe backoff + retry,
 * warna ek bara batch aadha khali reh jata hai.
 *
 * @param {string} prompt
 * @param {object} [opts] - { temperature, maxTokens, retries }
 * @returns {Promise<object>} parsed JSON ({} agar parse fail — caller ke paas
 *   har field ka fallback hota hai, isliye throw karna faida-mand nahi)
 */
export async function askJSON(prompt, opts = {}) {
  const { temperature = 0.7, maxTokens = 900, retries = 3 } = opts;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const c = await groq().chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      });
      const raw = c.choices[0]?.message?.content || "{}";
      try {
        return JSON.parse(raw);
      } catch {
        log.warn("outreach.ai.bad_json", { note: raw.slice(0, 120) });
        return {};
      }
    } catch (err) {
      const rateLimited = /rate|429|quota|too many/i.test(err.message || "");
      if (attempt < retries && rateLimited) {
        const wait = 2000 * 2 ** attempt; // 4s, 8s
        log.warn("outreach.ai.rate_limited", { attempt, waitMs: wait });
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  return {};
}
