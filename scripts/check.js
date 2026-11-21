// npm run check [url]   (default http://localhost:8787, or CHECK_URL)
// Sends every case in checks.json 3 times. A case PASSES only if all 3 runs end with the expected status
// (and the expected kind, when the server reports it: it does so only while TEST_MODE is "on").
import { readFileSync } from "node:fs";

const URL_BASE = (process.argv[2] || process.env.CHECK_URL || "http://localhost:8787").replace(/\/$/, "");
const RUNS = 3;
const only = process.env.CHECK_ONLY?.toLowerCase();
const cases = JSON.parse(readFileSync(new URL("../checks.json", import.meta.url), "utf8"))
  .filter((c) => !only || c.name.toLowerCase().includes(only));

async function send(c) {
  try {
    const res = await fetch(`${URL_BASE}/request`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(c.headers || {}) },
      body: JSON.stringify({ message: c.message }),
      signal: AbortSignal.timeout(180000),
    });
    return await res.json();
  } catch (err) {
    return { status: `error(${err.message})` };
  }
}

let passed = 0;
let tokens = 0;
let cost = 0;
let noKind = false;
console.log(`Checking ${URL_BASE}\n`);
for (const c of cases) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await send(c);
    tokens += (r.usage?.input || 0) + (r.usage?.output || 0);
    cost += r.cost || 0;
    const kindKnown = r.kind !== undefined;
    if (c.kind && !kindKnown) noKind = true;
    const said = (r.reply || "").toLowerCase();
    const bad = (c.not_in_reply || []).filter((w) => said.includes(w));
    const ok = r.status === c.status && (!c.kind || !kindKnown || r.kind === c.kind) && !bad.length;
    runs.push({ ok, got: (r.kind && c.kind ? `${r.status}/${r.kind}` : r.status) + (bad.length ? ` (said: ${bad.join(",")})` : "") });
  }
  const pass = runs.every((r) => r.ok);
  if (pass) passed++;
  const want = c.kind ? `${c.status}/${c.kind}` : c.status;
  console.log(`${pass ? "PASS" : "FAIL"}  ${c.name}`);
  console.log(`      expected ${want}; got ${runs.map((r) => r.got + (r.ok ? "" : " ✗")).join(", ")}`);
}
console.log(`\n${passed}/${cases.length} cases passed (${RUNS} runs each)`);
console.log(`Tokens used by this check run: ${tokens}; cost: USD ${cost.toFixed(6)} (${cost === 0 ? "free tier, PRICE_IN/PRICE_OUT are 0" : "at the PRICE settings"})`);
if (noKind) console.log("Note: the server did not report 'kind' (TEST_MODE is off), so only the status was checked.");
process.exit(passed === cases.length ? 0 : 1);
