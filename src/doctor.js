/**
 * PREFLIGHT HEALTH CHECK — `npm run doctor`
 *
 * KYUN: bot 8 hafte tak chup-chaap 0 emails bhejta raha kyunki 3 cheezein ek
 * saath mari thi (Gmail App Password revoke, Groq model 404, Mongo IP block) —
 * aur koi signal nahi tha. Alert khud SMTP pe depend karta tha jo TOOTA HUA tha.
 *
 * Ab: ye script har live dependency ko ACTUALLY test karti hai (sirf env padhne
 * ke bajaye). Koi CRITICAL check fail ho to process EXIT 1 karta hai. CI me ye
 * `npm run daily` se PEHLE (bina continue-on-error) chalta hai — fail hone pe
 * poora workflow RED ho jata hai aur GitHub khud failure email bhejta hai. Ye wo
 * notification channel hai jo tumhare toote SMTP pe depend NAHI karta.
 *
 * Usage:
 *   npm run doctor           # sab checks, table print, exit 0/1
 *   node src/doctor.js --quiet   # sirf failures print karo
 */
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import { resolve } from "path";
import { GROQ_MODEL } from "./ai/model.js";

dotenv.config();

const QUIET = process.argv.includes("--quiet");

// { name, critical, run: async () => ({ ok, detail }) }
const CHECKS = [
  {
    name: "Env vars present",
    critical: true,
    async run() {
      const required = ["MONGODB_URI", "GROQ_API_KEY", "SMTP_USER", "SMTP_PASS"];
      const missing = required.filter((k) => !process.env[k]);
      return missing.length
        ? { ok: false, detail: `missing: ${missing.join(", ")}` }
        : { ok: true, detail: "all required vars set" };
    },
  },
  {
    name: "Gmail SMTP login",
    critical: true,
    async run() {
      if (!process.env.SMTP_USER || !process.env.SMTP_PASS)
        return { ok: false, detail: "SMTP_USER / SMTP_PASS missing" };
      const t = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      try {
        await t.verify();
        return { ok: true, detail: `authenticated as ${process.env.SMTP_USER}` };
      } catch (e) {
        const hint =
          e.responseCode === 535
            ? "App Password reject — https://myaccount.google.com/apppasswords se naya banao"
            : e.message.split("\n")[0];
        return { ok: false, detail: hint };
      }
    },
  },
  {
    name: `Groq model (${GROQ_MODEL})`,
    critical: true,
    async run() {
      if (!process.env.GROQ_API_KEY) return { ok: false, detail: "GROQ_API_KEY missing" };
      try {
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 5,
          }),
        });
        if (r.status === 200) return { ok: true, detail: "model reachable" };
        const j = await r.json().catch(() => ({}));
        const msg = j?.error?.message || `HTTP ${r.status}`;
        const hint =
          r.status === 404
            ? `model gaayab — GROQ_MODEL badlo (available: openai/gpt-oss-120b, qwen/qwen3.8-27b)`
            : msg;
        return { ok: false, detail: hint };
      } catch (e) {
        return { ok: false, detail: `network: ${e.message}` };
      }
    },
  },
  {
    name: "MongoDB Atlas connect",
    critical: true,
    async run() {
      if (!process.env.MONGODB_URI) return { ok: false, detail: "MONGODB_URI missing" };
      try {
        await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 12000 });
        const name = mongoose.connection.name;
        await mongoose.disconnect();
        return { ok: true, detail: `connected to db "${name}"` };
      } catch (e) {
        const hint = /whitelist|IP that isn't/i.test(e.message)
          ? "current IP Atlas Network Access me nahi (cloud.mongodb.com → 0.0.0.0/0 for CI)"
          : e.message.split("\n")[0].slice(0, 120);
        return { ok: false, detail: hint };
      }
    },
  },
  {
    name: "Failure alert channel configured",
    critical: false, // non-critical: warn karo, fail mat karo
    async run() {
      const hasTelegram = process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID;
      const hasEmail = process.env.NOTIFY_EMAIL || process.env.SMTP_USER;
      if (hasTelegram) return { ok: true, detail: "Telegram set" };
      if (hasEmail)
        return { ok: true, detail: "self-email fallback (SMTP theek hona zaroori)" };
      return { ok: false, detail: "koi alert channel nahi — NOTIFY_EMAIL ya TELEGRAM_* set karo" };
    },
  },
];

export async function runChecks() {
  const results = [];
  for (const c of CHECKS) {
    let res;
    try {
      res = await c.run();
    } catch (e) {
      res = { ok: false, detail: `check crashed: ${e.message}` };
    }
    results.push({ ...c, ...res });
  }
  return results;
}

async function main() {
  const results = await runChecks();
  const pad = Math.max(...results.map((r) => r.name.length));

  if (!QUIET) console.log("\n🩺 Cold Mail Bot — Health Check\n");
  for (const r of results) {
    if (QUIET && r.ok) continue;
    const icon = r.ok ? "✅" : r.critical ? "❌" : "⚠️ ";
    console.log(`${icon} ${r.name.padEnd(pad)}  ${r.detail}`);
  }

  const criticalFails = results.filter((r) => !r.ok && r.critical);
  if (criticalFails.length) {
    console.log(
      `\n🛑 ${criticalFails.length} CRITICAL check(s) fail. Bot chal nahi payega — upar wale hints follow karo.\n`
    );
    // process.exit(1) NAHI — npm ke through pipe pe wo buffered stdout ko truncate
    // kar deta hai (table print hi nahi hoti). exitCode set karo, event loop khud
    // drain kar ke isi code se exit karega.
    process.exitCode = 1;
    return;
  }
  console.log("\n✅ Sab critical checks pass — bot ready.\n");
  process.exitCode = 0;
}

// direct run pe hi execute karo (import karne pe nahi). Windows pe npm kabhi
// drive-letter ka case badal deta hai (c: vs C:) — isliye normalize + lowercase
// compare, warna guard chup-chaap fail ho jata aur table print hi nahi hoti.
const norm = (p) => resolve(p).replace(/\\/g, "/").toLowerCase();
if (process.argv[1] && norm(fileURLToPath(import.meta.url)) === norm(process.argv[1])) {
  main();
}
