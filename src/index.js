import { callModel } from "./model.js";
import page from "./page.html";
import inboxPage from "./inbox.html";
import menu from "../data/menu.md"; // the bakery's knowledge: edit data/menu.md, not the code

const HOLDING = "Sorry, I can't answer right now. Please try again in a moment.";
const AWAITING = "Your reply is awaiting approval.";
const CANCELLED = "A team member will follow up with you personally.";
const MAX_MESSAGES = 20;
const MAX_CHARS = 2000;
const TTL = 60 * 60 * 24 * 30; // items are deleted after 30 days

const SYSTEM = `You are the friendly chat assistant of a bakery. You help customers learn about our items, ingredients, allergens and how things are made.
Return JSON with:
- kind: "answer" when you can answer from the BAKERY INFO; "ask" when the question is too unclear to answer and you need one clarifying question; "handover" when the customer wants something only a person can do (orders, discounts, price changes, complaints, refunds) or anything outside the bakery.
- reply: the message to show the customer.
Rules:
- Answer ONLY from the BAKERY INFO below. If it is not there, say you don't have that information and suggest asking in the shop (kind "answer"). Never invent items, prices, ingredients or allergens.
- Keep replies short and warm. Use bullet lists for ingredients. Mention allergens when ingredients are asked about.
- Reply in the language the customer writes in.
- We have no phone number, email or website in the BAKERY INFO. Never tell customers to call, phone, email or go online; for anything you cannot do, say to ask a team member in the shop.

BAKERY INFO:
${menu}`;

const SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["answer", "ask", "handover"] },
    reply: { type: "string" },
  },
  required: ["kind", "reply"],
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const html = (body) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });

// Accept {message:"..."} or {messages:[{role,content}]} (chat history from the page).
function cleanHistory(body) {
  const raw = Array.isArray(body?.messages)
    ? body.messages
    : typeof body?.message === "string" ? [{ role: "user", content: body.message }] : null;
  if (!raw) return null;
  const msgs = raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }))
    .slice(-MAX_MESSAGES);
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  return msgs.length && msgs[msgs.length - 1].role === "user" ? msgs : null;
}

// ---- storage -------------------------------------------------------------
// item = { id, created, status, message, kind, draft, sent, usage }
//   draft: what the agent wrote (a person may edit it)
//   sent:  what the user may see. It stays null until a person presses Approve.
const key = (id) => `item:${id}`;
const getItem = async (env, id) => (await env.ITEMS.get(key(id), "json")) ?? null;
const putItem = (env, item) => env.ITEMS.put(key(item.id), JSON.stringify(item), { expirationTtl: TTL });

// Cost in USD of one run. PRICE_IN / PRICE_OUT are USD per million tokens (0 on a free tier).
const costOf = (u, env) =>
  +(((u?.input || 0) * Number(env.PRICE_IN || 0) + (u?.output || 0) * Number(env.PRICE_OUT || 0)) / 1e6).toFixed(6);

// The ONLY thing the user side can ever read. Model text is never in here unless `sent` is set.
function publicView(item) {
  if (item.status === "awaiting_approval") return { id: item.id, status: item.status, message: AWAITING };
  if (item.status === "handed_over" || item.status === "asked_question")
    return { id: item.id, status: item.status, reply: item.sent ?? CANCELLED };
  return { id: item.id, status: "failed", message: HOLDING };
}

// ---- user side -----------------------------------------------------------
async function handleRequest(request, env) {
  let body;
  try { body = await request.json(); } catch { body = null; }
  const history = cleanHistory(body);
  if (!history) return json({ status: "failed", message: 'Send {"message":"..."}.' }, 400);

  const item = {
    id: `${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
    created: new Date().toISOString(),
    message: history[history.length - 1].content,
    status: "failed", kind: null, draft: null, sent: null, usage: null,
  };
  // Test switch for `npm run check`: only works when TEST_MODE is "on" (set in .dev.vars, never in wrangler.toml).
  const testMode = env.TEST_MODE === "on";
  try {
    if (testMode && request.headers.get("X-Test-Fail-Model") === "1") throw new Error("simulated model failure");
    const { json: a, usage } = await callModel(SYSTEM, history, SCHEMA, env);
    if (!["answer", "ask", "handover"].includes(a?.kind) || typeof a.reply !== "string" || !a.reply.trim())
      throw new Error("unreadable answer");
    Object.assign(item, { kind: a.kind, draft: a.reply, usage, cost: costOf(usage, env) });
    if (env.REQUIRE_APPROVAL === "on") {
      item.status = "awaiting_approval"; // held in /inbox until a person presses Approve
    } else {
      item.status = a.kind === "ask" ? "asked_question" : "handed_over"; // sent straight to the user
      item.sent = a.reply;
    }
  } catch (err) {
    console.error("model call failed:", err.message); // never log the key
  }
  try { await putItem(env, item); } catch (err) {
    console.error("save failed:", err.message);
    if (item.status === "awaiting_approval" || item.status === "failed") return json({ status: "failed", message: HOLDING });
  }
  // In test mode the response also names the agent's classification and the run's tokens/cost (no reply text),
  // so `npm run check` can see them.
  return json({ ...publicView(item), ...(testMode && { kind: item.kind, usage: item.usage, cost: item.cost }) });
}

async function handleStatus(env, id) {
  const item = await getItem(env, id);
  return item ? json(publicView(item)) : json({ status: "failed", message: "Not found." }, 404);
}

// ---- inbox (a person) ----------------------------------------------------
async function listAwaiting(env) {
  const { keys } = await env.ITEMS.list({ prefix: "item:" });
  const items = await Promise.all(keys.map((k) => env.ITEMS.get(k.name, "json")));
  return items.filter((i) => i?.status === "awaiting_approval").sort((a, b) => (a.id < b.id ? -1 : 1));
}

// runs today, total tokens, total cost, cost per finished run (a run that delivered a reply).
// lean-ctx: reads up to 1000 items from KV, upgrade when volume grows (use KV cursor or a database).
async function handleCosts(env) {
  const { keys } = await env.ITEMS.list({ prefix: "item:" });
  const items = (await Promise.all(keys.map((k) => env.ITEMS.get(k.name, "json")))).filter(Boolean);
  const today = new Date().toISOString().slice(0, 10);
  const tokens = items.reduce((s, i) => s + (i.usage?.input || 0) + (i.usage?.output || 0), 0);
  const totalCost = items.reduce((s, i) => s + (i.cost || 0), 0);
  const finished = items.filter((i) => ["handed_over", "asked_question"].includes(i.status) && i.sent).length;
  return json({
    runs_today: items.filter((i) => i.created?.startsWith(today)).length,
    total_runs: items.length,
    finished_runs: finished,
    total_tokens: tokens,
    total_cost_usd: +totalCost.toFixed(6),
    cost_per_finished_run_usd: finished ? +(totalCost / finished).toFixed(6) : null,
    tokens_per_finished_run: finished ? Math.round(tokens / finished) : null,
  });
}

async function handleInbox(request, env, path) {
  if (path === "/inbox" && request.method === "GET") return html(inboxPage);
  if (path === "/inbox/costs" && request.method === "GET") return await handleCosts(env);
  if (path === "/inbox/items" && request.method === "GET") return json({ items: await listAwaiting(env) });

  const m = path.match(/^\/inbox\/([\w-]+)\/(approve|edit|cancel)$/);
  if (!m || request.method !== "POST") return json({ error: "Not found." }, 404);
  const item = await getItem(env, m[1]);
  if (!item) return json({ error: "Not found." }, 404);
  if (item.status !== "awaiting_approval") return json({ error: "Already decided." }, 409);

  if (m[2] === "edit") {
    const { draft } = (await request.json().catch(() => ({}))) ?? {};
    if (typeof draft !== "string" || !draft.trim()) return json({ error: "Draft is empty." }, 400);
    item.draft = draft.slice(0, MAX_CHARS * 2);
  } else if (m[2] === "approve") {
    item.status = "handed_over";
    item.sent = item.draft;
  } else {
    item.status = "handed_over"; // a person takes over; the user never sees the draft
    item.sent = null;
  }
  await putItem(env, item);
  return json({ ok: true, status: item.status });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === "/" && request.method === "GET") return html(page);
      if (pathname === "/request" && request.method === "POST") return await handleRequest(request, env);
      const s = pathname.match(/^\/request\/([\w-]+)$/);
      if (s && request.method === "GET") return await handleStatus(env, s[1]);
      if (pathname.startsWith("/inbox")) return await handleInbox(request, env, pathname);
      return json({ error: "Not found. Open / or POST /request." }, 404);
    } catch (err) {
      console.error("unexpected:", err.message);
      return json({ status: "failed", message: HOLDING });
    }
  },
};
