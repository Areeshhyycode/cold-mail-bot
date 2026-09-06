/* LinkedIn recruiter helper — profile pe note ready + Connect box me note AUTO-FILL.
 *
 * FLOW (safe):
 *   1. Tum recruiter ka profile kholti ho → panel me AI note ready (agar capture
 *      nahi hua to KHUD capture kar ke note bana leta hai).
 *   2. Tum LinkedIn ka "Connect → Add a note" dabao → extension us note-box me
 *      note KHUD bhar deta hai (jaise Indeed forms bharta hai).
 *   3. Tum review karke SEND dabao.
 *
 * COMPLIANCE: extension khud Connect/Send NAHI dabata, profiles auto-open NAHI
 * karta, search results scrape NAHI karta. Sirf (a) jo profile TUM khud kholti ho
 * uska note banata hai, aur (b) jo note-box TUM khud kholti ho use bharta hai.
 * Har connection TUM bhejti ho. Mass-sending mat karna — account safe rakho. */
(function () {
  if (window.__jaaLiNote) return;
  window.__jaaLiNote = true;
  const LOG = (...a) => console.log("[JAA-LI]", ...a);
  LOG("content script loaded on", location.href);

  const PANEL_ID = "jaa-li-note-panel";
  const NOTE_MAX = 200; // LinkedIn free connect-note limit
  let lastUrl = "";
  let currentNote = "";
  let currentId = null;

  const cleanUrl = (u) => u.split("?")[0].replace(/\/$/, "");
  const isProfile = (u) => /linkedin\.com\/in\//.test(u);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clampNote = (s) => {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    if (t.length <= NOTE_MAX) return t;
    const cut = t.slice(0, NOTE_MAX - 1);
    const sp = cut.lastIndexOf(" ");
    return (sp > NOTE_MAX * 0.6 ? cut.slice(0, sp) : cut).trim() + "…";
  };

  const send = (cmd, extra) =>
    new Promise((r) => chrome.runtime.sendMessage({ cmd, ...extra }, (res) => { void chrome.runtime.lastError; r(res); }));

  /* ---- profile DOM se info nikaalo (content script ke apne page pe) ---- */
  function extractProfile() {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const url = cleanUrl(location.href);
    let name = clean(document.querySelector("h1")?.textContent);
    let role = clean(document.querySelector(".text-body-medium.break-words")?.textContent);
    if (!role) {
      const near = [...document.querySelectorAll("h1 ~ div, h1 + div")].map((d) => clean(d.textContent)).find((t) => t && t.length > 3 && t.length < 220);
      role = near || "";
    }
    const ogt = clean(document.querySelector('meta[property="og:title"]')?.content);
    if (!name && ogt) name = clean(ogt.split(/[-|]/)[0]);
    let company = "";
    const m = role.match(/\b(?:at|@)\s+([^|·,]{2,60})/i);
    if (m) company = clean(m[1]);
    return { name, role, company, profileUrl: url };
  }

  /* -------------------------------- panel -------------------------------- */
  function removePanel() { const el = document.getElementById(PANEL_ID); if (el) el.remove(); }

  function showPanel({ id, name, note, status, generating }) {
    removePanel();
    currentId = id || null;
    currentNote = note || "";
    const done = status === "connected" || status === "replied";
    const wrap = document.createElement("div");
    wrap.id = PANEL_ID;
    wrap.style.cssText =
      "position:fixed;bottom:20px;right:20px;z-index:2147483647;width:330px;background:#0d1117;color:#e6edf3;" +
      "border:1px solid #2f81f7;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.5);" +
      "font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:13px;overflow:hidden";
    wrap.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;background:#161b22;padding:9px 12px;border-bottom:1px solid #27303b">' +
        '<b style="color:#3fb950">🔗 ' + (generating ? "Note bana raha…" : "Note ready") + (name ? " · " + esc(name) : "") + "</b>" +
        '<span id="jaa-x" style="cursor:pointer;color:#8b949e;font-size:16px;line-height:1">×</span>' +
      "</div>" +
      '<div style="padding:11px 12px">' +
        '<textarea id="jaa-note" maxlength="' + NOTE_MAX + '" ' + (generating ? "disabled" : "") + ' style="width:100%;min-height:92px;background:#161b22;color:#e6edf3;border:1px solid #27303b;border-radius:8px;padding:8px;font:inherit;font-size:12.5px;line-height:1.5;resize:vertical;box-sizing:border-box">' + esc(note || (generating ? "…" : "")) + "</textarea>" +
        '<div style="text-align:right;color:#8b949e;font-size:10px;margin-top:2px"><span id="jaa-cc">0</span>/' + NOTE_MAX + "</div>" +
        '<div style="display:flex;gap:6px;margin-top:6px">' +
          '<button id="jaa-copy" style="flex:1;background:#2f81f7;color:#fff;border:0;border-radius:7px;padding:8px;font-size:12.5px;cursor:pointer">📋 Copy</button>' +
          '<button id="jaa-regen" style="background:transparent;color:#e6edf3;border:1px solid #27303b;border-radius:7px;padding:8px 10px;font-size:12.5px;cursor:pointer">♻</button>' +
          '<button id="jaa-sent" style="background:' + (done ? "#238636" : "transparent") + ';color:' + (done ? "#fff" : "#e6edf3") + ';border:1px solid #27303b;border-radius:7px;padding:8px 10px;font-size:12.5px;cursor:pointer">' + (done ? "✓ Sent" : "Mark sent") + "</button>" +
        "</div>" +
        '<div style="color:#8b949e;font-size:10.5px;margin-top:7px;line-height:1.4">Connect → <b style="color:#adbac7">Add a note</b> dabao — note KHUD bhar jayega. Review karke <b style="color:#adbac7">Send</b> tum dabao.</div>' +
      "</div>";
    document.body.appendChild(wrap);

    const ta = document.getElementById("jaa-note");
    const cc = document.getElementById("jaa-cc");
    const updateCC = () => { cc.textContent = ta.value.length; currentNote = ta.value; };
    updateCC();
    ta.addEventListener("input", updateCC);
    document.getElementById("jaa-x").onclick = removePanel;
    document.getElementById("jaa-copy").onclick = async () => {
      try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand("copy"); }
      flash("jaa-copy", "✓ Copied");
    };
    document.getElementById("jaa-regen").onclick = async () => {
      if (!currentId) return;
      flash("jaa-regen", "…");
      const r = await send("liRegen", { id: currentId });
      if (r && r.ok && r.data && r.data.note) { ta.value = clampNote(r.data.note); updateCC(); }
    };
    document.getElementById("jaa-sent").onclick = async () => {
      if (currentId) await send("liStatus", { id: currentId, status: "connected" });
      flash("jaa-sent", "✓ Sent");
    };
  }

  function flash(id, text) { const b = document.getElementById(id); if (!b) return; const o = b.textContent; b.textContent = text; setTimeout(() => { if (b) b.textContent = o; }, 1400); }

  function showError(msg) {
    removePanel();
    const wrap = document.createElement("div");
    wrap.id = PANEL_ID;
    wrap.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:2147483647;width:320px;background:#0d1117;color:#e6edf3;border:1px solid #f85149;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.5);font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12.5px;padding:11px 13px";
    wrap.innerHTML = '<b style="color:#f85149">🔗 Note nahi bana</b><div style="margin-top:6px;color:#8b949e;line-height:1.5">' + esc(msg) + "</div>";
    document.body.appendChild(wrap);
    setTimeout(() => { const el = document.getElementById(PANEL_ID); if (el && el.querySelector('b')?.textContent.includes("nahi bana")) el.remove(); }, 6000);
  }

  /* ---- Connect "Add a note" textarea auto-fill (jab TUM modal kholti ho) ---- */
  function fillConnectNote() {
    if (!currentNote) return;
    const ta = document.querySelector('textarea[name="message"], textarea#custom-message');
    if (!ta || ta.dataset.jaaFilled) return;
    if (ta.value && ta.value.trim()) { ta.dataset.jaaFilled = "1"; return; } // user ne khud likha -> chhedo mat
    const note = clampNote(currentNote);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, note);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dataset.jaaFilled = "1";
  }

  /* -------------------------------- driver ------------------------------- */
  async function check() {
    const u = cleanUrl(location.href);
    if (u !== lastUrl) {
      lastUrl = u;
      removePanel();
      currentNote = ""; currentId = null;
      if (!isProfile(u)) { LOG("not a profile page (open a recruiter's profile) →", u); return; }
      LOG("profile page detected, checking note…");
      // pehle dekho note pehle se hai?
      let res = await send("noteForUrl", { url: u });
      LOG("noteForUrl →", res);
      if (res && res.ok && res.data && res.data.found && res.data.note) {
        showPanel(res.data);
      } else if (res && !res.ok) {
        showError("Backend se baat nahi hui: " + (res.error || "?") + ". npm run dashboard chala hai? Token save hai? (⚙️ Backend settings)");
      } else {
        // nahi -> KHUD capture kar ke note bana lo (user is profile pe hai)
        const prof = extractProfile();
        LOG("extracted profile →", prof);
        if (!prof.name) { showError("Profile ka naam nahi mila — page poora load hone do, phir refresh."); return; }
        showPanel({ name: prof.name, generating: true });
        const cap = await send("capturePersonData", { data: prof });
        LOG("capture →", cap);
        if (cap && cap.ok && cap.data) {
          showPanel({ id: cap.data.id, name: cap.data.person?.name || prof.name, note: cap.data.note, status: cap.data.person?.status });
        } else {
          showError("Note nahi bana: " + ((cap && cap.error) || "backend offline / token missing") + ". npm run dashboard + ⚙️ Backend settings me token check karo.");
        }
      }
    }
    // har tick pe connect-note box check karo (modal kabhi bhi khul sakta hai)
    fillConnectNote();
  }

  setInterval(check, 1200);
  check();
})();
