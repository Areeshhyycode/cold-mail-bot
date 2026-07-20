import { chromium } from "playwright";

/**
 * GOOGLE MAPS ADAPTER.
 *
 * Pehle ye sirf 4 field deta tha (businessName, website, phone, location).
 * Ab lead-finder ke liye poora business record nikalta hai — rating, reviews,
 * category, hours, coordinates, maps URL.
 *
 * ⚠️ BACKWARD COMPATIBLE: purane saare fields waise ke waise hain aur naam nahi
 * badle, isliye scraper/run.js (service leads) bina kisi change ke chalta rahega.
 * Naye fields sirf ADD hue hain.
 *
 * @param {string} query      - "SMCHS Karachi" ya "restaurants in Clifton Karachi"
 * @param {number} maxResults
 * @returns {Promise<Array<object>>}
 */
export async function scrapeGoogleMaps(query, maxResults = 30) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];

  try {
    const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    const feedSelector = 'div[role="feed"]';
    await page.waitForSelector(feedSelector, { timeout: 15000 }).catch(() => {});

    // results panel scroll karke zyada businesses load karo
    let prevCount = 0;
    let sameCountTimes = 0;
    while (results.length < maxResults && sameCountTimes < 4) {
      await page.evaluate((sel) => {
        const feed = document.querySelector(sel);
        if (feed) feed.scrollBy(0, 2000);
      }, feedSelector);
      await page.waitForTimeout(1500);

      const cards = await page.$$eval('div[role="feed"] > div', (nodes) =>
        nodes
          .map((n) => {
            const a = n.querySelector("a.hfpxzc");
            return { name: a?.getAttribute("aria-label") || "", link: a?.getAttribute("href") || "" };
          })
          .filter((x) => x.name)
      );

      for (const c of cards) {
        if (results.find((r) => r._link === c.link)) continue;
        results.push({ businessName: c.name, website: "", city: "", _link: c.link });
        if (results.length >= maxResults) break;
      }

      if (results.length === prevCount) sameCountTimes++;
      else sameCountTimes = 0;
      prevCount = results.length;
    }

    // ---- har business ka detail page kholo aur poora record nikalo ----
    for (const biz of results.slice(0, maxResults)) {
      try {
        await page.goto(biz._link, { waitUntil: "domcontentloaded" });
        // detail panel ka aana ZAROORI hai — warna phone/website khali aate the
        // (1.5s fixed wait kaafi nahi tha, isi liye kai businesses ka phone "—" tha)
        await page
          .waitForSelector('button[data-item-id^="phone"], a[data-item-id="authority"], button[data-item-id="address"]', { timeout: 8000 })
          .catch(() => {});
        await page.waitForTimeout(600);

        const detail = await page.evaluate(() => {
          const clean = (s, re) => (s || "").replace(re, "").trim();

          // website (authority link) — NA ho to business "no website" = HIGH PRIORITY
          const website = document.querySelector('a[data-item-id="authority"]')?.href || "";

          // PHONE — no-website leads ke liye ye SABSE ZAROORI field hai.
          // 3 tareeqe try karo (Google layout badalta rehta hai):
          let phone =
            clean(document.querySelector('button[data-item-id^="phone"]')?.getAttribute("aria-label"), /phone:?/i) ||
            (document.querySelector('a[href^="tel:"]')?.getAttribute("href") || "").replace(/^tel:/, "") ||
            "";
          if (!phone) {
            // aakhri fallback: page text me Pakistani number dhoondo
            const m = (document.body.innerText || "").match(/(?:\+92|0)\s?3\d{2}[\s-]?\d{7}|\+92\s?\d{2}[\s-]?\d{7,8}/);
            phone = m ? m[0] : "";
          }

          const address = clean(
            document.querySelector('button[data-item-id="address"]')?.getAttribute("aria-label"),
            /address:?/i
          );

          // rating — "4.5"
          const rating =
            parseFloat(document.querySelector('div.F7nice span[aria-hidden="true"]')?.textContent || "") || null;

          // reviews — Google isko kai shakl me dikhata hai, isliye 3 fallback:
          //   aria-label "128 reviews"  |  F7nice text "4.5(128)"  |  page text "128 reviews"
          let reviews = null;
          const revSrc = [
            document.querySelector('div.F7nice span[aria-label*="review" i]')?.getAttribute("aria-label"),
            document.querySelector('button[aria-label*="review" i]')?.getAttribute("aria-label"),
            document.querySelector("div.F7nice")?.textContent,
            document.body.innerText || "",
          ];
          for (const s of revSrc) {
            if (!s) continue;
            const t = s.replace(/,/g, "");
            const m = t.match(/(\d+)\s*reviews?/i) || t.match(/\((\d+)\)/);
            if (m) { reviews = parseInt(m[1], 10); break; }
          }

          const category =
            document.querySelector('button[jsaction*="category"]')?.textContent?.trim() || "";

          const hours = clean(
            document.querySelector('button[data-item-id="oh"]')?.getAttribute("aria-label"),
            /^hours:?/i
          );

          const closed = /permanently closed|temporarily closed/i.test(document.body.innerText || "");

          return { website, phone, address, rating, reviews, category, hours, closed };
        });

        Object.assign(biz, detail);
        biz.mapsUrl = page.url();
        biz.location = detail.address || "";

        // COORDINATES: page URL me @lat,lng hota hai, aur link me !3d<lat>!4d<lng>.
        // Dono try karo (page.evaluate ke andar location.href reliable nahi tha).
        const src = `${page.url()} ${biz._link}`;
        const at = src.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        const d34 = src.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
        const c = d34 || at;
        biz.lat = c ? parseFloat(c[1]) : null;
        biz.lng = c ? parseFloat(c[2]) : null;
      } catch {
        /* is business ko skip karo, baaki chalte raho */
      }
    }
  } finally {
    await browser.close();
  }

  // _link internal tha — hata do
  return results.slice(0, maxResults).map(({ _link, ...rest }) => rest);
}
