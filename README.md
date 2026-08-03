# Things for the New Nest

A pledge page for a housewarming. Friends pledge any amount they like; we do the shopping.

- **`docs/index.html`** — the public page, served by GitHub Pages.
- **`apps-script-pledge/`** — the backend: a Google Apps Script bound to the `Bishan Renovation` spreadsheet. Stores pledges, sends confirmation / magic-link / thank-you emails, and rebuilds the owner dashboard.
- **`PLEDGE_WORKFLOW.md`** — setup and the day-to-day routine.

The page is static and holds no secrets. PayNow details, the goal and all page copy live in the `Pledge Config` tab of the spreadsheet; pledge data never leaves the Sheet.

## The rule for this page: the interface never waits on the server

**Every action a friend takes must land on screen immediately.** Pledging, changing an amount, tapping "I've sent it", cancelling — the row updates the instant the button is pressed. The network call happens behind it.

This is not a preference, it is forced by the backend. Apps Script takes **2–3 seconds to answer at its floor**, warm cache and all; measured repeatedly, it has never been faster. Anything built to wait for it feels broken, because three seconds of a dead button *is* broken.

So:

- **Apply the change to local state first, render, then call the API.** Never the other way round.
- **Never make the user wait for a second round trip.** A write already returns the updated row — use it. Do not re-fetch to find out what you were just told. This is what made a pledge sit at "Saving…" for six to nine seconds: the POST answered in three, then the code waited for a fresh `registry` call to notice.
- **Never leave a slot empty while checking.** A device that has pledged before shows a placeholder, not the "Pledged already?" panel. Showing someone the stranger state and then correcting it reads as a bug, not as loading.
- **Anything public and non-private is served from `docs/data.json`**, not the API — same CDN as the page, ~30ms.
- **The shared total moves with the local change too.** It was the last thing still waiting: the backend memoises the public payload for 60s, and a request already in flight can repopulate that cache from a read taken *before* the write. So a friend saw their own S$6,000 pledge above a total that did not contain it. `adjustTotals()` moves the headline figure and the item coverage immediately; `loadRegistry` still wins a moment later.
- **No `window.prompt` / `confirm` for anything with a value in it.** A system dialog arrives empty, cannot show the current amount, cannot be styled, and blocks the page. Amounts are edited inline, prefilled. "I've sent it" is one tap at the pledged amount — it used to ask how much, which is a question they had already answered.

### Failure is not the same as rejection

The two must never be conflated, and conflating them was a real data-loss bug.

- **`ok: false`** — the server ran and refused. Roll the optimistic change back.
- **A thrown error** (network, timeout, unparseable body) — we have no idea whether the write landed. **Do not roll back and do not retry.** Keep the optimistic state and tell the user it could not be confirmed.

Rolling back on a thrown error is what made a successful pledge disappear from the page while sitting in the sheet.

### Why `.json()` is never called directly

Apps Script answers a POST with a 302 to a one-shot `script.googleusercontent.com` URL. That second hop **intermittently serves Google's own HTML error page** instead of our JSON, which surfaced to the user as `Unexpected token '<'`. All calls go through `fetchJson`, which reads text, parses it itself, and has a 20s timeout.

**Reads retry once. Writes never retry** — a failed second hop says nothing about whether the script ran, and the per-email throttle would answer a quick retry with "too fast", which the caller would misread as a rejection.
