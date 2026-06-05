/**
 * Email verification — FREE, koi paid API nahi.
 * Domain ke MX records check karta hai Cloudflare DoH (HTTPS) se.
 * (User ke network pe normal DNS block hai, isliye DoH use karte hain.)
 *
 * Returns: "valid" | "invalid" | "risky"
 *   valid   -> syntax theek + domain ke MX records hain (mail le sakta hai)
 *   invalid -> syntax kharab ya domain pe MX nahi
 *   risky   -> free/disposable provider (bhej sakte ho par dhyan se)
 */

const VALID_SYNTAX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,24}$/;

const RISKY_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "aol.com",
  "icloud.com",
  "mail.com",
  "proton.me",
];

// MX cache (ek hi domain baar baar query na ho)
const mxCache = new Map();

async function hasMX(domain) {
  if (mxCache.has(domain)) return mxCache.get(domain);
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${domain}&type=MX`,
      { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(8000) }
    );
    const data = await res.json();
    const ok = data.Status === 0 && Array.isArray(data.Answer) && data.Answer.length > 0;
    mxCache.set(domain, ok);
    return ok;
  } catch {
    return false;
  }
}

export async function verifyEmail(email) {
  const e = (email || "").toLowerCase().trim();
  if (!VALID_SYNTAX.test(e)) return "invalid";

  const domain = e.split("@")[1];
  const mx = await hasMX(domain);
  if (!mx) return "invalid";

  if (RISKY_DOMAINS.includes(domain)) return "risky";
  return "valid";
}
