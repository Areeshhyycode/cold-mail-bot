import { connectDB } from "../lib/mongoose.js";
import { Lead } from "../lib/Lead.js";

export const dynamic = "force-dynamic"; // hamesha fresh data

async function getData() {
  await connectDB();

  const total = await Lead.countDocuments();
  const sent = await Lead.countDocuments({
    status: { $in: ["sent", "followup_1", "followup_2", "done", "replied"] },
  });
  const replied = await Lead.countDocuments({ status: "replied" });
  const opened = await Lead.countDocuments({ opened: true });
  const ready = await Lead.countDocuments({ status: "ready" });

  const leads = await Lead.find({})
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();

  const openRate = sent > 0 ? ((opened / sent) * 100).toFixed(0) : 0;
  const replyRate = sent > 0 ? ((replied / sent) * 100).toFixed(0) : 0;

  return { total, sent, replied, opened, ready, openRate, replyRate, leads };
}

function fmt(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default async function Dashboard() {
  let data;
  try {
    data = await getData();
  } catch (e) {
    return (
      <div className="container">
        <div className="empty">⚠️ DB connect nahi hua: {e.message}<br />.env.local me MONGODB_URI check karo.</div>
      </div>
    );
  }

  const { total, sent, replied, opened, ready, openRate, replyRate, leads } = data;

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <div className="logo">📬</div>
          <div>
            <h1>Cold Mail Bot</h1>
            <div className="sub">Lead pipeline & campaign analytics</div>
          </div>
        </div>
        <div className="sub">{new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</div>
      </div>

      <div className="grid">
        <div className="card"><div className="label">Total Leads</div><div className="value">{total}</div></div>
        <div className="card"><div className="label">Emails Sent</div><div className="value accent">{sent}</div></div>
        <div className="card"><div className="label">Open Rate</div><div className="value green">{openRate}%</div></div>
        <div className="card"><div className="label">Replies</div><div className="value purple">{replied}</div></div>
        <div className="card"><div className="label">Reply Rate</div><div className="value">{replyRate}%</div></div>
        <div className="card"><div className="label">Ready to Send</div><div className="value">{ready}</div></div>
      </div>

      <div className="panel">
        <div className="panel-head">Leads ({leads.length})</div>
        {leads.length === 0 ? (
          <div className="empty">Abhi koi lead nahi. <code>npm run scrape</code> chala ke leads laao.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Business</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Email</th>
                <th>Open</th>
                <th>Sent</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l._id.toString()}>
                  <td>
                    <div className="biz">{(l.businessName || "").slice(0, 32)}</div>
                    <div className="email">{l.email}</div>
                  </td>
                  <td>{l.ownerName || "—"}</td>
                  <td><span className={`badge ${l.status}`}>{l.status}</span></td>
                  <td><span className={`badge ${l.emailStatus === "valid" ? "sent" : l.emailStatus === "risky" ? "followup_1" : "new"}`}>{l.emailStatus || "unknown"}</span></td>
                  <td>
                    <span className={`dot ${l.opened ? "open" : "noopen"}`}></span>
                    {l.opened ? `${l.openCount || 1}×` : "—"}
                  </td>
                  <td>{l.sentCount || 0}</td>
                  <td className="email">{fmt(l.lastOpenedAt || l.lastSentAt || l.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="footer">Cold Mail Bot · auto-refreshes on reload</div>
    </div>
  );
}
