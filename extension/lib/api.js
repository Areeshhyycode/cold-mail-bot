/* Job Apply Assistant — backend client (ES module).
 *
 * Sirf service worker isse use karta hai (popup NAHI) — taake network ka EK hi
 * owner ho aur retry queue reliable rahe. Popup messages bhejta hai.
 *
 * Auth: har request me `Authorization: Bearer <token>` jata hai. Token .env ke
 * API_TOKEN se aata hai aur popup ke Settings me paste hota hai. Bina token ke
 * backend 401 dega — matlab koi random website tumhare localhost:4000 ko hit
 * kar ke Groq quota nahi jala sakti (pehle CORS `*` tha, koi bhi kar sakta tha).
 */

const DEFAULT_BASE = "http://localhost:4000";
const TIMEOUT_MS = 20000;

const get = (keys) => new Promise((r) => chrome.storage.local.get(keys, r));

export async function getConfig() {
  const { botUrl, apiToken } = await get(["botUrl", "apiToken"]);
  return {
    base: (botUrl || DEFAULT_BASE).replace(/\/+$/, ""),
    token: apiToken || "",
  };
}

/** Backend error jise retry karna BEKAAR hai (4xx — request hi ghalat hai).
 *  Network/5xx retryable hain — unhe queue me wapas daalte hain. */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    // 401/403 = token ghalat; 400/422 = payload ghalat. Retry se theek nahi hoga.
    this.retryable = !status || status >= 500 || status === 429;
  }
}

async function request(path, { method = "GET", body, signal } = {}) {
  const { base, token } = await getConfig();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  if (signal) signal.addEventListener("abort", () => ctrl.abort());

  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    // bot band hai / network down — RETRYABLE
    throw new ApiError(e.name === "AbortError" ? "Backend timeout" : "Backend offline", 0);
  } finally {
    clearTimeout(timer);
  }

  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { /* non-JSON */ }

  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return data;
}

/* ------------------------------- endpoints -------------------------------- */

/** Phase 4 — bulk upsert. Backend dedupe + AI analysis queue khud sambhalta hai.
 *  @returns {{ok:true, upserted:number, duplicates:number, results:Array<{dedupeKey,id,isNew}>}} */
export const postJobs = (jobs) => request("/api/jobs", { method: "POST", body: { jobs } });

/** Ek job ka status badlo (applied/saved/rejected…) — history backend rakhta hai. */
export const patchJobStatus = (dedupeKey, status, note) =>
  request("/api/jobs/status", { method: "POST", body: { dedupeKey, status, note } });

/** AI analysis (match score, missing skills, tailored resume/cover letter).
 *  Backend cache karta hai — dobara maangne pe Groq call nahi hoti. */
export const getAnalysis = (dedupeKey, { force = false } = {}) =>
  request(`/api/jobs/analysis?key=${encodeURIComponent(dedupeKey)}${force ? "&force=1" : ""}`);

/** Backend zinda hai? (sync status badge ke liye) */
export const ping = () => request("/api/health");

/** Form question ka AI jawab (autofill ke liye — pehle se tha, ab auth ke saath). */
export const answerQuestion = (question, maxLen) =>
  request("/api/answer", { method: "POST", body: { question, maxLen } });
