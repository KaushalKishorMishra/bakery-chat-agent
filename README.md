# Bakery chat agent

A small chat agent for a (fictional) bakery. It answers questions about items, ingredients, allergens, prices and opening hours using only `data/menu.md`. Built as one Cloudflare Worker for the Create AI Agents Championship, Session 3. All data is made up.

- Task and rules: [BRIEF.md](BRIEF.md)
- Prompts used to build it: [PROMPTS.md](PROMPTS.md)

## Run it locally

```bash
npm install
cp .dev.vars.example .dev.vars   # then put your key in .dev.vars (never commit it)
npx wrangler dev
```

Open http://localhost:8787 to chat. Or call the API:

```bash
curl -s -XPOST localhost:8787/request -d '{"message":"What is in the croissant and does it have dairy?"}'
```

## Settings (`wrangler.toml`)

| Setting | Meaning |
|---|---|
| `MODEL_PROVIDER` | `openrouter`, `gemini` or `anthropic` |
| `MODEL` | model name, or a comma-separated list tried in order (fallback when one fails) |
| `REQUIRE_APPROVAL` | `on`: replies wait in `/inbox` for a person; `off`: sent straight away |
| `PRICE_IN`, `PRICE_OUT` | USD per million tokens (0 on a free tier) |

The key is a secret named `MODEL_API_KEY` (in `.dev.vars` locally, `wrangler secret put` when live). `TEST_MODE=on` lives only in `.dev.vars`.

## Checks

```bash
npm run check                       # 3 runs of every case in checks.json
CHECK_ONLY="new case" npm run check # one case
```

## Endpoints

- `GET /` chat page
- `POST /request` `{"message": "..."}` returns `{status, reply}`
- `GET /request/:id` status of a request
- `GET /inbox`, `GET /inbox/costs` for approval and cost totals (**not protected yet**, see PROMPTS.md prompt D)

## Not done yet

Access key for `/inbox`, personal-data filter, daily limit (prompt D), and publishing (prompt F).
