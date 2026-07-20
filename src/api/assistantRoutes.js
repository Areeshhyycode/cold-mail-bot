/**
 * ASSISTANT ROUTE TABLE — Task 8.
 *
 * outreachRoutes.js wala hi pattern: saari /api/assistant/* routing yahan hai,
 * server.js me sirf 2 lines. Isse merge-conflict ka surface chhota rehta hai
 * (server.js pe kai log kaam kar rahe hain).
 *
 * FARQ ek hai: chat endpoint SSE (Server-Sent Events) stream karta hai, isliye
 * wo `res` khud sambhalta hai aur `{ handled: true }` return karta hai — baaki
 * routes normal { status, body } dete hain.
 *
 * Routes:
 *   POST /api/assistant/chat            SSE stream (tokens + tool events)
 *   GET  /api/assistant/conversations   chat list
 *   GET  /api/assistant/conversation    ek chat poori (?id=)
 *   POST /api/assistant/conversation/delete
 *   GET  /api/assistant/search          conversation search (?q=)
 *   GET  /api/assistant/recommendations proactive suggestions
 *   GET  /api/assistant/tools           kaunse tools available hain (debug/UI)
 */
import { Conversation } from "../db/Conversation.js";
import {
  getConversation, buildHistory, addUserMessage, addAssistantMessage,
  maybeSummarize, listConversations, searchConversations,
} from "../assistant/memory.js";
import { runAgent, extractExplain } from "../assistant/agent.js";
import { getRecommendations } from "../assistant/recommendations.js";
import { TOOLS } from "../assistant/tools.js";
import { roleInfo, ROLES } from "../assistant/permissions.js";
import { vStr, vNum } from "../core/httpAuth.js";
import { HttpError } from "./jobsApi.js";

const ok = (body) => ({ status: 200, body });

/**
 * @returns {Promise<{status:number,body:object}|{handled:true}|null>}
 *          null = ye route mera nahi
 */
export async function handleAssistant(p, req, res, url, readJson) {
  if (!p.startsWith("/api/assistant")) return null;

  const GET = req.method === "GET";
  const POST = req.method === "POST";

  try {
    /* ------------------------- chat (SSE stream) ------------------------- */
    if (p === "/api/assistant/chat" && POST) {
      const body = await readJson(req);
      await streamChat(body, res);
      return { handled: true };
    }

    /* ---------------------------- history -------------------------------- */
    if (p === "/api/assistant/conversations" && GET) {
      const limit = vNum(url.searchParams.get("limit"), 1, 100) || 30;
      return ok({ ok: true, conversations: await listConversations(limit) });
    }

    if (p === "/api/assistant/conversation" && GET) {
      const id = vStr(url.searchParams.get("id"), 40);
      if (!id) throw new HttpError("?id= chahiye", 400);
      const c = await Conversation.findById(id).lean();
      if (!c) throw new HttpError("Conversation nahi mili", 404);
      return ok({ ok: true, conversation: c });
    }

    if (p === "/api/assistant/conversation/delete" && POST) {
      const b = await readJson(req);
      const id = vStr(b?.id, 40);
      if (!id) throw new HttpError("id chahiye", 400);
      await Conversation.findByIdAndUpdate(id, { archived: true });
      return ok({ ok: true });
    }

    if (p === "/api/assistant/search" && GET) {
      const q = vStr(url.searchParams.get("q"), 120);
      return ok({ ok: true, conversations: await searchConversations(q) });
    }

    /* ------------------------ recommendations ---------------------------- */
    if (p === "/api/assistant/recommendations" && GET) {
      return ok({ ok: true, ...(await getRecommendations()) });
    }

    /* ---------------------------- tools ---------------------------------- */
    if (p === "/api/assistant/tools" && GET) {
      const role = vStr(url.searchParams.get("role"), 20) || "admin";
      const info = roleInfo(role);
      return ok({
        ok: true,
        roles: ROLES,
        role,
        allowed: info,
        tools: TOOLS.map((t) => ({
          name: t.name, module: t.module, risk: t.risk,
          description: t.description.slice(0, 160),
          allowed: info.modules.includes(t.module),
        })),
      });
    }

    return { status: 404, body: { error: "assistant route nahi mila" } };
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error("❌ assistant:", err);
    return { status, body: { error: err.message } };
  }
}

/* ========================================================================== *
 *  SSE chat stream
 * ========================================================================== */
/**
 * Har event ek line hai: `event: <name>\ndata: <json>\n\n`
 * Client EventSource-style parse karta hai (hum fetch+ReadableStream use karte
 * hain kyunki EventSource POST nahi kar sakta).
 */
async function streamChat(body, res) {
  const message = vStr(body?.message, 4000);
  const conversationId = vStr(body?.conversationId, 40);
  const role = vStr(body?.role, 20) || "admin";
  const confirmed = Array.isArray(body?.confirm) ? body.confirm.map(String).slice(0, 5) : [];

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",     // proxy buffering off
  });

  const send = (event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
    catch { /* client chala gaya */ }
  };

  if (!message) {
    send("error", { error: "message khali hai" });
    res.end();
    return;
  }

  let conv;
  try {
    conv = await getConversation(conversationId, role);
    send("meta", { conversationId: String(conv._id), title: conv.title });

    await addUserMessage(conv, message);
    const history = buildHistory(conv);

    const result = await runAgent({ history, role, confirmed, emit: send, conv });

    const explain = extractExplain(result.content, result.toolCalls);
    await addAssistantMessage(conv, {
      content: result.content,
      toolCalls: result.toolCalls,
      explain,
    });

    // lambi chat ho gayi to purane turns compress kar do (background, non-blocking)
    maybeSummarize(conv).catch(() => {});

    send("done", {
      conversationId: String(conv._id),
      title: conv.title,
      toolCalls: result.toolCalls,
      explain,
      needsConfirmation: result.needsConfirmation,
    });
  } catch (e) {
    console.error("❌ assistant chat:", e);
    send("error", { error: e.message });
  } finally {
    res.end();
  }
}
