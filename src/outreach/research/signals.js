/**
 * SIGNAL EXTRACTION — website HTML se socials, contacts, tech stack, contact form.
 *
 * Sab regex/cheerio — koi AI nahi (free + reproducible). Research index.js isse
 * call karta hai us HTML par jo httpCache pehle utha chuka hota hai.
 */

/* ------------------------------ social links ------------------------------ */
const SOCIAL_PATTERNS = {
  facebook: /(?:facebook\.com|fb\.com|fb\.me)\/[^\s"'<>)]+/i,
  instagram: /instagram\.com\/[^\s"'<>)]+/i,
  linkedin: /linkedin\.com\/(?:company|in)\/[^\s"'<>)]+/i,
  twitter: /(?:twitter\.com|x\.com)\/[^\s"'<>)]+/i,
  youtube: /(?:youtube\.com\/(?:channel|c|user|@)|youtu\.be)\/?[^\s"'<>)]*/i,
};

// generic share/login URLs jo har site pe hoti hain — inhe business ka page mat samjho
const SOCIAL_JUNK = /(?:sharer|share\.php|intent\/tweet|login|\/plugins\/|dialog\/)/i;

function cleanUrl(u = "") {
  let s = u.replace(/["'<>)]+$/, "").replace(/[?#].*$/, "");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return s;
}

/**
 * @param {import('cheerio').CheerioAPI} $
 * @param {string} html
 * @param {string} website
 * @returns {{socials:object, emails:string[], phones:string[], text:string}}
 */
export function extractSignals($, html, website) {
  const socials = {};

  // 1) anchor href se (sabse bharosemand)
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (SOCIAL_JUNK.test(href)) return;
    for (const [name, re] of Object.entries(SOCIAL_PATTERNS)) {
      if (!socials[name] && re.test(href)) socials[name] = cleanUrl(href.match(re)[0]);
    }
    // WhatsApp click-to-chat link
    if (!socials.whatsapp) {
      const m = href.match(/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?(\d{8,15})/i);
      if (m) socials.whatsapp = m[1];
    }
  });

  // 2) raw HTML se (jo anchor me na mile — inline text/script me ho)
  for (const [name, re] of Object.entries(SOCIAL_PATTERNS)) {
    if (socials[name]) continue;
    const m = html.match(re);
    if (m && !SOCIAL_JUNK.test(m[0])) socials[name] = cleanUrl(m[0]);
  }

  // text (script/style hata ke) — emails, phones, AI summary
  $("script, style, noscript, svg").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();

  const emails = extractEmails(html, text);
  const phones = extractPhones(text, html);

  return { socials, emails, phones, text };
}

/* --------------------------------- emails --------------------------------- */
function extractEmails(html, text) {
  const found = new Set();
  // mailto: sabse saaf
  for (const m of html.matchAll(/mailto:([^\s"'?<>]+@[^\s"'?<>]+)/gi)) {
    found.add(m[1].toLowerCase());
  }
  for (const m of text.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
    found.add(m[0].toLowerCase());
  }
  // image/tracking junk hata do
  return [...found]
    .filter((e) => !/\.(png|jpg|jpeg|gif|webp|svg|css|js)$/i.test(e))
    .filter((e) => !/^(example|test|email|user|name|your)@/i.test(e))
    .slice(0, 5);
}

/* --------------------------------- phones --------------------------------- */
function extractPhones(text, html) {
  const found = new Set();
  // tel: links
  for (const m of html.matchAll(/tel:([+\d][\d\s()-]{7,})/gi)) {
    found.add(m[1].replace(/[^\d+]/g, ""));
  }
  // PK numbers text me: 0300-1234567 / +92 300 1234567 / (021) 111-222-333
  for (const m of text.matchAll(/(?:\+?92|0)[\s-]?3\d{2}[\s-]?\d{7}/g)) {
    found.add(m[0].replace(/[\s-]/g, ""));
  }
  return [...found].slice(0, 5);
}

/* ------------------------------- tech stack ------------------------------- */
export function detectTechStack($, html) {
  const stack = new Set();
  const has = (re) => re.test(html);

  if (has(/wp-content|wp-includes|wordpress/i)) stack.add("WordPress");
  if (has(/cdn\.shopify\.com|shopify/i)) stack.add("Shopify");
  if (has(/wix\.com|wixstatic/i)) stack.add("Wix");
  if (has(/squarespace/i)) stack.add("Squarespace");
  if (has(/webflow/i)) stack.add("Webflow");
  if (has(/_next\/static|__NEXT_DATA__/i)) stack.add("Next.js");
  if (has(/react|reactdom/i)) stack.add("React");
  if (has(/jquery/i)) stack.add("jQuery");
  if (has(/bootstrap/i)) stack.add("Bootstrap");
  if (has(/elementor/i)) stack.add("Elementor");
  if ($('meta[name="generator"]').length) {
    const g = $('meta[name="generator"]').attr("content") || "";
    if (g) stack.add(g.split(/[\s\d]/)[0]);
  }
  return [...stack].slice(0, 6);
}

/* ------------------------------ contact form ------------------------------ */
/**
 * Phase 6 — site pe contact form dhoondo aur uske fields nikaalo (message ki
 * length adapt karne ke liye).
 *
 * @returns {{url:string, fields:string[]}}
 */
export function findContactForm($, website) {
  let best = null;
  let bestScore = -1;

  $("form").each((_, el) => {
    const $f = $(el);
    const fields = [];
    let hasTextarea = false;

    $f.find("input, textarea, select").each((__, inp) => {
      const $i = $(inp);
      const type = ($i.attr("type") || $i.get(0).tagName || "").toLowerCase();
      if (["hidden", "submit", "button"].includes(type)) return;
      const name = ($i.attr("name") || $i.attr("id") || $i.attr("placeholder") || type).trim();
      if (name) fields.push(name.slice(0, 40));
      if (type === "textarea") hasTextarea = true;
    });

    // contact form ki pehchaan: textarea (message box) + email/name field
    const blob = ($f.attr("id") || "") + " " + ($f.attr("class") || "") + " " + ($f.attr("action") || "");
    const looksContact = /contact|message|enquir|inquir|get.?in.?touch|quote/i.test(blob) || hasTextarea;
    if (!fields.length || !looksContact) return;

    let score = fields.length + (hasTextarea ? 5 : 0);
    if (/contact|enquir|inquir/i.test(blob)) score += 3;
    if (score > bestScore) {
      bestScore = score;
      const action = $f.attr("action") || "";
      best = { url: absolute(action, website), fields };
    }
  });

  if (!best) return { url: "", fields: [] };
  return best;
}

function absolute(action, website) {
  if (!action || action === "#") return website;
  try {
    return new URL(action, website).href;
  } catch {
    return website;
  }
}
