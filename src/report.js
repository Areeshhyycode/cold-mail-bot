import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { connectDB, disconnectDB } from "./db/connect.js";
import { Lead } from "./db/Lead.js";
import { alertHighBounce } from "./core/alerts.js";
import { log } from "./core/logger.js";

dotenv.config();

// 5% se upar bounce -> Gmail sender reputation girana shuru kar deta hai
const BOUNCE_ALERT_THRESHOLD = 5;

/**
 * DB se stats nikaal ke logs/report.md banata hai.
 * Ye file GitHub pe push hoti hai taaki activity track ho.
 */
async function main() {
  await connectDB();

  const total = await Lead.countDocuments();
  const byStatus = await Lead.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  const sent = await Lead.countDocuments({
    status: { $in: ["sent", "followup_1", "followup_2", "done", "replied"] },
  });
  const replied = await Lead.countDocuments({ status: "replied" });

  // aaj bheji gayi emails
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const sentToday = await Lead.countDocuments({ lastSentAt: { $gte: startOfDay } });

  // recent activity (last 15 jinhe email gayi)
  const recent = await Lead.find({ lastSentAt: { $ne: null } })
    .sort({ lastSentAt: -1 })
    .limit(15)
    .select("businessName email status lastSentAt sentCount");

  // BOUNCE RATE — pehle report me tha hi nahi, isliye 12% bounce chup-chaap
  // sender reputation kha raha tha aur kisi ko pata nahi tha.
  const bounced = await Lead.countDocuments({ status: "bounced" });
  const attempted = sent + bounced;
  const bounceRate = attempted > 0 ? (bounced / attempted) * 100 : 0;

  const stamp = new Date().toISOString();
  const replyRate = sent > 0 ? ((replied / sent) * 100).toFixed(1) : "0.0";

  let md = `# 📊 Cold Mail Bot — Activity Report\n\n`;
  md += `_Last updated: ${stamp}_\n\n`;
  md += `## Summary\n\n`;
  md += `| Metric | Value |\n|---|---|\n`;
  md += `| Total leads | ${total} |\n`;
  md += `| Emails sent (unique leads) | ${sent} |\n`;
  md += `| Sent today | ${sentToday} |\n`;
  md += `| Replies | ${replied} |\n`;
  md += `| Reply rate | ${replyRate}% |\n`;
  md += `| Bounced | ${bounced} |\n`;
  md += `| Bounce rate | ${bounceRate.toFixed(1)}%${bounceRate > BOUNCE_ALERT_THRESHOLD ? " ⚠️" : ""} |\n\n`;

  md += `## Leads by status\n\n`;
  md += `| Status | Count |\n|---|---|\n`;
  for (const s of byStatus) md += `| ${s._id} | ${s.count} |\n`;
  md += `\n`;

  md += `## Recent activity (last 15)\n\n`;
  md += `| Business | Email | Status | Sent count | Last sent |\n|---|---|---|---|---|\n`;
  for (const r of recent) {
    const when = r.lastSentAt ? new Date(r.lastSentAt).toISOString().slice(0, 16).replace("T", " ") : "-";
    md += `| ${r.businessName} | ${r.email} | ${r.status} | ${r.sentCount} | ${when} |\n`;
  }

  const logsDir = path.join(process.cwd(), "logs");
  await fs.mkdir(logsDir, { recursive: true });
  await fs.writeFile(path.join(logsDir, "report.md"), md, "utf-8");

  log.info("report.generated", {
    total,
    sent,
    sentToday,
    replied,
    replyRate: `${replyRate}%`,
    bounced,
    bounceRate: `${bounceRate.toFixed(1)}%`,
  });

  // deliverability khatre me -> alert
  if (bounceRate > BOUNCE_ALERT_THRESHOLD) {
    await alertHighBounce(bounceRate.toFixed(1), bounced, attempted);
  }

  await disconnectDB();
}

main().catch((err) => {
  console.error("❌ Report error:", err.message);
  process.exit(1);
});
