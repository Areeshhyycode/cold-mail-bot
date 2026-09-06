/**
 * AUTO-FIND JOBS (no manual browsing) — npm run find-jobs
 *
 * PAKISTAN-FIRST. Karachi/Pakistan ki local MERN/web internships + junior jobs
 * SABSE UPAR, phir worldwide remote. Ek markdown report likhta hai apply links ke
 * saath, tiers me grouped:
 *
 *   logs/jobs.md
 *     🇵🇰 Karachi (onsite/hybrid)  → user ki #1 priority
 *     🇵🇰 Baaki Pakistan
 *     🌍 Worldwide / PK-friendly remote
 *
 * Sources:
 *   - rozee.pk (Playwright)         → Karachi/Pakistan LOCAL jobs (asli gap)
 *   - HN, RemoteOK, Remotive, WWR, Arbeitnow, Jobicy → remote
 *   - Greenhouse, Lever, Ashby (ATS public APIs)     → remote
 *
 *   node src/findJobs.js                 # default: tumhare target roles
 *   node src/findJobs.js "next.js nest"  # apna keyword filter (remote boards)
 *   node src/findJobs.js --no-rozee      # rozee skip (Playwright na ho to)
 */
import dotenv from "dotenv";
import fs from "fs/promises";
import { scrapeAllJobBoards } from "./scraper/jobBoards.js";
import { scrapeAllATS } from "./scraper/atsBoards.js";
import { scrapeRozee } from "./scraper/rozeeJobs.js";
import { evaluateJob } from "./scraper/jobFilter.js";
import { ROLE_KEYWORDS } from "./ai/intent.js";
import { connectDB, disconnectDB } from "./db/connect.js";
import { getMatchProfile, getAllMatchProfiles, matchJobToProfiles } from "./ai/profileSkills.js";

dotenv.config();

function fmtDate(d) {
  try { return d ? new Date(d).toISOString().slice(0, 10) : ""; } catch { return ""; }
}

const TIER_META = {
  karachi: { label: "🇵🇰 Karachi (onsite / hybrid / remote-PK)", emoji: "📍" },
  pakistan: { label: "🇵🇰 Baaki Pakistan (Lahore / Islamabad / remote-PK)", emoji: "📍" },
  "worldwide-remote": { label: "🌍 Worldwide remote (PK se apply)", emoji: "🌍" },
  "remote-pk-friendly": { label: "🌍 Remote (PK-friendly)", emoji: "🌍" },
  remote: { label: "💻 Other remote", emoji: "💻" },
};
const TIER_ORDER = ["karachi", "pakistan", "worldwide-remote", "remote-pk-friendly", "remote"];

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--no-rozee");
  const useRozee = !process.argv.includes("--no-rozee");
  const keyword = args.join(" ").trim() || ROLE_KEYWORDS.slice(0, 8).join(" ");

  console.log(`🔎 Finding jobs — PAKISTAN-FIRST + CV-matched\n`);

  // tumhari CV (default CareerProfile) load karo — matching iske against hoti hai
  let profile = null;
  let allProfiles = [];
  try {
    await connectDB();
    profile = await getMatchProfile();
    allProfiles = await getAllMatchProfiles();
    console.log(`👤 Default: "${profile.name}" · matching against ${allProfiles.length} profiles: ${allProfiles.map((p) => p.name).join(", ")}\n`);
  } catch (e) {
    console.log(`   ⚠️  profile load fail (${e.message}) — fallback skills use ho rahe\n`);
  }

  // rozee (Karachi/Pakistan local) + remote boards + ATS — parallel
  const tasks = [
    scrapeAllJobBoards(keyword).catch((e) => { console.log("   ⚠️ boards fail:", e.message); return []; }),
    scrapeAllATS().catch((e) => { console.log("   ⚠️ ATS fail:", e.message); return []; }),
  ];
  if (useRozee) {
    console.log("🇵🇰 rozee.pk (Karachi/Pakistan local — Playwright):");
    tasks.unshift(scrapeRozee().catch((e) => { console.log("   ⚠️ rozee fail:", e.message); return []; }));
  }

  const parts = await Promise.all(tasks);
  const all = parts.flat();

  // dedupe by apply URL
  const seen = new Set();
  const uniq = all.filter((j) => {
    const k = (j.jobUrl || "").split("#")[0].split("?")[0];
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const ranked = uniq
    .map((j) => ({ j, e: evaluateJob(j, { profile }) }))
    .filter((o) => o.e.keep)
    .sort((a, b) => b.e.score - a.e.score);

  // group by tier
  const byTier = {};
  for (const o of ranked) (byTier[o.e.tier] ||= []).push(o);

  const pkCount = (byTier.karachi?.length || 0) + (byTier.pakistan?.length || 0);
  console.log(
    `\n📊 ${all.length} raw → ${uniq.length} unique → ${ranked.length} match ` +
      `(🇵🇰 ${pkCount} Pakistan · 🌍 ${ranked.length - pkCount} remote)\n`
  );

  // ---- markdown report (tiered) ----
  const L = [];
  L.push("# 🎯 Jobs — Pakistan-first (Karachi MERN internships + remote)");
  L.push(`\n_Generated: ${new Date().toISOString()} · ${ranked.length} matches · Karachi/Pakistan first_\n`);

  for (const tier of TIER_ORDER) {
    const items = byTier[tier];
    if (!items || !items.length) continue;
    L.push(`\n## ${TIER_META[tier].label} — ${items.length}\n`);
    items.slice(0, 40).forEach(({ j, e }, i) => {
      const exp = e.minYears != null ? `${e.minYears}+ yr` : (e.isJunior ? "junior" : "?");
      L.push(`### ${i + 1}. ${j.jobTitle || "(role)"} — ${j.company || "?"}  \`fit ${e.score}\`${profile ? ` · \`match ${e.matchPct}%\`` : ""}`);
      L.push(`- **Type:** ${e.isIntern ? "🎓 Internship" : "Job"} · **Exp:** ${exp}${j.salary ? ` · **Salary:** ${j.salary}` : ""}`);
      L.push(`- **Location:** ${j.location || "—"}`);
      L.push(`- **✅ Your skills matched:** ${(e.matched && e.matched.length ? e.matched : e.stack).join(", ") || "(title-relevant)"}`);
      if (e.missing && e.missing.length) L.push(`- **⚠️ Missing (in job, not in your CV):** ${e.missing.slice(0, 8).join(", ")}`);
      if (allProfiles.length > 1) {
        const mp = matchJobToProfiles(`${j.jobTitle || ""} ${j.jobDescription || ""}`, allProfiles);
        L.push(`- **🎯 Best profile:** ${mp.best.name} (${mp.best.matchPct}%) · ${mp.scores.slice(0, 4).map((s) => `${s.name.split(" ")[0]} ${s.matchPct}%`).join(" · ")}`);
      }
      L.push(`- **Apply:** ${j.jobUrl || "—"}`);
      L.push(`- **Source:** ${j.source} · **Posted:** ${fmtDate(j.datePosted) || "—"}`);
      L.push("");
    });
  }

  await fs.mkdir("logs", { recursive: true }).catch(() => {});
  await fs.writeFile("logs/jobs.md", L.join("\n"), "utf8");
  console.log("✅ Report saved → logs/jobs.md  (Karachi/Pakistan jobs sabse upar)");

  // console: top Pakistan + top remote
  const showTop = (tier, title) => {
    const items = byTier[tier];
    if (!items || !items.length) return;
    console.log(`\n${title}:`);
    items.slice(0, 6).forEach(({ j, e }, i) =>
      console.log(`  ${i + 1}. [fit ${e.score}${profile ? ` · match ${e.matchPct}%` : ""}] ${j.jobTitle} — ${j.company} (${j.location})\n       ${j.jobUrl}`)
    );
  };
  showTop("karachi", "🏆 Top Karachi");
  showTop("pakistan", "🏆 Top Pakistan (other cities)");
  showTop("worldwide-remote", "🌍 Top worldwide remote");

  if (!ranked.length) {
    console.log("\n  (0 match — sources down ho sakte hain ya rozee/Playwright missing. Dobara try karo.)");
  }

  await disconnectDB().catch(() => {});
}

main().catch((e) => {
  console.error("❌ Error:", e.message);
  process.exit(1);
});
