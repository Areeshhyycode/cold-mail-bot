import * as cheerio from "cheerio";

/**
 * Website ka "quality" check karta hai taaki pata chale kis business ko
 * naye/behtar website ki zaroorat hai.
 *
 * Returns:
 *   { quality, reasons }
 *   quality: "none"     -> website hai hi nahi  (phone outreach target)
 *            "outdated"  -> website hai par purani/poor  (EMAIL outreach target ✅)
 *            "ok"        -> modern site, in ko skip karo
 *   reasons: kis wajah se outdated mark hua (email me mention kar sakte ho)
 */
export async function auditWebsite(website) {
  if (!website || !/^https?:\/\//i.test(website)) {
    return { quality: "none", reasons: ["No website found"] };
  }

  try {
    const res = await fetch(website, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SiteAudit/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      return { quality: "none", reasons: [`Website not reachable (HTTP ${res.status})`] };
    }

    const finalUrl = res.url || website;
    const html = await res.text();
    const $ = cheerio.load(html);
    const reasons = [];

    // 1. HTTPS nahi hai
    if (!/^https:/i.test(finalUrl)) reasons.push("No HTTPS (insecure)");

    // 2. Mobile-friendly nahi (viewport meta tag missing)
    const hasViewport = $('meta[name="viewport"]').length > 0;
    if (!hasViewport) reasons.push("Not mobile-friendly (no viewport)");

    // 3. Purana copyright year (current - 2 se pehle)
    const text = $("body").text();
    const years = (text.match(/(?:©|copyright|&copy;)\s*\D{0,6}(20\d{2})/gi) || [])
      .map((m) => parseInt(m.match(/20\d{2}/)[0], 10));
    if (years.length) {
      const newest = Math.max(...years);
      const thisYear = parseInt(new Date().getFullYear(), 10) || newest;
      if (newest <= thisYear - 2) reasons.push(`Outdated content (©${newest})`);
    }

    // 4. Purani tech ke signs (tables for layout / flash / jQuery-only)
    if (/<table[^>]*>[\s\S]*<table/i.test(html)) reasons.push("Old table-based layout");
    if (/\.swf|shockwave|flash/i.test(html)) reasons.push("Uses Flash (dead tech)");

    // 5. Bohot kam content (placeholder/under-construction)
    if (text.replace(/\s+/g, " ").trim().length < 300) {
      reasons.push("Very little content (looks unfinished)");
    }

    // faisla: 1+ serious reason -> outdated
    const quality = reasons.length >= 1 ? "outdated" : "ok";
    return { quality, reasons };
  } catch (err) {
    // site load hi nahi hui / timeout -> probably no real site
    return { quality: "none", reasons: ["Website not loading / broken"] };
  }
}
