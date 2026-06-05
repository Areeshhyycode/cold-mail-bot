import { connectDB } from "../../lib/mongoose.js";
import { Lead } from "../../lib/Lead.js";

export const dynamic = "force-dynamic";

/**
 * Email footer me ".../unsubscribe?id=LEADID" link hota hai.
 * Click karne par lead "unsubscribed" ho jata hai (aage koi email nahi).
 */
export default async function Unsubscribe({ searchParams }) {
  const id = searchParams?.id;
  let ok = false;
  let already = false;

  if (id) {
    try {
      await connectDB();
      const lead = await Lead.findById(id);
      if (lead) {
        if (lead.status === "unsubscribed") already = true;
        else {
          lead.status = "unsubscribed";
          await lead.save();
        }
        ok = true;
      }
    } catch {
      ok = false;
    }
  }

  return (
    <div className="center-box">
      <div className="unsub-card">
        {ok ? (
          <>
            <div className="check">✅</div>
            <h2>{already ? "You're already unsubscribed" : "You've been unsubscribed"}</h2>
            <p>We won't send you any more emails. Sorry for the interruption — wishing you all the best.</p>
          </>
        ) : (
          <>
            <div className="check">⚠️</div>
            <h2>Link not valid</h2>
            <p>We couldn't process this request. If you keep getting emails, just reply with "unsubscribe" and we'll remove you.</p>
          </>
        )}
      </div>
    </div>
  );
}
