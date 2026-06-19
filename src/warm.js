/**
 * WARM-LEADS MODE — quality over volume.
 *
 * 42 emails/day generic inboxes me bhejne se 0 reply aaye. Ek warm, hand-sent note
 * kisi REAL insaan ko 100 cold blasts se behtar hai. Ye script har din ke top
 * high-quality JOB leads nikaal ke ek worklist (logs/warm-leads.md) banata hai —
 * jise tum KHUD, apne haath se, thoda personalize karke bhejo.
 *
 *   node src/warm.js          # top 10
 *   node src/warm.js 15       # top 15
 *
 * Auto-send NAHI karta — jaan-boojh ke. Personal touch ka maqsad yahi hai.
 */
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { connectDB, disconnectDB } from "./db/connect.js";
import { Lead } from "./db/Lead.js";
import { looksLikePerson, isJobSeekerPost } from "./scraper/targetFilter.js";

dotenv.config();

async function main() {
  const limit = parseInt(process.argv[2] || "10", 10);
  await connectDB();

  // abhi tak contact nahi kiye JOB leads — high score + fresh pehle
  const candidates = await Lead.find({
    leadType: "JOB",
    status: { $in: ["new", "ready"] },
  })
    .sort({ score: -1, createdAt: -1 })
    .limit(limit * 4); // thoda zyada le aao, neeche quality filter karenge

  // sirf wo jahan real-person email HO, ya direct apply-URL ho (form pe apply karoge)
  const warm = candidates.filter((l) => {
    const text = [l.jobTitle, l.jobDescription, l.company, l.businessName].filter(Boolean).join(" ");
    if (isJobSeekerPost(text, l.company || l.businessName)) return false;
    return (l.email && looksLikePerson(l.email)) || Boolean(l.jobUrl);
  });

  const top = warm.slice(0, limit);

  let md = `# 🎯 Warm leads — send these BY HAND today\n\n`;
  md += `_Generated: ${new Date().toISOString()} — ${top.length} leads_\n\n`;
  md += `> Tip: open the apply link, find the person, send a SHORT note (3-4 lines). `;
  md += `Mention something specific about THEM. Attach CV. One real note > 100 blasts.\n\n`;

  top.forEach((l, i) => {
    const target = l.email && looksLikePerson(l.email) ? `📧 ${l.email}` : "🔗 apply via link";
    md += `## ${i + 1}. ${l.company || l.businessName || "(unknown)"} — ${l.jobTitle || "open role"}\n\n`;
    md += `- **Send to:** ${target}\n`;
    md += `- **Score:** ${l.score} · **Source:** ${l.source || "?"}\n`;
    if (l.jobUrl) md += `- **Apply / post:** ${l.jobUrl}\n`;
    if (l.subject) md += `- **Draft subject:** ${l.subject}\n`;
    md += `\n`;
  });

  if (!top.length) {
    md += `_No warm leads right now. Run \`npm run scrape:jobs\` to find fresh ones._\n`;
  }

  const logsDir = path.join(process.cwd(), "logs");
  await fs.mkdir(logsDir, { recursive: true });
  const out = path.join(logsDir, "warm-leads.md");
  await fs.writeFile(out, md, "utf-8");

  console.log(`\n🎯 ${top.length} warm leads → logs/warm-leads.md`);
  top.forEach((l, i) => {
    const t = l.email && looksLikePerson(l.email) ? l.email : "(apply link)";
    console.log(`   ${i + 1}. ${(l.company || l.businessName || "?").slice(0, 40).padEnd(40)} ${t}`);
  });
  console.log(`\n👉 Open logs/warm-leads.md and send each one by hand. Quality > volume.\n`);

  await disconnectDB();
}

main().catch((err) => {
  console.error("❌ Warm-leads error:", err.message);
  process.exit(1);
});
