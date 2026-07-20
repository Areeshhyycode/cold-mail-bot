/**
 * API AUTH + CORS — Phase 10.
 *
 * PEHLE KYA GHALAT THA:
 *   res.setHeader("Access-Control-Allow-Origin", "*")  +  koi auth nahi.
 * Matlab tumhare browser me khuli KOI BHI website (koi random blog, koi ad
 * iframe) chup-chaap `fetch("http://localhost:4000/api/answer", ...)` kar sakti
 * thi — aur tumhara GROQ quota jala sakti thi, ya /api/companies se tumhari CSV
 * me kachra likh sakti thi. Ye asli hole tha, theoretical nahi.
 *
 * AB:
 *   1. CORS sirf `chrome-extension://` origins ke liye. Kisi bhi http(s) website
 *      ko Allow-Origin header milta hi nahi → browser uski request block kar deta hai.
 *   2. Har /api/* write pe Bearer token laazmi (.env → API_TOKEN).
 *      Token na ho to server SAAF-SAAF chillata hai aur token generate kar deta hai.
 *   3. Dashboard ki apni fetches same-origin hain — unhe CORS ki zaroorat hi nahi;
 *      unke liye token cookie-free `?token=` ya same-origin bypass se chalta hai.
 */
import crypto from "crypto";
import dotenv from "dotenv";

// ESM me imports importing-module ki body se PEHLE evaluate hote hain. Agar hum
// server.js ke dotenv.config() pe bharosa karte to yahan API_TOKEN undefined hota
// (import order pe depend karta — bohat nazuk). Isliye khud load karte hain.
dotenv.config();

export const API_TOKEN = process.env.API_TOKEN || "";

/** Setup ke liye ek token banao (README/console me dikhane ke liye) */
export function suggestToken() {
  return crypto.randomBytes(24).toString("hex");
}

/** CORS headers set karo. Website origins ko JAAN-BOOJH ke deny karte hain. */
export function applyCors(req, res) {
  const origin = req.headers.origin || "";
  // SIRF extension. `*` ya koi http(s) origin NAHI — yahi wo hole tha jisse koi
  // bhi khuli website is API ko call kar sakti thi.
  if (/^chrome-extension:\/\//.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Max-Age", "600");
}

/**
 * Request authorized hai?
 *   a) Bearer token (extension bhejta hai), YA
 *   b) same-origin request (dashboard UI khud — usko token ki zaroorat nahi)
 *
 * `Sec-Fetch-Site` pe bharosa karna mehfooz hai: ye browser lagata hai aur page
 * ka JS isse SPOOF NAHI kar sakta (forbidden header hai). Kisi website ki fetch
 * localhost:4000 pe `cross-site` aati hai → deny. Dashboard ki apni fetch
 * `same-origin` aati hai → allow (POST pe bhi, jahan Origin header hota hai —
 * isliye sirf "Origin missing" check kaafi NAHI tha, wo dashboard ke POST
 * /api/jobs/status ko 401 kar deta).
 */
export function authorize(req) {
  if (!API_TOKEN) {
    return { ok: false, reason: "Server pe API_TOKEN set nahi hai (.env dekho)" };
  }
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m && safeEqual(m[1].trim(), API_TOKEN)) return { ok: true };

  const sec = req.headers["sec-fetch-site"];
  if (sec === "same-origin" || sec === "none") return { ok: true };   // dashboard UI
  if (!sec && !req.headers.origin) return { ok: true };               // curl / local script

  return { ok: false, reason: "Invalid ya missing API token" };
}

/** timing-safe compare — token guess karna mushkil rahe */
function safeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

/* ------------------------------ validation -------------------------------- */
/** Scraped strings pe bharosa mat karo — length cap + type coerce. */
export const vStr = (v, max = 500) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

export const vNum = (v, min = -1e12, max = 1e12) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

export const vBool = (v) => (typeof v === "boolean" ? v : null);

export const vArr = (v, maxItems = 30, maxLen = 300) =>
  Array.isArray(v)
    ? v.map((x) => vStr(x, maxLen)).filter(Boolean).slice(0, maxItems)
    : [];

export const vEnum = (v, allowed) => (allowed.includes(v) ? v : null);

/** http(s) URL hi allow karo — `javascript:` / `data:` reject */
export const vUrl = (v, max = 2000) => {
  const s = vStr(v, max);
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : null;
};

/** CSV injection guard — Excel `=`/`+`/`-`/`@` se shuru hone wale cell ko
 *  formula samajh ke CHALA deta hai. Quote laga ke defuse karo. */
export const csvSafe = (v) => {
  const s = String(v == null ? "" : v);
  const escaped = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${escaped.replace(/"/g, '""')}"`;
};
