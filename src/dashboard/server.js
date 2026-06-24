/**
 * LEAD DASHBOARD — local web UI jahan saare leads + stats dikhte hain.
 *
 * Koi extra dependency nahi (Node ka built-in http use karta hai). Aapke existing
 * MongoDB se live data parhta hai.
 *
 *   npm run dashboard
 *   phir browser me: http://localhost:4000
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { connectDB } from "../db/connect.js";
import { Lead } from "../db/Lead.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.DASHBOARD_PORT || "4000", 10);

const SENT_STATUSES = ["sent", "followup_1", "followup_2", "replied", "done", "bounced"];

async function getData() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [byStatus, byType, sentToday, repliesArr] = await Promise.all([
    Lead.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    Lead.aggregate([{ $group: { _id: "$leadType", n: { $sum: 1 } } }]),
    Lead.countDocuments({ lastSentAt: { $gte: startOfDay }, status: { $in: SENT_STATUSES } }),
    Lead.find({ status: "replied" }).select("company businessName email").lean(),
  ]);

  const statusCounts = Object.fromEntries(byStatus.map((s) => [s._id || "unknown", s.n]));
  const typeCounts = Object.fromEntries(byType.map((s) => [s._id || "unknown", s.n]));
  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  const leads = await Lead.find({})
    .sort({ lastSentAt: -1, _id: -1 })
    .limit(300)
    .select("company businessName email leadType status score source subject jobTitle lastSentAt createdAt")
    .lean();

  return {
    total,
    statusCounts,
    typeCounts,
    sentToday,
    replies: repliesArr.length,
    leads: leads.map((l) => ({
      name: l.company || l.businessName || "—",
      email: l.email || "",
      leadType: l.leadType || "",
      status: l.status || "",
      score: l.score ?? 0,
      source: l.source || "",
      title: l.jobTitle || l.subject || "",
      lastSentAt: l.lastSentAt || null,
    })),
    generatedAt: new Date().toISOString(),
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url && req.url.startsWith("/api/data")) {
      const data = await getData();
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
      return;
    }
    const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

connectDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`\n📊 Dashboard ready → http://localhost:${PORT}\n   (band karne ke liye Ctrl+C)`);
    });
  })
  .catch((err) => {
    console.error("❌ DB connect fail:", err.message);
    process.exit(1);
  });
