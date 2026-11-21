# Agent brief: Bakery chat agent

> Test brief for the Create AI Agents Championship, Session 3. Team Misbah and Mariam are fictional. All data is made up.

## The one task
Answer customers' questions about the bakery's items: what is in them, allergens, how they are made, prices, and opening hours. The answers come only from `data/menu.md`.

## Who uses it
Customers of a small bakery (fictional: "Misbah & Mariam Bakery"), chatting on a web page.

## Where the facts live
`data/menu.md`: items, prices, ingredients, allergens, recipe summaries, opening hours. Edit that file to change what the agent knows. It is never hard-coded in the prompt.

## What the agent decides (the model only classifies and drafts)
Every message gets one classification (`kind`), and the code turns it into a status:

| kind | meaning | status |
|---|---|---|
| `answer` | can answer from the menu | `handed_over` (reply delivered) |
| `ask` | too unclear, needs one clarifying question | `asked_question` |
| `handover` | needs a person: orders, discounts, price changes, complaints, refunds, anything off-topic | `handed_over` |
| (model fails or answer unreadable) | | `failed` + polite holding message |

With `REQUIRE_APPROVAL = "on"`, every draft instead waits in `/inbox` as `awaiting_approval` until a person presses Approve, Edit or Cancel.

## Must never do alone
- Take orders, give discounts or change prices.
- Invent items, prices, ingredients or allergens that are not in `menu.md`.
- Tell customers to call, email or go online (the bakery has no phone, email or website in its info).

## Done when
- A question from the menu comes back with a status and a readable answer.
- `npm run check` passes its cases: normal, difficult (missing info), tool failure (model unavailable), permission (discount / send alone), plus new cases found while testing.

## Known limits
- Free models can be rate-limited (HTTP 429); the agent tries a list of models in order.
- With approval off, a wrong answer is delivered before a person sees it.
