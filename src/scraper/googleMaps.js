import { chromium } from "playwright";

/**
 * Google Maps se businesses scrape karta hai.
 * @param {string} query  - jaise "dentist in Lahore" ya "web design agency in Karachi"
 * @param {number} maxResults - kitne businesses chahiye
 * @returns {Promise<Array<{businessName, website, city}>>}
 */
export async function scrapeGoogleMaps(query, maxResults = 30) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];

  try {
    const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // results panel scroll karke zyada businesses load karo
    const feedSelector = 'div[role="feed"]';
    await page.waitForSelector(feedSelector, { timeout: 15000 }).catch(() => {});

    let prevCount = 0;
    let sameCountTimes = 0;
    while (results.length < maxResults && sameCountTimes < 4) {
      // scroll
      await page.evaluate((sel) => {
        const feed = document.querySelector(sel);
        if (feed) feed.scrollBy(0, 2000);
      }, feedSelector);
      await page.waitForTimeout(1500);

      // har business card padho
      const cards = await page.$$eval('div[role="feed"] > div', (nodes) => {
        return nodes
          .map((n) => {
            const nameEl = n.querySelector('a.hfpxzc');
            const name = nameEl?.getAttribute("aria-label") || "";
            const link = nameEl?.getAttribute("href") || "";
            return { name, link };
          })
          .filter((x) => x.name);
      });

      for (const c of cards) {
        if (results.find((r) => r._link === c.link)) continue;
        results.push({ businessName: c.name, website: "", city: "", _link: c.link });
        if (results.length >= maxResults) break;
      }

      if (results.length === prevCount) sameCountTimes++;
      else sameCountTimes = 0;
      prevCount = results.length;
    }

    // har business ka website nikalo (detail page khol kar)
    for (const biz of results.slice(0, maxResults)) {
      try {
        await page.goto(biz._link, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1500);
        const website = await page
          .$eval('a[data-item-id="authority"]', (el) => el.href)
          .catch(() => "");
        biz.website = website;
      } catch {
        /* skip */
      }
    }
  } finally {
    await browser.close();
  }

  // _link hata do, clean data return karo
  return results.slice(0, maxResults).map(({ _link, ...rest }) => rest);
}
