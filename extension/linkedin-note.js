/* LinkedIn profile note panel — jab tum kisi CAPTURED recruiter ka profile kholti
 * ho, is page pe ek floating panel aa jata hai jisme AI note READY hota hai.
 * Tum "Copy note" dabao → LinkedIn ka Connect → Add a note → paste → Send.
 *
 * COMPLIANCE: ye kuch auto-send/auto-click NAHI karta. Sirf note dikhata + copy
 * karta hai. Send hamesha tum karti ho. Panel sirf un profiles pe aata hai jinhe
 * tum pehle "Capture" kar chuki ho (backend me note mojood ho).
 *
 * LinkedIn ek SPA hai — URL bina reload badalta hai, isliye har 1.5s URL check
 * karte hain aur naye profile pe panel refresh karte hain. */
(function () {
  if (window.__jaaLiNote) return;
  window.__jaaLiNote = true;

  const PANEL_ID = "jaa-li-note-panel";
  let lastUrl = "";
  let currentId = null;

  const cleanUrl = (u) => u.split("?")[0].replace(/\/$/, "");
  const isProfile = (u) => /linkedin\.com\/in\//.test(u);

  const send = (cmd, extra) =>
    new Promise((r) =>
      chrome.runtime.sendMessage({ cmd, ...extra }, (res) => {
        void chrome.runtime.lastError;
        r(res);
      })
    );

  function removePanel() {
    const el = document.getElementById(PANEL_ID);
    if (el) el.remove();
  }

  function showPanel({ id, name, note, status }) {
    removePanel();
    currentId = id;
    const wrap = document.createElement("div");
    wrap.id = PANEL_ID;
    wrap.style.cssText =
      "position:fixed;bottom:20px;right:20px;z-index:2147483647;width:330px;" +
      "background:#0d1117;color:#e6edf3;border:1px solid #2f81f7;border-radius:12px;" +
      "box-shadow:0 8px 30px rgba(0,0,0,.5);font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;" +
      "font-size:13px;overflow:hidden";

    const done = status === "connected" || status === "replied";
    wrap.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;background:#161b22;padding:9px 12px;border-bottom:1px solid #27303b">' +
        '<b style="color:#3fb950">🔗 Note ready' + (name ? " · " + esc(name) : "") + "</b>" +
        '<span id="jaa-x" style="cursor:pointer;color:#8b949e;font-size:16px;line-height:1">×</span>' +
      "</div>" +
      '<div style="padding:11px 12px">' +
        '<textarea id="jaa-note" maxlength="300" style="width:100%;min-height:96px;background:#161b22;color:#e6edf3;border:1px solid #27303b;border-radius:8px;padding:8px;font:inherit;font-size:12.5px;line-height:1.5;resize:vertical;box-sizing:border-box">' +
          esc(note || "") +
        "</textarea>" +
        '<div style="display:flex;gap:6px;margin-top:8px">' +
          '<button id="jaa-copy" style="flex:1;background:#2f81f7;color:#fff;border:0;border-radius:7px;padding:8px;font-size:12.5px;cursor:pointer">📋 Copy note</button>' +
          '<button id="jaa-sent" style="background:' + (done ? "#238636" : "transparent") + ';color:' + (done ? "#fff" : "#e6edf3") + ';border:1px solid #27303b;border-radius:7px;padding:8px 10px;font-size:12.5px;cursor:pointer">' + (done ? "✓ Sent" : "Mark sent") + "</button>" +
        "</div>" +
        '<div style="color:#8b949e;font-size:10.5px;margin-top:7px;line-height:1.4">Connect → <b style="color:#adbac7">Add a note</b> → paste (Ctrl+V) → Send. Bhejna tum karti ho.</div>' +
      "</div>";

    document.body.appendChild(wrap);

    document.getElementById("jaa-x").onclick = removePanel;
    document.getElementById("jaa-copy").onclick = async () => {
      const val = document.getElementById("jaa-note").value;
      try {
        await navigator.clipboard.writeText(val);
        flash("jaa-copy", "✓ Copied!");
      } catch {
        const ta = document.getElementById("jaa-note");
        ta.select();
        document.execCommand("copy");
        flash("jaa-copy", "✓ Copied!");
      }
    };
    document.getElementById("jaa-sent").onclick = async () => {
      if (!currentId) return;
      await send("liStatus", { id: currentId, status: "connected" });
      flash("jaa-sent", "✓ Sent");
    };
  }

  function flash(btnId, text) {
    const b = document.getElementById(btnId);
    if (!b) return;
    const old = b.textContent;
    b.textContent = text;
    setTimeout(() => { if (b) b.textContent = old; }, 1500);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  async function check() {
    const u = cleanUrl(location.href);
    if (u === lastUrl) return;
    lastUrl = u;
    removePanel();
    if (!isProfile(u)) return;
    const res = await send("noteForUrl", { url: u });
    if (res && res.ok && res.data && res.data.found && res.data.note) {
      showPanel(res.data);
    }
  }

  // SPA: URL badalti rehti hai bina reload — poll karte hain
  setInterval(check, 1500);
  check();
})();
