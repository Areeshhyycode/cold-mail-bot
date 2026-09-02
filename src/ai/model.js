/**
 * SINGLE SOURCE OF TRUTH for the Groq model id.
 *
 * KYUN: pehle "llama-3.3-70b-versatile" 9 files me hardcoded tha. Groq ne poori
 * Llama family apne account se HATA di (404: "model does not exist") — aur saari
 * AI features (personalization, job analysis, cover letters, assistant, apply
 * answers) chup-chaap mar gayin. Ab model sirf yahan (ya GROQ_MODEL env se) set
 * hota hai — ek jagah badlo, sab theek.
 *
 * Live models (Sept 2026): openai/gpt-oss-120b, openai/gpt-oss-20b,
 * qwen/qwen3.8-27b, groq/compound. 120b = sabse capable, isliye default.
 */
const DEFAULT_MODEL = "openai/gpt-oss-120b";

// Groq ne jo models HATA diye — agar koi purana GROQ_MODEL secret/.env me reh
// gaya ho to usse IGNORE karo (warna stale secret code fix ko override kar deta
// aur CI phir bhi 404 karta). Naya model chahiye to bas DEFAULT_MODEL badlo ya
// ek VALID model GROQ_MODEL env me daalo.
const DEAD_MODELS = new Set([
  "llama-3.3-70b-versatile",
  "llama-3.1-70b-versatile",
  "llama-3.1-8b-instant",
  "mixtral-8x7b-32768",
  "gemma-7b-it",
  "gemma2-9b-it",
]);

const envModel = (process.env.GROQ_MODEL || "").trim();
export const GROQ_MODEL = envModel && !DEAD_MODELS.has(envModel) ? envModel : DEFAULT_MODEL;

if (envModel && DEAD_MODELS.has(envModel)) {
  console.warn(
    `⚠️  GROQ_MODEL="${envModel}" Groq se hata diya gaya hai — "${DEFAULT_MODEL}" use kar rahe hain. ` +
      `GitHub secret / .env me GROQ_MODEL update kar do.`
  );
}
