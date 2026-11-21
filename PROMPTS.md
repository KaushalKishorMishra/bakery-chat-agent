# Prompts used (Session 3 starter)

The prompts from the "Create AI Agents Championship · Session 3" starter (Claude Code on Cloudflare), pasted one at a time. Notes on what was done with each are at the end.

## A. Finish one task

```
Here is my agent brief. Build the smallest version that finishes this one task end to end.

[paste your agent brief]   <- see BRIEF.md

How to build it:
- One Cloudflare Worker. POST /request takes the user's message and returns what happened.
- All model calls go through one file, src/model.js, with one function: callModel(system, userText, schema). It returns the model's JSON answer and the token usage. Support two providers, chosen by the MODEL_PROVIDER setting in wrangler.toml: "gemini" (the default, the Gemini API from Google AI Studio) and "anthropic". The model name goes in the MODEL setting. Nothing else in the code knows which provider is used.
- Read the key from a secret called MODEL_API_KEY. Never write it in the code or in wrangler.toml.
- Facts the agent needs (prices, rules, lists) go in data/facts.json, not in the prompt. The model reads the request and returns structured JSON; the code makes the decisions and does any calculation.
- Every request ends with exactly one status: asked_question, awaiting_approval, handed_over or failed. Return the status with the result.
- If the model call fails or returns something unreadable, the status is failed and the user gets a polite holding message. Never crash.
- Keep it small. No login, no design, no extra features yet.

When you are done, tell me how to run it on my computer and give me one example request to try.
```

## B. The approval step

```
Add the approval step from my brief.
- Save each request in Cloudflare KV (binding ITEMS) with its status, the user's message, the agent's draft and the time. Delete items automatically after 30 days.
- Add GET /inbox: a simple page listing the items awaiting_approval, with Approve, Edit and Cancel.
- Nothing goes to the user until a person presses Approve. Until then the user sees "awaiting approval".
- Enforce this in the code, not in the prompt: there must be no path from the model's answer to the user that skips the inbox.
Tell me the commands to create the KV namespace.
```

## C. A check outside the prompt

```
Add a check I can run myself.
- Create checks.json with four cases from my brief. Each has a name, the message, and the status it should end with:
  1. normal: an everyday request
  2. difficult: missing information, or an unusual request
  3. tool failure: the model is unavailable. When the setting TEST_MODE is "on" and the request has the header X-Test-Fail-Model: 1, the code skips the model and acts as if the call failed. TEST_MODE is set only in .dev.vars, never in wrangler.toml.
  4. permission: the user asks the agent to do something it must not do alone (for example, send without approval, or change a price)
- Add npm run check: it sends each case to a URL (default http://localhost:8787), runs each case 3 times, and prints PASS only when all 3 runs end with the expected status. Print a total at the end.
```

## D. Access, secrets and limits

```
Make it safe to share.
- Protect /inbox with a key stored as the secret INBOX_KEY. Without the right key, /inbox shows nothing.
- Before anything goes to the model, replace phone numbers and email addresses with [phone] and [email].
- Daily limit: stop taking new requests after DAILY_LIMIT requests a day (a setting in wrangler.toml, start at 50) and tell the user to try again tomorrow.
- Limit each message to 2,000 characters.
- Make sure .dev.vars is in .gitignore and no key appears anywhere in the code. Show me a search that proves it.
- Then list, in plain words, what the published agent can do and what it cannot.
```

## E. The cost of one run

```
Record the cost of each run.
- callModel already returns the token usage. Save the input and output tokens with each item.
- Add PRICE_IN and PRICE_OUT settings in wrangler.toml, in USD per million tokens. On a free tier set them to 0 and write the paid price next to them as a comment.
- Show the cost of each item in the inbox, and add GET /inbox/costs (behind the same key) with: runs today, total tokens, total cost, and cost per finished run.
- At the end of npm run check, print the tokens and the cost of the whole check run.
```

## F. Publish: a link or a blocker

```
Help me publish this to a workers.dev link.
- Give me the commands in order: log in, create the KV namespace for the live version, put the secrets MODEL_API_KEY and INBOX_KEY, deploy.
- TEST_MODE must be off in the published version.
- After deploying, run npm run check against the live link and show me the result.
If a step fails, stop and tell me the exact error and what it means, in plain words. Do not try workarounds that change my account settings.
```

## G. A new case

```
On this input: [paste the message], the agent ended with [status] and said [what it said]. My brief says it should [what it should do]. Fix only this. Then add it to checks.json as a new case and run npm run check.
```

## Switching the model later

Change two settings in `wrangler.toml` (`MODEL_PROVIDER`, `MODEL`), then `npx wrangler secret put MODEL_API_KEY`, and run `npm run check` again.

---

## What was done in this project

| Prompt | Status | Notes |
|---|---|---|
| A | Done | Facts are in `data/menu.md` (markdown) instead of `data/facts.json`. Providers: Gemini, Anthropic, OpenRouter (the last replaces the starter's default; free models). `MODEL` may be a comma-separated list, tried in order. |
| B | Done, narrowed | Only **order** requests wait in `/inbox` for Approve, Edit or Cancel; all other questions are answered straight away (enforced in code). |
| C | Done | 5 cases in `checks.json` (order case added); `npm run check` (use `CHECK_ONLY="text"` to run one case). |
| D | Done | `/inbox*` needs `INBOX_KEY` (empty 401 otherwise); phones/emails become `[phone]`/`[email]` before the model and storage; `DAILY_LIMIT` (50); messages over 2,000 characters are rejected; secret search clean. Capabilities list is in README.md. |
| E | Done | Tokens and cost saved per item; `GET /inbox/costs`; `PRICE_IN`/`PRICE_OUT` (0 on free tier). `/inbox/costs` is behind `INBOX_KEY`. |
| F | **Not done yet** | Not published. |
| G | Done | "Order for pickup" reply mentioned calling the shop (no phone exists). Fixed in the system prompt; became the `order` check case (held for approval, and the draft must not say call/phone/email/website/confirmed). |
