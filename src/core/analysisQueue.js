/**
 * AI ANALYSIS QUEUE — har naye job ko Groq se analyze karo, par SAMAJHDARI se.
 *
 * Tumne "auto-analyze every scraped job" choose kiya. Seedha har job pe call
 * maar dena Groq ke rate limit (free tier ~30 req/min) ko fauran phoonk deta —
 * 100-job scrape = 100 parallel calls = 429 storm aur aadhi jobs bina analysis.
 *
 * Isliye ye queue:
 *   - CONCURRENCY 2 (p-limit, already dependency me hai)
 *   - har call ke beech chhota gap
 *   - 429 pe exponential backoff + retry (analysis kabhi chhooti nahi)
 *   - in-process, persistent nahi — par jo job `aiStatus:"pending"` reh jaye wo
 *     server restart pe DB se dobara uthai jati hai (resumePending)
 *
 * Queue ke andar jobs sirf ID hoti hain; fresh data DB se parhte hain, taake
 * enrichment (jo baad me description laati hai) ka fayda mil jaye.
 */
import pLimit from "p-limit";
import { Job } from "../db/Job.js";
import { analyzeJob } from "../ai/jobAnalyzer.js";

const limit = pLimit(2);                  // Groq pe ek waqt me 2 se zyada nahi
const GAP_MS = 700;                       // calls ke beech saans
const MAX_RETRY = 3;

const queued = new Set();                 // dobara enqueue na ho
let active = 0;
let done = 0;
let failed = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function queueStats() {
  return { queued: queued.size, active, done, failed };
}

/** Ek job ko analysis queue me daalo (id se). Pehle se queue me ho to no-op. */
export function enqueueAnalysis(jobId) {
  const id = String(jobId);
  if (queued.has(id)) return;
  queued.add(id);

  limit(async () => {
    active++;
    try {
      await runOne(id);
      done++;
    } catch (e) {
      failed++;
      await Job.updateOne({ _id: id }, { $set: { aiStatus: "error", aiError: e.message } }).catch(() => {});
      console.warn(`   ⚠️  AI analysis fail (${id}): ${e.message}`);
    } finally {
      active--;
      queued.delete(id);
      await sleep(GAP_MS);
    }
  });
}

async function runOne(id, attempt = 1) {
  const job = await Job.findById(id).lean();
  if (!job) return;

  // ye job pehle se analyze ho chuki aur uske baad enrich bhi nahi hui → skip
  if (job.aiStatus === "done" && job.ai && job.ai.basedOn === "detail") return;
  // "card" pe analysis ho chuki thi aur ab bhi description nahi → dobara mat karo
  if (job.aiStatus === "done" && job.ai && job.ai.basedOn === "card" && !job.enriched) return;

  try {
    const ai = await analyzeJob(job);
    await Job.updateOne(
      { _id: id },
      { $set: { ai, aiStatus: "done", aiError: null, lastUpdated: new Date() } }
    );
  } catch (e) {
    const rateLimited = /rate|429|quota|too many/i.test(e.message || "");
    if (attempt < MAX_RETRY && rateLimited) {
      await sleep(2000 * Math.pow(2, attempt));      // 4s, 8s
      return runOne(id, attempt + 1);
    }
    throw e;
  }
}

/**
 * Server start pe: jo jobs pehle se `pending`/`error` me atki hain unhe dobara
 * queue me daalo. Isse "AI analysis kabhi gum nahi hoti" wali guarantee poori
 * hoti hai — server crash ho gaya tha to bhi.
 */
export async function resumePending(maxJobs = 200) {
  const stuck = await Job.find({ aiStatus: { $in: ["pending", "error"] } })
    .sort({ fit: -1, lastUpdated: -1 })
    .limit(maxJobs)
    .select("_id")
    .lean();
  for (const j of stuck) enqueueAnalysis(j._id);
  return stuck.length;
}
