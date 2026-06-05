import * as cheerio from "cheerio";

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// in emails ko skip karo (junk / placeholder)
const BAD_PATTERNS = [
  "example.com",
  "example.org",
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
  "your@",
  "email@",
  "name@",
  "user@",
  "info@email",
  "test@",
  "abc@",
  "@email.",
];

// asli email ka strict format (TLD 2-24 letters)
const VALID_EMAIL = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,24}$/;

function cleanEmails(emails) {
  return [...new Set(emails)].filter((e) => {
    const low = e.toLowerCase().trim();
    if (!VALID_EMAIL.test(low)) return false;
    return !BAD_PATTERNS.some((bad) => low.includes(bad));
  });
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
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadBot/1.0)" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const html = await res.text();

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
