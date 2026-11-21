// All model calls live here. Nothing else knows which provider is used.
// callModel(system, input, schema, env)
//   input: a string, or a chat history [{ role: "user"|"assistant", content }]
//   with a schema -> { json, usage }   without (null) -> { text, usage }
// Throws on any failure; the caller turns that into status "failed".

const upper = (s) =>
  Array.isArray(s) ? s.map(upper)
  : s && typeof s === "object"
    ? Object.fromEntries(Object.entries(s).map(([k, v]) =>
        [k, k === "type" && typeof v === "string" ? v.toUpperCase() : upper(v)]))
    : s;

const toMessages = (u) => (Array.isArray(u) ? u : [{ role: "user", content: u }]);

// POST with a 60s timeout and one retry when the provider is busy (429/503).
async function post(url, init) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, method: "POST", signal: AbortSignal.timeout(60000) });
    if ((res.status === 429 || res.status === 503) && attempt < 1) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    return res;
  }
}

async function gemini(env, system, input, schema) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.MODEL}:generateContent`;
  const res = await post(url, {
    headers: { "content-type": "application/json", "x-goog-api-key": env.MODEL_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: toMessages(input).map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: schema
        ? { responseMimeType: "application/json", responseSchema: upper(schema), temperature: 0 }
        : { temperature: 0.4 },
    }),
  });
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const d = await res.json();
  const text = d.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!text) throw new Error("gemini: empty answer");
  const usage = { input: d.usageMetadata?.promptTokenCount ?? 0, output: d.usageMetadata?.candidatesTokenCount ?? 0 };
  return schema ? { json: JSON.parse(text), usage } : { text, usage };
}

async function anthropic(env, system, input, schema) {
  const res = await post("https://api.anthropic.com/v1/messages", {
    headers: { "content-type": "application/json", "x-api-key": env.MODEL_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: env.MODEL,
      max_tokens: 1024,
      system,
      messages: toMessages(input),
      ...(schema && {
        tools: [{ name: "answer", description: "Return the structured answer.", input_schema: schema }],
        tool_choice: { type: "tool", name: "answer" },
      }),
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const d = await res.json();
  const usage = { input: d.usage?.input_tokens ?? 0, output: d.usage?.output_tokens ?? 0 };
  if (!schema) {
    const text = d.content?.filter((b) => b.type === "text").map((b) => b.text).join("");
    if (!text) throw new Error("anthropic: empty answer");
    return { text, usage };
  }
  const block = d.content?.find((b) => b.type === "tool_use");
  if (!block) throw new Error("anthropic: no tool_use block");
  return { json: block.input, usage };
}

// OpenRouter (https://openrouter.ai): OpenAI-style chat API. Free models end in ":free".
// Free models don't all support strict JSON schemas, so the schema is also written into the
// prompt and the answer is parsed defensively (code fences removed).
async function openrouter(env, system, input, schema) {
  const sys = schema
    ? `${system}\n\nReply with ONLY a JSON object that matches this JSON schema, no other text:\n${JSON.stringify(schema)}`
    : system;
  const res = await post("https://openrouter.ai/api/v1/chat/completions", {
    headers: { "content-type": "application/json", authorization: `Bearer ${env.MODEL_API_KEY}` },
    body: JSON.stringify({
      model: env.MODEL,
      messages: [{ role: "system", content: sys }, ...toMessages(input)],
      temperature: schema ? 0 : 0.4,
      ...(schema && { response_format: { type: "json_object" } }),
    }),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}`);
  const d = await res.json();
  const text = d.choices?.[0]?.message?.content;
  if (!text) throw new Error("openrouter: empty answer");
  const usage = { input: d.usage?.prompt_tokens ?? 0, output: d.usage?.completion_tokens ?? 0 };
  if (!schema) return { text, usage };
  return { json: JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")), usage };
}

const PROVIDERS = { gemini, anthropic, openrouter };

// MODEL may be one name or a comma-separated list. The models are tried in order:
// if one fails (busy, rate-limited, unreadable answer), the next one is tried.
// The model that answered is returned in usage.model.
export async function callModel(system, input, schema, env) {
  if (!env.MODEL_API_KEY) throw new Error("MODEL_API_KEY missing");
  const run = PROVIDERS[env.MODEL_PROVIDER || "gemini"];
  if (!run) throw new Error(`unknown MODEL_PROVIDER: ${env.MODEL_PROVIDER}`);
  const models = String(env.MODEL || "").split(",").map((m) => m.trim()).filter(Boolean);
  if (!models.length) throw new Error("MODEL missing");
  const errors = [];
  for (const model of models) {
    try {
      const r = await run({ ...env, MODEL: model }, system, input, schema);
      return { ...r, usage: { ...r.usage, model } };
    } catch (err) {
      errors.push(`${model}: ${err.message}`);
      console.error("model failed, trying next:", `${model}: ${err.message}`);
    }
  }
  throw new Error(`all models failed (${errors.join("; ")})`);
}
