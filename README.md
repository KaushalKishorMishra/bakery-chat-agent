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
| `DAILY_LIMIT` | new requests allowed per day (UTC); then users are told to try again tomorrow |
| `PRICE_IN`, `PRICE_OUT` | USD per million tokens (0 on a free tier) |

Secrets (in `.dev.vars` locally, `wrangler secret put` when live): `MODEL_API_KEY` and `INBOX_KEY`. `TEST_MODE=on` lives only in `.dev.vars` (never in `wrangler.toml`). For local checks set `DAILY_LIMIT=1000` in `.dev.vars`, because each `npm run check` sends about 15 requests.

## Checks

```bash
npm run check                       # 3 runs of every case in checks.json
CHECK_ONLY="new case" npm run check # one case
```

## Endpoints

- `GET /` chat page
- `POST /request` `{"message": "..."}` returns `{status, reply}`
- `GET /request/:id` status of a request
- `GET /inbox?key=<INBOX_KEY>` orders waiting for a person (Approve, Edit, Cancel); `GET /inbox/costs?key=...` runs, tokens and cost. Without the right key every `/inbox` call returns an empty 401.

## What the agent can and cannot do

**Can**
- Answer questions about items, ingredients, allergens, prices and opening hours, from `data/menu.md` only.
- Ask one clarifying question when a message is too vague.
- Draft a reply to an order request; a person must press Approve before the customer sees it.
- Answer in the customer's language.

**Cannot**
- Confirm an order, give a total, promise a pickup time, give discounts or change prices.
- Take payments, send email or texts, or contact anyone outside the chat.
- Know anything that is not in `menu.md` (it should say so and point to the shop).
- See phone numbers or email addresses: they are replaced with `[phone]` / `[email]` before the model and before saving.
- Read messages over 2,000 characters, or serve more than `DAILY_LIMIT` new requests a day.
- Show the inbox, drafts or costs to anyone without `INBOX_KEY`.

Free models can still be wrong or rate-limited, and questions are answered without human review.

## Not done yet

Publishing (prompt F).
