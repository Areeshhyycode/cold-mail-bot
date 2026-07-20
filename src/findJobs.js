/**
 * AUTO-FIND JOBS (no browsing) — npm run find-jobs
 *
 * Saare public job sources se REAL, currently-open remote junior JS jobs le aata
 * hai, tumhare stack (MERN/Next/Nest) + junior + remote se filter karta hai,
 * rank karta hai, aur ek markdown report likhta hai apply links ke saath:
 *
 *   logs/jobs.md   → best-fit jobs pehle, direct apply links
 *
 * Sources: HN, RemoteOK, Remotive, WWR, Arbeitnow, Jobicy (job boards) +
 *          Greenhouse, Lever, Ashby (ATS public APIs). Sab open jobs hi dete hain.
 *
 *   node src/findJobs.js                # default: tumhare target roles
 *   node src/findJobs.js "next.js nest"  # apna keyword filter
 */
import dotenv from "dotenv";
import fs from "fs/promises";
import { scrapeAllJobBoards } from "./scraper/jobBoards.js";
import { scrapeAllATS } from "./scraper/atsBoards.js";
import { evaluateJob } from "./scraper/jobFilter.js";
import { ROLE_KEYWORDS } from "./ai/intent.js";

dotenv.config();

function fmtDate(d) {
  try { return d ? new Date(d).toISOString().slice(0, 10) : ""; } catch { return ""; }
}

async function main() {
  const keyword = process.argv.slice(2).join(" ").trim() || ROLE_KEYWORDS.slice(0, 8).join(" ");
  console.log(`🔎 Finding real remote junior JS jobs (filter: "${keyword}")\n`);

  console.log("🧩 Job boards (HN, RemoteOK, Remotive, WWR, Arbeitnow, Jobicy):");
  const boards = await scrapeAllJobBoards(keyword).catch((e) => {
    console.log("   ⚠️ boards fail:", e.message);
    return [];
  });

  console.log("\n🏢 ATS (Greenhouse, Lever, Ashby):");
  const ats = await scrapeAllATS().catch((e) => {
    console.log("   ⚠️ ATS fail:", e.message);
    return [];
  });

  // dedupe by apply URL
  const all = [...boards, ...ats];
  const seen = new Set();
  const uniq = all.filter((j) => {
    const k = (j.jobUrl || "").split("#")[0];
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const ranked = uniq
    .map((j) => ({ j, e: evaluateJob(j) }))
    .filter((o) => o.e.keep)
    .sort((a, b) => b.e.score - a.e.score);

  console.log(
    `\n📊 ${all.length} raw → ${uniq.length} unique → ${ranked.length} match (remote + junior + your stack)\n`
  );

  // ---- markdown report ----
  const L = [];
  L.push("# 🎯 Remote Junior MERN / Next.js / NestJS Jobs");
  L.push(`\n_Generated: ${new Date().toISOString()} · ${ranked.length} matches · ranked best-fit first_\n`);
  L.push("Priority: 🌍 worldwide remote > internship > junior/fresh > your stack.\n");
  ranked.slice(0, 80).forEach(({ j, e }, i) => {
    const remote = e.remote.worldwide
      ? "🌍 Worldwide remote"
      : e.remote.pkFriendly
        ? "Remote (likely PK-friendly)"
        : "Remote";
    L.push(`## ${i + 1}. ${j.jobTitle || "(role)"} — ${j.company || "?"}  \`fit ${e.score}\``);
    L.push(`- **Type:** ${e.isIntern ? "Internship" : "Job"}${e.isJunior ? " · junior-friendly" : ""}`);
    L.push(`- **Remote:** ${remote}${e.remote.restriction ? ` · ⚠️ restriction: ${e.remote.restriction}` : ""}`);
    L.push(`- **Skills matched:** ${e.stack.join(", ") || "—"}`);
    L.push(`- **Apply:** ${j.jobUrl || "—"}`);
    L.push(`- **Source:** ${j.source} · **Posted:** ${fmtDate(j.datePosted) || "—"}`);
    L.push("");
  });

  await fs.mkdir("logs", { recursive: true }).catch(() => {});
  await fs.writeFile("logs/jobs.md", L.join("\n"), "utf8");
  console.log("✅ Report saved → logs/jobs.md  (open karke links click karo)");

  console.log("\n🏆 Top 10:");
  ranked.slice(0, 10).forEach(({ j, e }, i) => {
    console.log(`  ${i + 1}. [fit ${e.score}] ${j.jobTitle} — ${j.company} (${j.source})`);
    console.log(`       ${j.jobUrl}`);
  });
  if (!ranked.length) {
    console.log("  (0 match — sources down ho sakte hain, ya filter strict. Dobara try karo.)");
  }
}

main().catch((e) => {
  console.error("❌ Error:", e.message);
  process.exit(1);
});
