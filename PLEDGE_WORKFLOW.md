# New Nest Pledge Fund — Workflow

Friends pledge any amount into one pot. You buy the items yourself.

Code lives in `apps-script-pledge/`. The older item-claiming build is untouched in `apps-script/` — keep it around until this one is deployed and working, then it can go.

## Source of truth

Spreadsheet: `Bishan Renovation`

| Tab | What it is | Do you touch it? |
|---|---|---|
| `Pledges` | Append-only log — one row per pledge. **This is the source of truth.** | Only the `status`, `received_on`, `received_amount_sgd`, `notes` columns |
| `Pledge Dashboard` | Regenerated owner view: totals at the top, one row per pledge below | Read only — it gets rebuilt |
| `Pledge Config` | Key/value settings for the public page | Yes, this is your control panel |
| `Registry Items` | Feeds the browse-only inspiration grid | Via `Paste Links Here` as before |
| `Paste Links Here` | Paste product URLs, the script scrapes them | Yes |
| `Housewarming/Later Appliances` | Your working item list | Yes |
| `Registry Responses` / `Registry Summary` | Historical, from the old claim-based registry | Ignore |

## Pledge Config

| Key | Notes |
|---|---|
| `goal_sgd` | Drives the progress bar. Set something honest and reachable |
| `paynow_number` | Your PayNow mobile or UEN |
| `paynow_name` | The name that shows in their banking app, so they know the transfer is right |
| `paynow_qr_image_url` | Public `https://` link to your QR image. Blank hides the QR |
| `page_headline` / `page_subtext` | The big title and the warm line under it |
| `suggested_amounts` | Comma-separated preset chips, e.g. `50, 100, 200, 388` |
| `closed` | `TRUE` stops new pledges and shows `closed_message` |
| `thank_you_message` | Optional extra line in thank-you emails |

## What a friend sees

1. Progress bar, your headline, and the browse-only item grid.
2. They enter name, email and any amount, plus an optional note.
3. They get a **reference code** (`NEST-4KQ2`) with the PayNow QR on screen, and the same in an email.
4. They transfer whenever they like, putting the reference code in the PayNow reference field.
5. "Email me my pledge link" sends a private link to a page showing their own pledges, the QR again if unpaid, and a cancel button. Links last 30 days; requesting a new one re-issues the token.

The page never shows who gave how much — only first names and a count.

## Your routine

**Reconciling (the only recurring chore).** Open your bank transaction list, match the reference code in each transfer to the row in `Pledges`, and set `status` to `Received`. Fill `received_amount_sgd` only if they sent a different amount from what they pledged. The dashboard and public progress bar follow automatically.

**Thanking.** `New Nest Registry` → `Send thank-you emails`. It emails everyone marked `Received` who hasn't been thanked yet, then stamps `thanked_on` so nobody gets thanked twice. Gmail caps at ~100 emails/day; it sends 40 per run and tells you how many are left.

**Chasing.** The dashboard highlights anything still `Pledged` after 7 days in amber. There is no auto-nudge — a personal message lands better anyway.

**Someone changed their mind.** They can cancel from their own link, or you set `status` to `Cancelled`. Cancelled rows drop out of every total but stay in the log.

## Setup, once

1. Export your PayNow QR from your banking app. Put it somewhere with a public `https://` URL (Drive shared "anyone with the link", or any image host) and paste that URL into `Pledge Config`.
2. Fill in `goal_sgd`, `paynow_number`, `paynow_name`, and the headline copy.
3. Push `apps-script-pledge/` to the bound Apps Script project (`Code.gs`, `Index.html`, `appsscript.json`).
4. In the spreadsheet: `New Nest Registry` → `Install/refresh automation`. Approve the consent screen — it now also asks to **send email as you**, which is what the confirmations and thank-yous use.
5. Deploy → New deployment → Web app, **Execute as: me**, **Who has access: anyone**. Copy the URL.
6. Open the URL yourself and make one test pledge before sharing it.

## Automation already running

- Installable edit trigger on `Housewarming/Later Appliances` and `Paste Links Here`.
- 15-minute trigger that scrapes new links, syncs items, and rebuilds the dashboard.
- The dashboard also rebuilds after every pledge, cancellation, and thank-you run.

Manual refresh: `New Nest Registry` → `Refresh pledge dashboard`.

## Notes

- Menu and internal functions end with `_` so they cannot be called from the public page. The only public entry points are `getRegistryDataForClient`, `submitPledgeForClient`, `requestPledgeLinkForClient`, `getMyPledgeForClient`, `cancelPledgeForClient`.
- "Email me my pledge link" returns the same message whether or not the address exists, so the page can't be used to check who gave.
- Emails, tokens and reference codes never appear in the public page data.
- Submissions are throttled per email (30s for pledges, 60s for link requests).

## Deployment

Web app URL: _fill in after the first deploy_
