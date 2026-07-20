import * as cheerio from "cheerio";
import { fetchText } from "../core/httpCache.js";

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// junk SUBSTRINGS — email me kahin bhi mile to reject (placeholder domains, image files)
const BAD_SUBSTRINGS = [
  "example.com",
  "example.org",
  "example.net",
  "domain.com",
  "yourdomain",
  "sentry.io",
  "wixpress.com",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  "@2x",
  "your-email",
  "info@email",
  "@email.",
  "@domain.",
];

// placeholder LOCAL-PARTS (@ se pehle wala hissa) — sirf tab junk jab PURA local part
// yahi ho. (Pehle "user@" substring match karta tha jisse "thanhaeuser@bitcap.com"
// jaise asli email galti se reject ho jate the.)
const BAD_LOCALPARTS = new Set([
  "your",
  "email",
  "name",
  "user",
  "username",
  "test",
  "abc",
  "xyz",
  "example",
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
]);

// asli email ka strict format (TLD 2-24 letters)
const VALID_EMAIL = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,24}$/;

function cleanEmails(emails) {
  return [...new Set(emails)].filter((e) => {
    const low = e.toLowerCase().trim();
    if (!VALID_EMAIL.test(low)) return false;
    if (BAD_SUBSTRINGS.some((bad) => low.includes(bad))) return false;
    if (BAD_LOCALPARTS.has(low.split("@")[0])) return false; // exact local-part match only
    return true;
  });
}

/**
 * Kisi bhi free text (job description, post body) me se valid emails nikaalta hai,
 * placeholder/junk (email@example.org, your@…, info@email…) filter karke.
 * jobBoards.js isko reuse karta hai taaki sample emails galti se na bhej dein.
 * @param {string} text
 * @returns {string[]}
 */
export function extractEmailsFromText(text = "") {
  return cleanEmails(String(text).match(EMAIL_RE) || []);
}

/**
 * Ek website se email + owner name nikalne ki koshish karta hai.
 * Home page + /contact + /about check karta hai.
 * @param {string} website
 * @returns {Promise<{email: string, ownerName: string}>}
 */
export async function extractEmail(website) {
  if (!website) return { email: "", ownerName: "" };

  const base = website.replace(/\/$/, "");
  const pages = [base, `${base}/contact`, `${base}/contact-us`, `${base}/about`];

  for (const url of pages) {
    try {
      // shared cache — homepage aksar websiteAudit pehle hi utha chuka hota hai
      const res = await fetchText(url, { timeoutMs: 10000 });
      if (!res.ok) continue;
      const html = res.html;

      // mailto links priority (zyada reliable)
      const $ = cheerio.load(html);
      const mailtos = [];
      $('a[href^="mailto:"]').each((_, el) => {
        const href = $(el).attr("href") || "";
        const mail = href.replace("mailto:", "").split("?")[0].trim();
        if (mail) mailtos.push(mail);
      });

      let found = cleanEmails(mailtos);
      if (found.length === 0) {
        found = cleanEmails(html.match(EMAIL_RE) || []);
      }

      if (found.length > 0) {
        return { email: found[0], ownerName: "" };
      }
    } catch {
      /* agla page try karo */
    }
  }

  return { email: "", ownerName: "" };
}
