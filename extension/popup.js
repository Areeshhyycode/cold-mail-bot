/* Job Apply Assistant — popup logic */

const $ = (id) => document.getElementById(id);
let JOBS = [];
let PROFILE = {};

/* ---------- injected page extractor (runs in the job site's page) ---------- */
function extractJobsFromPage() {
  const abs = (h) => {
    if (!h) return "";
    try { return new URL(h, location.href).href.split("#")[0]; } catch { return h; }
  };
  const txt = (root, sels) => {
    for (const s of sels) {
      const el = root.querySelector(s);
      const t = el && (el.getAttribute("title") || el.textContent || "").trim();
      if (t) return t.replace(/\s+/g, " ");
    }
    return "";
  };
  const host = location.hostname;
  let cardSel, F;

  if (host.includes("indeed")) {
    cardSel = 'div.job_seen_beacon, [data-testid="slider_item"], .cardOutline';
    F = (c) => ({
      title: txt(c, ['h2.jobTitle span[title]', 'h2.jobTitle a', '.jobTitle']),
      company: txt(c, ['[data-testid="company-name"]', '.companyName']),
      location: txt(c, ['[data-testid="text-location"]', '.companyLocation']),
      link: abs((c.querySelector('a.jcs-JobTitle, h2.jobTitle a, a[id^="job_"]') || {}).href),
    });
  } else if (host.includes("linkedin")) {
    cardSel = '.job-card-container, .jobs-search-results__list-item, [data-job-id], li.scaffold-layout__list-item';
    F = (c) => ({
      title: txt(c, ['.job-card-list__title', '.artdeco-entity-lockup__title', 'a.job-card-container__link span', 'a.job-card-container__link']),
      company: txt(c, ['.job-card-container__primary-description', '.artdeco-entity-lockup__subtitle', '.job-card-container__company-name']),
      location: txt(c, ['.job-card-container__metadata-item', '.artdeco-entity-lockup__caption']),
      link: abs((c.querySelector('a.job-card-container__link, a.job-card-list__title, a[href*="/jobs/view/"]') || {}).href),
    });
  } else if (host.includes("rozee")) {
    cardSel = '.job, .jobaa, [class*="jobt"]';
    F = (c) => ({
      title: txt(c, ['h3 a', '.s-18 a', 'a[href*="/job/"]']),
      company: txt(c, ['.cmpnit', '.company', 'a[href*="/company"]']),
      location: txt(c, ['.loc', '.location']),
      link: abs((c.querySelector('h3 a, a[href*="/job/"]') || {}).href),
    });
  } else {
    // generic: koi bhi anchor jo job/career page ki taraf ja raha ho
    const anchors = [...document.querySelectorAll('a[href]')].filter((a) => {
      const h = (a.href || "").toLowerCase();
      const t = (a.textContent || "").trim();
      return /job|career|vacanc|position|viewjob|gh_jid|lever\.co|greenhouse/.test(h) && t.length > 8 && t.length < 90;
    });
    const seen = new Set();
    return anchors.map((a) => {
      const link = abs(a.href);
      if (seen.has(link)) return null;
      seen.add(link);
      return { title: a.textContent.trim().replace(/\s+/g, " "), company: "", location: "", link };
    }).filter(Boolean).slice(0, 60);
  }

  const cards = [...document.querySelectorAll(cardSel)];
  return cards.map(F).filter((j) => j.title && j.link).slice(0, 80);
}

/* ----------------------------- storage helpers ---------------------------- */
function save() { chrome.storage.local.set({ jobs: JOBS, profile: PROFILE }); }
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.style.display = "block";
  setTimeout(() => (t.style.display = "none"), 1600);
}

/* -------------------------------- rendering ------------------------------- */
function render() {
  $("count").textContent = `${JOBS.length} jobs collected`;
  $("list").innerHTML = JOBS.length
    ? JOBS.map((j, i) => `
      <div class="job">
        <div class="t">${esc(j.title)}</div>
        <div class="c">${esc(j.company || "—")}</div>
        <div class="m">${esc(j.location || "")}</div>
        <a href="${esc(j.link)}" target="_blank">open job ↗</a>
        <div class="acts">
          <button data-cl="${i}" class="ghost">✍️ cover letter</button>
          <button data-del="${i}" class="ghost">✕</button>
        </div>
      </div>`).join("")
    : '<div class="empty">Koi job nahi. Kisi job-search page pe jao aur "Scan this page" dabao.</div>';

  document.querySelectorAll("[data-del]").forEach((b) =>
    b.onclick = () => { JOBS.splice(+b.dataset.del, 1); save(); render(); });
  document.querySelectorAll("[data-cl]").forEach((b) =>
    b.onclick = () => showCoverLetter(JOBS[+b.dataset.cl]));
}

function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

/* ---------------------------- cover letter ------------------------------- */
function showCoverLetter(job) {
  const p = PROFILE;
  const company = job.company || "your company";
  const role = job.title || "the role";
  const cl =
`Hi ${company} team,

I'm ${p.name || "[your name]"}, a ${p.pitch || "Full Stack Developer"}. I'm excited to apply for ${role}.

I build production-ready web apps end to end (React, Next.js, Node.js, MongoDB) and would love to bring that to your team. You can see my work here: ${p.portfolio || ""}

I've attached my CV — I'd welcome the chance to discuss how I can contribute.

Best regards,
${p.name || ""}
${p.email || ""}${p.phone ? " · " + p.phone : ""}`;
  $("clBox").style.display = "block";
  $("clBox").open = true;
  $("cl").value = cl;
  $("clBox").scrollIntoView({ behavior: "smooth" });
}

/* -------------------------------- actions -------------------------------- */
$("scan").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractJobsFromPage });
    const found = (res && res.result) || [];
    const links = new Set(JOBS.map((j) => j.link));
    let added = 0;
    for (const j of found) { if (!links.has(j.link)) { JOBS.push(j); links.add(j.link); added++; } }
    save(); render();
    toast(added ? `✅ ${added} naye jobs add hue` : "Koi naya job nahi mila (ya is page pe support nahi)");
  } catch (e) {
    toast("Scan fail: " + e.message);
  }
};

$("export").onclick = () => {
  if (!JOBS.length) return toast("Pehle kuch jobs scan karo");
  const head = ["Title", "Company", "Location", "Link"];
  const rows = JOBS.map((j) => [j.title, j.company, j.location, j.link]
    .map((v) => `"${String(v || "").replace(/"/g, '""')}"`).join(","));
  const csv = [head.join(","), ...rows].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = "jobs.csv"; a.click();
  URL.revokeObjectURL(url);
  toast("⬇ jobs.csv download ho gayi");
};

$("clear").onclick = () => { JOBS = []; save(); render(); toast("List clear"); };

$("saveProfile").onclick = () => {
  PROFILE = {
    name: $("p_name").value.trim(), email: $("p_email").value.trim(),
    phone: $("p_phone").value.trim(), portfolio: $("p_portfolio").value.trim(),
    pitch: $("p_pitch").value.trim(),
  };
  save(); toast("💾 Profile saved");
};

$("copyCl").onclick = () => { navigator.clipboard.writeText($("cl").value); toast("📋 Copied"); };

/* --------------------------------- init ---------------------------------- */
chrome.storage.local.get(["jobs", "profile"], (d) => {
  JOBS = d.jobs || [];
  PROFILE = d.profile || {};
  $("p_name").value = PROFILE.name || "";
  $("p_email").value = PROFILE.email || "";
  $("p_phone").value = PROFILE.phone || "";
  $("p_portfolio").value = PROFILE.portfolio || "";
  $("p_pitch").value = PROFILE.pitch || "";
  render();
});
