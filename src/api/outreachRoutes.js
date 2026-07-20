/**
 * OUTREACH ROUTE TABLE — server.js me sirf 2 lines add karne ke liye.
 *
 * server.js pehle se bara ho chuka hai (jobs + businesses routes). Uska request
 * handler chhota rakhne ke liye saari /api/outreach/* routing yahan hai. server.js
 * bas itna karta hai:
 *
 *     import { handleOutreach } from "../api/outreachRoutes.js";
 *     const handled = await handleOutreach(p, req, url, readJson);
 *     if (handled) return json(res, handled.status, handled.body);
 *
 * `null` return = "ye route mera nahi" → server.js apni baaki routing chalata hai.
 * Isse merge-conflict ka surface 2 lines reh jata hai.
 */
import {
  listQueue, approveMessage, rejectMessage, markSent, editMessage,
  listReplies, sendReply, dismissReply,
  listCampaigns, upsertCampaign, setCampaignStatus,
  getAnalytics, outreachStats,
} from "./outreachApi.js";
import { HttpError } from "./jobsApi.js";

/**
 * @returns {Promise<{status:number, body:object}|null>} null = not an outreach route
 */
export async function handleOutreach(p, req, url, readJson) {
  if (!p.startsWith("/api/outreach")) return null;

  const GET = req.method === "GET";
  const POST = req.method === "POST";
  const body = POST ? await readJson(req) : null;

  try {
    // stats + analytics
    if (p === "/api/outreach/stats" && GET) return ok(await outreachStats());
    if (p === "/api/outreach/analytics" && GET) return ok(await getAnalytics(url.searchParams));

    // approval queue
    if (p === "/api/outreach/queue" && GET) return ok(await listQueue(url.searchParams));
    if (p === "/api/outreach/approve" && POST) return ok(await approveMessage(body));
    if (p === "/api/outreach/reject" && POST) return ok(await rejectMessage(body));
    if (p === "/api/outreach/mark-sent" && POST) return ok(await markSent(body));
    if (p === "/api/outreach/edit" && POST) return ok(await editMessage(body));

    // replies
    if (p === "/api/outreach/replies" && GET) return ok(await listReplies(url.searchParams));
    if (p === "/api/outreach/replies/send" && POST) return ok(await sendReply(body));
    if (p === "/api/outreach/replies/dismiss" && POST) return ok(await dismissReply(body));

    // campaigns
    if (p === "/api/outreach/campaigns" && GET) return ok(await listCampaigns());
    if (p === "/api/outreach/campaigns" && POST) return ok(await upsertCampaign(body));
    if (p === "/api/outreach/campaigns/status" && POST) return ok(await setCampaignStatus(body));

    // /api/outreach/* tha par kisi se match nahi hua
    return { status: 404, body: { error: "outreach route nahi mila" } };
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error("❌ outreach:", err);
    return { status, body: { error: err.message } };
  }
}

const ok = (body) => ({ status: 200, body });
