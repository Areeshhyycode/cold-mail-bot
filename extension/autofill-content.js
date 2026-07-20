/* AI Job Assistant — autofill + auto-advance + free job enrichment.
 *
 * DO KAAM:
 *  1. APPLY FLOW — Indeed smartapply/LinkedIn Easy Apply pe fields bharo,
 *     "Continue" dabao. "Submit" KABHI auto-click nahi (wo tum dabati ho).
 *  2. FREE ENRICHMENT — agar tum khud kisi job DETAIL page pe ho, to poora
 *     record (30+ fields) wahin se nikal ke background ko de do. Ye MUFT hai —
 *     koi extra tab nahi khulta, koi rate-limit risk nahi. Jo job tum khud
 *     kholti ho wo turant enrich ho jati hai.
 *
 * PERF FIX (v1 me sabse bada masla tha):
 *  v1 har 1.2s pe HAR Indeed/LinkedIn page ke HAR FRAME me 4-6 poore-document
 *  querySelectorAll sweeps karta tha — LinkedIn feed pe ~20 iframes = ~100
 *  DOM sweeps/second, bilkul bekaar. Ab:
 *    - jis frame me koi input/form hi nahi wahan loop chalta hi nahi
 *    - apply flow me na ho to poll 1.2s se 4s ho jata hai
 *    - normQ ab lib/core.js se aata hai (pehle popup me duplicate tha — drift ho
 *      jata to saved answers chup-chaap match hona band kar dete)
 */
(function () {
  if (window.__jaaAutofill) return;
  window.__jaaAutofill = true;

  const IS_TOP = window.top === window;

  let profile = {};
  let autoAdvance = false;
  let answers = {};
  let coverLetter = "";
  let advancedForUrl = "";
  let normQ = (q) => String(q || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
  let extractDetail = null;

  /* shared core + extractor dynamically import karo (web_accessible_resources) */
  (async () => {
    try {
      const core = await import(chrome.runtime.getURL("lib/core.js"));
      normQ = core.normQ;                      // ab EK hi source (popup ke saath match)
      const ex = await import(chrome.runtime.getURL("lib/extractor.js"));
      extractDetail = ex.extractDetail;
      maybeEnrich();
    } catch (e) {
      console.warn("[JAA] lib load fail:", e.message);
    }
  })();

  chrome.storage.local.get(["profile", "autoAdvance", "answers", "applyCoverLetter"], (d) => {
    profile = d.profile || {};
    autoAdvance = !!d.autoAdvance;
    answers = d.answers || {};
    coverLetter = d.applyCoverLetter || "";
  });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    if (ch.profile) profile = ch.profile.newValue || {};
    if (ch.autoAdvance) autoAdvance = !!ch.autoAdvance.newValue;
    if (ch.answers) answers = ch.answers.newValue || {};
    if (ch.applyCoverLetter) coverLetter = ch.applyCoverLetter.newValue || "";
  });

  const send = (cmd, extra) => new Promise((r) =>
    chrome.runtime.sendMessage({ cmd, ...extra }, (res) => { void chrome.runtime.lastError; r(res); }));

  /* ===================== 1. FREE ENRICHMENT (detail page) ================== */
  const isJobDetailPage = () =>
    /\/viewjob\?|[?&]jk=/.test(location.href) ||          // Indeed
    /\/jobs\/view\/\d+/.test(location.href);              // LinkedIn

  let enrichedUrl = "";
  async function maybeEnrich() {
    if (!IS_TOP || !extractDetail || !isJobDetailPage()) return;
    if (enrichedUrl === location.href) return;
    enrichedUrl = location.href;
    try {
      const job = extractDetail();
      if (job && job.title && job.url) {
        await send("pageDetail", { job, source: location.hostname });
      }
    } catch (e) {
      console.warn("[JAA] enrich fail:", e.message);
    }
  }

  /* ========================== 2. APPLY AUTOFILL =========================== */
  const setVal = (el, val) => {
    if (!el || !val || el.value) return;
    el.focus();
    el.value = val;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const sig = (el) =>
    `${el.name || ""} ${el.id || ""} ${el.placeholder || ""} ${el.getAttribute("aria-label") || ""} ${el.autocomplete || ""} ${(el.labels && el.labels[0] && el.labels[0].textContent) || ""}`.toLowerCase();
  const has = (el, keys) => keys.some((k) => sig(el).includes(k));
  const shown = (el) => el.offsetParent !== null && !el.disabled && !el.readOnly;
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

  const isIndeedApply = () => /smartapply\.indeed\.com/.test(location.host) || /indeedapply|\/apply/i.test(location.pathname);
  const isLinkedInApply = () =>
    /linkedin\.com/.test(location.host) &&
    !!document.querySelector(".jobs-easy-apply-modal, .jobs-easy-apply-content, [data-test-modal-id*='easy-apply']");
  const isApply = () => isIndeedApply() || isLinkedInApply();

  function fillBasic() {
    const p = profile;
    if (!p || (!p.email && !p.phone && !p.name)) return;
    const first = (p.name || "").split(" ")[0];
    const last = (p.name || "").split(" ").slice(1).join(" ");
    for (const el of document.querySelectorAll("input, textarea")) {
      if (["hidden", "password", "file", "submit", "button", "checkbox", "radio"].includes(el.type)) continue;
      if (has(el, ["search", "username", "where", "keyword"])) continue;
      if (has(el, ["email"])) setVal(el, p.email);
      else if (has(el, ["phone", "mobile", "tel"])) setVal(el, p.phone);
      else if (has(el, ["first name", "firstname", "fname", "given"])) setVal(el, first);
      else if (has(el, ["last name", "lastname", "lname", "surname", "family"])) setVal(el, last);
      else if (has(el, ["full name", "your name"])) setVal(el, p.name);
      else if (has(el, ["name"]) && !has(el, ["company", "user", "file", "title"])) setVal(el, p.name);
    }
  }

  /* Sirf IS field ka apna sawaal nikaalo (sabse chhota wrapper jisme ye akela
     input ho). textContent bade wrapper pe poora subtree serialize karta hai —
     isliye upar sirf 5 levels aur pehla match hi lete hain. */
  function getQuestion(el) {
    let n = el;
    for (let i = 0; i < 5 && n.parentElement; i++) {
      n = n.parentElement;
      if (n.querySelectorAll("input, textarea, select").length > 1) continue;
      const txt = (n.textContent || "").replace(/\s+/g, " ").trim();
      if (txt.length > 6 && txt.length < 280) return txt;
    }
    return (el.parentElement ? el.parentElement.textContent : "").replace(/\s+/g, " ").trim();
  }

  function interviewText() {
    if (profile.interview) return profile.interview;
    let today = "";
    try { today = new Date().toLocaleDateString(); } catch { /* ignore */ }
    return `I'm available for an interview any day, 11:00 AM to 6:00 PM${today ? ` (earliest ${today})` : ""}.`;
  }

  /* saved answer dhoondo — exact key, phir substring (sabse LAMBA match jeetega) */
  function lookupSaved(q) {
    const k = normQ(q);
    if (!k) return "";
    if (answers[k]) return answers[k];
    let best = "";
    for (const key of Object.keys(answers)) {
      if (key.length >= 5 && (k.includes(key) || key.includes(k)) && key.length > best.length) best = key;
    }
    return best ? answers[best] : "";
  }

  /* AI jawab ab SW ke through aata hai (token wahan hai, page me nahi) */
  const aiAsked = new Set();
  function aiFill(el, question, maxLen) {
    const key = question.slice(0, 120).toLowerCase();
    if (aiAsked.has(key)) return;
    aiAsked.add(key);
    send("answerQuestion", { question, maxLen: maxLen || 0 }).then((res) => {
      const a = res && res.ok && res.data && res.data.answer;
      if (a && el.isConnected && !el.value) setVal(el, a);
    });
  }

  function fillApplyExtras() {
    for (const el of document.querySelectorAll("input[type='date']")) {
      if (!el.value && shown(el)) {
        try {
          el.value = new Date().toISOString().slice(0, 10);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } catch { /* ignore */ }
      }
    }
    for (const el of document.querySelectorAll("textarea, input[type='text'], input:not([type])")) {
      if (el.value || !shown(el)) continue;
      const q = getQuestion(el);
      const ql = q.toLowerCase();
      if (/\bjob title\b|position title/.test(ql) && !/\bcompany\b/.test(sig(el))) { setVal(el, profile.expTitle || profile.pitch || ""); continue; }
      if (/\bcompany\b|employer/.test(ql) && !/cover|describe|why/.test(ql)) { setVal(el, profile.expCompany || ""); continue; }
      if (/interview|availab/.test(ql) || (/\bdate/.test(ql) && /\btime/.test(ql))) { setVal(el, interviewText()); continue; }

      const saved = lookupSaved(q);
      if (saved) { setVal(el, el.maxLength > 0 ? saved.slice(0, el.maxLength) : saved); continue; }

      if (coverLetter && el.tagName === "TEXTAREA" &&
        /cover letter|why (are|do) you|message to|motivat|tell us about|anything else you|why (this|our|the)|interested in (this|the|our)/.test(ql)) {
        setVal(el, el.maxLength > 0 ? coverLetter.slice(0, el.maxLength) : coverLetter);
        continue;
      }
      if (autoAdvance) aiFill(el, q, el.maxLength > 0 ? el.maxLength : 0);
    }
  }

  let lastSavedJSON = "";
  function captureAnswers() {
    let changed = false;
    for (const el of document.querySelectorAll("textarea, input[type='text'], input:not([type]), select")) {
      if (!shown(el)) continue;
      const val = (el.value || "").trim();
      if (val.length < 1 || val.length > 1500) continue;
      const k = normQ(getQuestion(el));
      if (k.length < 4) continue;
      if (answers[k] !== val) { answers[k] = val; changed = true; }
    }
    if (changed) {
      const j = JSON.stringify(answers);
      if (j !== lastSavedJSON) { lastSavedJSON = j; chrome.storage.local.set({ answers }); }
    }
  }

  /* Khali REQUIRED field ho to ruk jao.
     FIX: v1 Indeed pe HAR khali visible text field ko blocking maanta tha —
     optional field wale page pe auto-advance hamesha ke liye atak jata tha.
     Ab sirf wahi fields jo waqai required hain (attribute, *, ya aria). */
  function hasEmptyRequired() {
    for (const el of document.querySelectorAll("input[required], textarea[required], select[required], [aria-required='true']")) {
      if (shown(el) && !el.value) return true;
    }
    if (isIndeedApply()) {
      for (const el of document.querySelectorAll("input[type='text'], input:not([type]), textarea")) {
        if (!shown(el) || el.value) continue;
        const q = getQuestion(el);
        // Indeed required fields pe "*" ya "(optional)" ka na hona — dono check karo
        const optional = /\(optional\)|optional/i.test(q);
        const required = /\*/.test(q) || el.getAttribute("aria-required") === "true";
        if (required && !optional) return true;
      }
    }
    return false;
  }

  function captchaChallenge() {
    return [...document.querySelectorAll('iframe[src*="recaptcha"], iframe[title*="recaptcha" i]')].some((f) => {
      const r = f.getBoundingClientRect();
      return r.width > 120 && r.height > 120 && f.offsetParent !== null;
    });
  }

  /* ------------------------------ status badge ---------------------------- */
  let badge;
  function setBadge(txt, color) {
    if (!IS_TOP) return;                       // har iframe me badge mat banao
    if (!txt) { if (badge) { badge.remove(); badge = null; } return; }
    if (!badge) {
      badge = document.createElement("div");
      badge.style.cssText =
        "position:fixed;top:14px;right:14px;z-index:2147483647;background:#0d1117;color:#fff;border:2px solid #2f81f7;border-radius:10px;padding:10px 14px;font:700 13px -apple-system,Segoe UI,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.6);max-width:280px";
      (document.body || document.documentElement).appendChild(badge);
    }
    badge.textContent = "🧩 " + txt;
    badge.style.borderColor = color || "#2f81f7";
  }

  /* -------------------------------- main loop ----------------------------- */
  const IDLE_MS = 4000;      // apply flow me nahi — dheema poll
  const APPLY_MS = 1200;     // apply flow me — tez poll
  let timer = null;
  let period = 0;

  function schedule(ms) {
    if (period === ms) return;
    period = ms;
    clearInterval(timer);
    timer = setInterval(tick, ms);
  }

  function tick() {
    maybeEnrich();                                   // SPA navigation pe naya job

    const applying = isApply();
    schedule(applying ? APPLY_MS : IDLE_MS);

    if (!applying) { setBadge("Ready ✓ — job pe 'Apply' dabao", "#2f81f7"); return; }

    fillBasic();
    if (isIndeedApply()) { fillApplyExtras(); captureAnswers(); }

    if (!autoAdvance) { setBadge("Auto-advance OFF — popup me ⚡ toggle ON karo", "#f0a955"); return; }
    if (captchaChallenge()) { setBadge("⏸ Captcha — tum solve karo", "#f0a955"); return; }

    const btns = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')].filter(shown);

    // SUBMIT page → bilkul ruk jao (account safe + galat job se bachao)
    if (btns.some((b) => norm(b.textContent || b.value).includes("submit"))) {
      setBadge("✅ Review page — Submit TUM dabao", "#3fb950");
      return;
    }
    if (hasEmptyRequired()) { setBadge("⏸ Koi required field khali — tum bharo", "#f0a955"); return; }

    const cont = btns.find((b) => {
      const t = norm(b.textContent || b.value);
      return t === "continue" || t === "next" || (t.includes("continue") && !t.includes("save"));
    });
    if (cont) {
      if (advancedForUrl === location.href) { setBadge("⚡ Continue dabaya — agla step…"); return; }
      advancedForUrl = location.href;
      setBadge("⚡ Auto-advancing…");
      setTimeout(() => { try { cont.click(); } catch { /* ignore */ } }, 600);
    } else {
      setBadge("⏳ Loading…");
    }
  }

  /* PERF GUARD: jis frame me koi input/form hi nahi (LinkedIn ke ~20 ad/tracking
     iframes) wahan poll loop chalane ka koi matlab nahi. Sirf top frame ya
     wo frame jisme form ho. */
  function shouldRun() {
    if (IS_TOP) return true;
    return !!document.querySelector("input, textarea, form");
  }

  if (shouldRun()) {
    schedule(IDLE_MS);
    setTimeout(tick, 500);

    const captureNow = (e) => {
      const el = e.target;
      if (el && /^(TEXTAREA|INPUT|SELECT)$/.test(el.tagName) && isIndeedApply()) captureAnswers();
    };
    document.addEventListener("focusout", captureNow, true);
    document.addEventListener("change", captureNow, true);
  }
})();
