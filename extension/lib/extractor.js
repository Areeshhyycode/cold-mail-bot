/* Job Apply Assistant — page extractors (ES module).
 *
 * ⚠️  CRITICAL CONSTRAINT — inhe SELF-CONTAINED rehna hai.
 * Ye do functions chrome.scripting.executeScript({func}) ko diye jate hain.
 * Chrome inhe .toString() kar ke JOB SITE ke page me dobara evaluate karta hai —
 * jahan is module ka scope MOJOOD NAHI hota. Isliye:
 *   ❌ module ke top-level helpers use MAT karo (ReferenceError aayega page me)
 *   ✅ har helper function ke ANDAR define karo
 * Yahi wajah thi ke pehle poora extractor background.js me copy-paste tha —
 * ab file EK hai, dono contexts (popup + service worker) isse import karte hain,
 * aur function reference executeScript ko pass hota hai. Duplication khatam.
 *
 * extractCards()  → search-results page se saare job cards (tez, har 4-6 fields)
 * extractDetail() → EK job ki detail page se poora record (30+ fields)
 */

/* ========================================================================== *
 *  extractCards — search results page (Indeed / LinkedIn / Rozee / generic)
 * ========================================================================== */
export function extractCards() {
  const abs = (h) => {
    if (!h) return null;
    try { return new URL(h, location.href).href.split("#")[0]; } catch { return h; }
  };
  const txt = (root, sels) => {
    if (!root) return null;
    for (const s of sels) {
      const el = root.querySelector(s);
      const t = el && (el.getAttribute("title") || el.textContent || "").trim();
      if (t) return t.replace(/\s+/g, " ");
    }
    return null;
  };
  const attr = (root, sels, a) => {
    if (!root) return null;
    for (const s of sels) {
      const el = root.querySelector(s);
      const v = el && el.getAttribute(a);
      if (v) return v;
    }
    return null;
  };
  // "$60,000 - $80,000 a year" / "PKR 80k/month" -> structured
  const parseSalary = (raw) => {
    if (!raw) return { salary: null, salaryCurrency: null, salaryMin: null, salaryMax: null, salaryPeriod: null };
    const s = String(raw).replace(/\s+/g, " ").trim();
    const cur = /pkr|rs\.?\b/i.test(s) ? "PKR"
      : /£|\bgbp\b/i.test(s) ? "GBP"
      : /€|\beur\b/i.test(s) ? "EUR"
      : /₹|\binr\b/i.test(s) ? "INR"
      : /\$|\busd\b/i.test(s) ? "USD" : null;
    const period = /hour|hourly|\/hr|per hour/i.test(s) ? "hour"
      : /week/i.test(s) ? "week"
      : /month|\/mo\b|monthly/i.test(s) ? "month"
      : /year|annum|annual|\/yr|\bpa\b/i.test(s) ? "year" : null;
    const nums = [];
    const re = /(\d[\d,.]*)\s*(k\b)?/gi;
    let m;
    while ((m = re.exec(s))) {
      let n = parseFloat(m[1].replace(/,/g, ""));
      if (!isFinite(n)) continue;
      if (m[2]) n *= 1000;           // "80k"
      if (n >= 100) nums.push(n);    // "a year" ke 'a' jaise shor se bacho
    }
    return {
      salary: s,
      salaryCurrency: cur,
      salaryMin: nums.length ? Math.min(...nums) : null,
      salaryMax: nums.length > 1 ? Math.max(...nums) : null,
      salaryPeriod: period,
    };
  };
  // LinkedIn aksar title 2 baar deta hai (visually-hidden copy): "FooFoo" -> "Foo"
  const undouble = (s) => {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    const h = t.length / 2;
    if (t.length % 2 === 0 && t.length > 4 && t.slice(0, h) === t.slice(h)) return t.slice(0, h).trim();
    return t;
  };

  const host = location.hostname;
  const out = [];
  const seen = new Set();
  const push = (j) => {
    if (!j || !j.title || !j.url || seen.has(j.url)) return;
    seen.add(j.url);
    out.push(j);
  };

  /* ------------------------------- INDEED -------------------------------- */
  if (host.includes("indeed")) {
    // ROBUST: Indeed apni CSS classes badalta rehta hai — job ko uske "jk"
    // (job key) se pakdo, wo kabhi nahi badalta.
    const anchors = document.querySelectorAll(
      'a[data-jk], a[id^="job_"], a.jcs-JobTitle, a[href*="jk="], h2.jobTitle a'
    );
    for (const a of anchors) {
      const jk =
        a.getAttribute("data-jk") ||
        ((a.id || "").match(/^job_([a-z0-9]+)/i) || [])[1] ||
        ((a.href || "").match(/[?&]jk=([a-z0-9]+)/i) || [])[1] ||
        null;
      const url = jk ? `${location.origin}/viewjob?jk=${jk}` : abs(a.href);
      if (!url) continue;
      const card =
        a.closest('.job_seen_beacon, td.resultContent, .cardOutline, [data-testid="slider_item"], li, .result') ||
        a.parentElement;
      if (!card) continue;
      let title =
        (a.getAttribute("aria-label") || "").replace(/^full details of\s*/i, "").trim() ||
        txt(card, ['h2.jobTitle span[title]', 'h2.jobTitle a', '.jobTitle span', '.jobTitle']) ||
        (a.textContent || "").trim();
      title = title.replace(/\s+/g, " ").replace(/\s*-\s*job post$/i, "").trim();
      const cardText = (card.textContent || "").replace(/\s+/g, " ");
      const salaryRaw = txt(card, [
        '[data-testid="attribute_snippet_testid"]', '.salary-snippet-container',
        '.estimated-salary', '.metadata.salary-snippet-container',
      ]) || (cardText.match(/(?:\$|PKR|Rs\.?|₹|£|€)\s?[\d,][\d,.\sk]*(?:-|–|to)?\s?(?:\$|PKR|Rs\.?|₹|£|€)?[\d,.\sk]*\s*(?:an?\s+)?(?:hour|month|year|week|annum)?/i) || [])[0] || null;

      push(Object.assign(
        {
          title,
          company: txt(card, ['[data-testid="company-name"]', '.companyName', '[data-company-name]']),
          companyLogo: attr(card, ['img[data-testid="companyAvatar"]', '.companyAvatar img', 'img[alt*="logo" i]'], "src"),
          location: txt(card, ['[data-testid="text-location"]', '.companyLocation', '[data-testid="job-location"]']),
          url,
          jobId: jk,
          easyApply: /easily apply|apply with indeed/i.test(cardText) || null,
          employmentType: (cardText.match(/\b(full[-\s]?time|part[-\s]?time|contract|temporary|internship|freelance)\b/i) || [])[0] || null,
          datePosted: (cardText.match(/\b(\d+\+?\s*(?:day|hour|minute|week|month)s?\s+ago|today|just posted|active \d+ days ago)\b/i) || [])[0] || null,
        },
        parseSalary(salaryRaw)
      ));
    }
    return out.slice(0, 100);
  }

  /* ------------------------------ LINKEDIN ------------------------------- */
  if (host.includes("linkedin")) {
    const jobAnchors = document.querySelectorAll('a[href*="/jobs/view/"], a[href*="currentJobId="]');
    for (const a of jobAnchors) {
      const id = (a.href.match(/\/jobs\/view\/(\d+)/) || a.href.match(/currentJobId=(\d+)/) || [])[1] || null;
      const url = id ? `https://www.linkedin.com/jobs/view/${id}` : abs(a.href);
      if (!url) continue;
      const card =
        a.closest('li, [data-job-id], div.job-card-container, .job-card-job-posting-card-wrapper, .jobs-search-results__list-item') ||
        a.parentElement;
      if (!card) continue;
      let title = (a.getAttribute("aria-label") || "").trim();
      if (!title) {
        title = txt(card, ['.job-card-list__title--link', '.job-card-list__title', '.artdeco-entity-lockup__title', 'strong']) ||
          (a.textContent || "").trim();
      }
      title = undouble(title);
      const cardText = (card.textContent || "").replace(/\s+/g, " ");
      const salaryRaw = (cardText.match(/(?:\$|PKR|Rs\.?|₹|£|€)\s?[\d,][\d,.\sk]*(?:\s*(?:-|–|to)\s*(?:\$|PKR|₹|£|€)?[\d,.\sk]+)?(?:\/yr|\/hr|\/mo|\s*(?:a|per)\s*(?:year|hour|month))?/i) || [])[0] || null;

      push(Object.assign(
        {
          title,
          company: undouble(txt(card, [
            '.artdeco-entity-lockup__subtitle', '.job-card-container__primary-description',
            '.job-card-container__company-name', '.job-card-job-posting-card-wrapper__subtitle',
            '.artdeco-entity-lockup__subtitle--multiline',
          ])),
          companyLogo: attr(card, ['img.ivm-view-attr__img--centered', '.artdeco-entity-lockup__image img', 'img'], "src"),
          location: undouble(txt(card, [
            '.artdeco-entity-lockup__caption', '.job-card-container__metadata-item',
            '.job-card-container__metadata-wrapper', '.job-card-job-posting-card-wrapper__footer-item',
          ])),
          url,
          jobId: id,
          easyApply: /easy apply/i.test(cardText) || null,
          workMode: (cardText.match(/\b(remote|hybrid|on-?site)\b/i) || [])[0] || null,
          datePosted: (cardText.match(/\b\d+\s*(?:day|hour|minute|week|month)s?\s+ago\b|\btoday\b/i) || [])[0] || null,
        },
        parseSalary(salaryRaw)
      ));
    }
    return out.slice(0, 100);
  }

  /* ------------------------------- ROZEE --------------------------------- */
  if (host.includes("rozee")) {
    for (const card of document.querySelectorAll('.job, .jobaa, [class*="jobt"]')) {
      const a = card.querySelector('h3 a, a[href*="/job/"]');
      if (!a) continue;
      const cardText = (card.textContent || "").replace(/\s+/g, " ");
      push(Object.assign(
        {
          title: txt(card, ['h3 a', '.s-18 a', 'a[href*="/job/"]']),
          company: txt(card, ['.cmpnit', '.company', 'a[href*="/company"]']),
          location: txt(card, ['.loc', '.location']),
          url: abs(a.href),
          companyLogo: attr(card, ['img'], "src"),
        },
        parseSalary((cardText.match(/(?:PKR|Rs\.?)\s?[\d,][\d,.\sk-]*/i) || [])[0])
      ));
    }
    return out.slice(0, 100);
  }

  /* ------------------------------ GENERIC -------------------------------- */
  // koi bhi ATS / career page — job-ish anchors uthao
  for (const a of document.querySelectorAll("a[href]")) {
    const h = (a.href || "").toLowerCase();
    const t = (a.textContent || "").replace(/\s+/g, " ").trim();
    const jobish = /job|career|vacanc|position|viewjob|gh_jid|lever\.co|greenhouse|ashby|workable|smartrecruiters/.test(h);
    if (!jobish || t.length < 8 || t.length > 90) continue;
    const card = a.closest("li, tr, article, .job, [class*='job'], [class*='posting'], div") || a.parentElement;
    push({
      title: t,
      company: txt(card, ['[class*="company"]', '[class*="org"]']),
      location: txt(card, ['[class*="location"]', '[class*="office"]', '[class*="city"]']),
      url: abs(a.href),
    });
  }
  return out.slice(0, 80);
}

/* ========================================================================== *
 *  extractDetail — EK job ki detail page (poora record: 30+ fields)
 * ========================================================================== */
export function extractDetail() {
  const clean = (s) => (s == null ? null : String(s).replace(/\s+/g, " ").trim() || null);
  const text = (sels) => {
    for (const s of sels) {
      const el = document.querySelector(s);
      const t = el && (el.textContent || "").trim();
      if (t) return t.replace(/\s+/g, " ");
    }
    return null;
  };
  const attr = (sels, a) => {
    for (const s of sels) {
      const el = document.querySelector(s);
      const v = el && el.getAttribute(a);
      if (v) return v;
    }
    return null;
  };
  // description ko readable rakho: <li> -> "• ", <br>/<p> -> newline
  const richText = (sels) => {
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) continue;
      const c = el.cloneNode(true);
      for (const bad of c.querySelectorAll("script, style, noscript")) bad.remove();
      for (const li of c.querySelectorAll("li")) li.insertAdjacentText("afterbegin", "• ");
      for (const br of c.querySelectorAll("br, p, li, div, h1, h2, h3, h4")) br.insertAdjacentText("beforeend", "\n");
      const t = (c.textContent || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      if (t.length > 40) return t;
    }
    return null;
  };

  const parseSalary = (raw) => {
    if (!raw) return { salary: null, salaryCurrency: null, salaryMin: null, salaryMax: null, salaryPeriod: null };
    const s = String(raw).replace(/\s+/g, " ").trim();
    const cur = /pkr|rs\.?\b/i.test(s) ? "PKR"
      : /£|\bgbp\b/i.test(s) ? "GBP"
      : /€|\beur\b/i.test(s) ? "EUR"
      : /₹|\binr\b/i.test(s) ? "INR"
      : /\$|\busd\b/i.test(s) ? "USD" : null;
    const period = /hour|hourly|\/hr|per hour/i.test(s) ? "hour"
      : /week/i.test(s) ? "week"
      : /month|\/mo\b|monthly/i.test(s) ? "month"
      : /year|annum|annual|\/yr/i.test(s) ? "year" : null;
    const nums = [];
    const re = /(\d[\d,.]*)\s*(k\b)?/gi;
    let m;
    while ((m = re.exec(s))) {
      let n = parseFloat(m[1].replace(/,/g, ""));
      if (!isFinite(n)) continue;
      if (m[2]) n *= 1000;
      if (n >= 100) nums.push(n);
    }
    return {
      salary: s,
      salaryCurrency: cur,
      salaryMin: nums.length ? Math.min(...nums) : null,
      salaryMax: nums.length > 1 ? Math.max(...nums) : null,
      salaryPeriod: period,
    };
  };

  /* description ke andar se sections nikaalo (Responsibilities / Requirements /
     Preferred). Heading ke baad ke bullets ya lines uthate hain. */
  const section = (body, names) => {
    if (!body) return [];
    const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
    const headRe = new RegExp(`^[•\\-*\\s]*(${names.join("|")})\\b.{0,40}:?\\s*$`, "i");
    const anyHeadRe = /^[•\-*\s]*(responsibilit|what you.?ll do|duties|requirement|qualification|what we.?re looking for|must have|preferred|nice to have|bonus|benefit|perks|about (us|the company)|skills|experience)\b.{0,40}:?\s*$/i;
    const out = [];
    let on = false;
    for (const l of lines) {
      if (headRe.test(l)) { on = true; continue; }
      if (on && anyHeadRe.test(l)) break;          // agla section shuru
      if (on) {
        const item = l.replace(/^[•\-*•●\s]+/, "").trim();
        if (item.length > 8 && item.length < 400) out.push(item);
        if (out.length >= 20) break;
      }
    }
    return out;
  };

  const bodyText = (document.body && document.body.textContent) || "";
  const host = location.hostname;
  const j = {
    url: location.href.split("#")[0],
    title: null, company: null, description: null,
  };

  /* ------------------------------- INDEED -------------------------------- */
  if (host.includes("indeed")) {
    j.jobId = (location.href.match(/[?&]jk=([a-z0-9]+)/i) || [])[1] || null;
    j.title = clean(text([
      'h1.jobsearch-JobInfoHeader-title', '[data-testid="jobsearch-JobInfoHeader-title"]',
      'h2[data-testid="simpler-jobTitle"]', 'h1',
    ]));
    j.company = clean(text([
      '[data-testid="inlineHeader-companyName"] a', '[data-testid="inlineHeader-companyName"]',
      '.jobsearch-InlineCompanyRating a', '[data-company-name]',
    ]));
    j.companyWebsite = attr(['[data-testid="inlineHeader-companyName"] a', '.jobsearch-InlineCompanyRating a'], "href");
    j.companyLogo = attr(['img[data-testid="jobsearch-CompanyAvatar-image"]', '.jobsearch-CompanyAvatar img', 'img[alt*="logo" i]'], "src");
    j.location = clean(text([
      '[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]',
      '[data-testid="jobsearch-JobInfoHeader-companyLocation"]',
    ]));
    j.description = richText(['#jobDescriptionText', '.jobsearch-JobComponent-description', '[id*="jobDescription"]']);
    j.easyApply = !!document.querySelector('[id*="indeedApplyButton"], .ia-IndeedApplyButton, button[aria-label*="Apply with Indeed" i]');
    j.companyDescription = richText(['[data-testid="companyDescription"]', '.js-match-insights-provider-1u6ml6r']);

    const meta = (document.querySelector('#salaryInfoAndJobType, [data-testid="jobsearch-JobInfoHeader-salaryInfo"], .jobsearch-JobMetadataHeader-item') || {}).textContent || "";
    const chips = [...document.querySelectorAll('[data-testid*="attribute_snippet"], .js-match-insights-provider-tvvxwd, #salaryInfoAndJobType span')]
      .map((e) => (e.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    const chipBlob = `${meta} ${chips.join(" | ")}`;

    Object.assign(j, parseSalary(
      (chipBlob.match(/(?:\$|PKR|Rs\.?|₹|£|€)\s?[\d,][\d,.\sk]*(?:\s*(?:-|–|to)\s*(?:\$|PKR|Rs\.?|₹|£|€)?[\d,.\sk]+)?[^|]*/i) || [])[0]
    ));
    j.employmentType = (chipBlob.match(/\b(full[-\s]?time|part[-\s]?time|contract|temporary|internship|permanent|freelance)\b/i) || [])[0] || null;
    j.benefits = chips.filter((c) => /insurance|health|pto|paid time|401|pension|bonus|remote|flexible|leave|medical|fuel|meal|gym|stock|equity/i.test(c)).slice(0, 15);
  }

  /* ------------------------------ LINKEDIN ------------------------------- */
  else if (host.includes("linkedin")) {
    j.jobId = (location.href.match(/\/jobs\/view\/(\d+)/) || location.href.match(/currentJobId=(\d+)/) || [])[1] || null;
    if (j.jobId) j.url = `https://www.linkedin.com/jobs/view/${j.jobId}`;
    j.title = clean(text([
      '.job-details-jobs-unified-top-card__job-title h1', '.job-details-jobs-unified-top-card__job-title',
      '.jobs-unified-top-card__job-title', '.topcard__title', 'h1',
    ]));
    j.company = clean(text([
      '.job-details-jobs-unified-top-card__company-name a', '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name', '.topcard__org-name-link',
    ]));
    j.companyLinkedin = attr([
      '.job-details-jobs-unified-top-card__company-name a', '.topcard__org-name-link',
      'a[href*="/company/"]',
    ], "href");
    j.companyLogo = attr(['.jobs-unified-top-card__company-logo', '.artdeco-entity-lockup__image img', '.ivm-view-attr__img--centered', 'img[alt*="logo" i]'], "src");
    j.description = richText([
      '.jobs-description__content', '.jobs-box__html-content',
      '#job-details', '.description__text', '.show-more-less-html__markup',
    ]);
    j.companyDescription = richText(['.jobs-company__box', '.jobs-company__company-description']);

    // top-card ka meta strip: "Karachi, Pakistan · 2 weeks ago · 47 applicants"
    const strip = clean(text([
      '.job-details-jobs-unified-top-card__primary-description-container',
      '.job-details-jobs-unified-top-card__tertiary-description-container',
      '.jobs-unified-top-card__primary-description', '.topcard__flavor-row',
    ])) || "";
    const parts = strip.split(/\s*·\s*/).map((s) => s.trim()).filter(Boolean);
    j.location = parts[0] || null;
    j.datePosted = (strip.match(/\b\d+\s*(?:day|hour|minute|week|month)s?\s+ago\b/i) || [])[0] || null;
    const ap = strip.match(/([\d,]+)\+?\s*(?:applicant|people clicked)/i);
    j.applicantCount = ap ? parseInt(ap[1].replace(/,/g, ""), 10) : null;

    // "pills" — workMode / employmentType / seniority yahin hote hain
    const pills = [...document.querySelectorAll(
      '.job-details-jobs-unified-top-card__job-insight, .job-details-preferences-and-skills__pill, .jobs-unified-top-card__job-insight, .description__job-criteria-item'
    )].map((e) => (e.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    const pillBlob = pills.join(" | ");
    j.workMode = (pillBlob.match(/\b(remote|hybrid|on-?site)\b/i) || [])[0] || null;
    j.employmentType = (pillBlob.match(/\b(full[-\s]?time|part[-\s]?time|contract|temporary|internship|volunteer)\b/i) || [])[0] || null;
    j.experienceRequired = (pillBlob.match(/\b(entry level|associate|mid[-\s]senior|director|executive|internship)\b/i) || [])[0] || null;
    Object.assign(j, parseSalary((pillBlob.match(/(?:\$|PKR|₹|£|€)\s?[\d,][\d,.\sk]*(?:\s*(?:-|–|to)\s*(?:\$|PKR|₹|£|€)?[\d,.\sk]+)?[^|]*/i) || [])[0]));
    j.easyApply = !!document.querySelector('.jobs-apply-button, button[aria-label*="Easy Apply" i]');

    // hiring team / recruiter
    const rec = document.querySelector('.hirer-card__hirer-information a, .jobs-poster__name, .job-details-people-who-can-refer-card__name');
    if (rec) {
      j.recruiterName = clean(rec.textContent);
      j.recruiterProfile = rec.getAttribute("href") ? new URL(rec.getAttribute("href"), location.origin).href.split("?")[0] : null;
    }
    const skillEls = [...document.querySelectorAll('.job-details-how-you-match__skills-item-subtitle, .job-details-skill-match-status-list li')];
    if (skillEls.length) {
      j.skills = skillEls.flatMap((e) => (e.textContent || "").split(/,| and /)).map((s) => s.trim()).filter((s) => s && s.length < 40).slice(0, 25);
    }
  }

  /* --------------------------- GENERIC / ATS ----------------------------- */
  else {
    j.title = clean(text(['h1', '[class*="posting-headline"] h2', '[class*="job-title"]', '[data-ui="job-title"]']));
    j.company = clean(
      text(['[class*="company-name"]', '[class*="posting-company"]', '[data-ui="company-name"]']) ||
      attr(['meta[property="og:site_name"]'], "content")
    );
    j.location = clean(text([
      '[class*="location"]', '[data-ui="job-location"]', '.posting-categories .location',
      '[class*="posting-category"]',
    ]));
    j.description = richText([
      '[class*="job-description"]', '[data-ui="job-description"]', '#content',
      '.posting-page', 'main', 'article',
    ]);
    j.companyLogo = attr(['img[class*="logo"]', 'meta[property="og:image"]'], "src") ||
      attr(['meta[property="og:image"]'], "content");
    j.easyApply = null;
  }

  /* ----------------- JSON-LD (sabse reliable, agar mile) ------------------ */
  // Bohat se ATS/career pages schema.org JobPosting embed karte hain — ye
  // DOM-scraping se kahin behtar hai, isliye ye JEETTA hai (overwrite karta hai).
  try {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try { data = JSON.parse(s.textContent); } catch { continue; }
      const arr = Array.isArray(data) ? data : (data["@graph"] ? data["@graph"] : [data]);
      const p = arr.find((d) => d && (d["@type"] === "JobPosting" || (Array.isArray(d["@type"]) && d["@type"].includes("JobPosting"))));
      if (!p) continue;

      j.title = clean(p.title) || j.title;
      if (p.hiringOrganization) {
        j.company = clean(p.hiringOrganization.name) || j.company;
        j.companyWebsite = p.hiringOrganization.sameAs || p.hiringOrganization.url || j.companyWebsite;
        if (p.hiringOrganization.logo) {
          j.companyLogo = (typeof p.hiringOrganization.logo === "string" ? p.hiringOrganization.logo : p.hiringOrganization.logo.url) || j.companyLogo;
        }
        j.companyDescription = clean(p.hiringOrganization.description) || j.companyDescription;
      }
      if (p.description) {
        const d = document.createElement("div");
        d.innerHTML = p.description;                     // JSON-LD me HTML hota hai
        for (const li of d.querySelectorAll("li")) li.insertAdjacentText("afterbegin", "• ");
        for (const b of d.querySelectorAll("br, p, li, div")) b.insertAdjacentText("beforeend", "\n");
        const t = (d.textContent || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
        if (t.length > (j.description || "").length) j.description = t;
      }
      j.datePosted = p.datePosted || j.datePosted;
      j.employmentType = (Array.isArray(p.employmentType) ? p.employmentType[0] : p.employmentType) || j.employmentType;
      j.jobId = clean(p.identifier && (p.identifier.value || p.identifier)) || j.jobId;

      const loc = Array.isArray(p.jobLocation) ? p.jobLocation[0] : p.jobLocation;
      if (loc && loc.address) {
        const a = loc.address;
        j.city = clean(a.addressLocality) || j.city;
        j.country = clean(a.addressCountry && (a.addressCountry.name || a.addressCountry)) || j.country;
        j.location = clean([a.addressLocality, a.addressRegion, (a.addressCountry && (a.addressCountry.name || a.addressCountry))].filter(Boolean).join(", ")) || j.location;
      }
      if (p.jobLocationType === "TELECOMMUTE") j.workMode = "remote";

      const bs = p.baseSalary && p.baseSalary.value;
      if (bs) {
        j.salaryCurrency = p.baseSalary.currency || j.salaryCurrency;
        j.salaryMin = Number(bs.minValue ?? bs.value) || j.salaryMin;
        j.salaryMax = Number(bs.maxValue ?? bs.value) || j.salaryMax;
        j.salaryPeriod = ({ HOUR: "hour", DAY: "day", WEEK: "week", MONTH: "month", YEAR: "year" })[bs.unitText] || j.salaryPeriod;
        j.salary = j.salary || [j.salaryCurrency, j.salaryMin, j.salaryMax && `- ${j.salaryMax}`, j.salaryPeriod && `per ${j.salaryPeriod}`].filter(Boolean).join(" ");
      }
      if (p.experienceRequirements) {
        const er = p.experienceRequirements;
        j.experienceRequired = clean(typeof er === "string" ? er : (er.monthsOfExperience ? `${Math.round(er.monthsOfExperience / 12)}+ years` : er.description)) || j.experienceRequired;
      }
      if (p.skills) j.skills = (typeof p.skills === "string" ? p.skills.split(/,|;/) : p.skills).map((x) => String(x).trim()).filter(Boolean).slice(0, 25);
      if (p.jobBenefits) j.benefits = (typeof p.jobBenefits === "string" ? p.jobBenefits.split(/,|;|\n/) : p.jobBenefits).map((x) => String(x).trim()).filter(Boolean).slice(0, 15);
      break;
    }
  } catch { /* JSON-LD kharab hai — DOM wala data hi rakho */ }

  /* --------------------- description se sections nikaalo ------------------ */
  const d = j.description;
  j.responsibilities = section(d, ["responsibilities", "what you.?ll do", "duties", "the role", "your role", "key responsibilities"]);
  j.requirements = section(d, ["requirements", "qualifications", "what we.?re looking for", "must have", "you have", "required skills", "minimum qualifications"]);
  j.preferredQualifications = section(d, ["preferred", "nice to have", "bonus", "plus(es)?", "good to have", "preferred qualifications"]);
  if (!j.benefits || !j.benefits.length) j.benefits = section(d, ["benefits", "perks", "what we offer", "we offer"]);

  // experience: "3+ years", "2-4 years"
  if (!j.experienceRequired && d) {
    const m = d.match(/(\d+\s*[-–+]?\s*\d*)\s*\+?\s*years?(?:\s+of)?\s+(?:relevant\s+)?experience/i);
    if (m) j.experienceRequired = clean(m[0]);
  }
  // applicant count (Indeed/generic)
  if (j.applicantCount == null) {
    const m = bodyText.match(/([\d,]+)\+?\s*(?:applicants|people have applied)/i);
    j.applicantCount = m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
  }
  // salary description me chhupi ho
  if (!j.salary && d) {
    const m = d.match(/(?:salary|compensation|pay)[^\n]{0,80}/i);
    if (m && /[\d]/.test(m[0])) Object.assign(j, parseSalary(m[0]));
  }

  return j;
}
