/**
 * HTML FETCH CACHE — ek hi URL bar-bar download na ho.
 *
 * MASLA: har SERVICE lead ke liye wahi website TEEN baar fetch hoti thi —
 *   1. websiteAudit.js     (quality check)
 *   2. emailExtractor.js   (email dhoondne)
 *   3. personalizer.js     (AI ko context dene)
 * Teeno alag-alag `fetch` karte the. Yaani 3× network, 3× time, 3× rate-limit
 * risk — bilkul same HTML ke liye.
 *
 * HAL: ek chhota in-memory cache (per process). Pehli baar download, baaki do
 * baar cache se. Scraper ek hi process me teeno chalata hai, isliye 3 fetch → 1.
 */
const cache = new Map(); // url -> { ok, html, status, finalUrl }
const MAX_ENTRIES = 500; // memory bound — bade runs me phoolne na de

/**
 * @param {string} url
 * @returns {Promise<{ok:boolean, html:string, status:number, finalUrl:string}>}
 *          Kabhi throw NAHI karta — fail hone pe { ok:false } deta hai.
 */
export async function fetchText(url, { timeoutMs = 12000 } = {}) {
  if (!url) return { ok: false, html: "", status: 0, finalUrl: "" };
  if (cache.has(url)) return cache.get(url);

  let out = { ok: false, html: "", status: 0, finalUrl: url };
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadBot/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    out = {
      ok: res.ok,
      html: res.ok ? await res.text() : "",
      status: res.status,
      finalUrl: res.url || url,
    };
  } catch {
    /* network/timeout -> ok:false */
  }

  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(url, out);
  return out;
}

export function clearCache() {
  cache.clear();
}
