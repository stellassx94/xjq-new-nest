# New Nest Pledge Fund — Workflow

Friends pledge any amount into one pot. You buy the items yourself.

Two pieces:

- **The page** your friends see — `docs/index.html`, served free at **https://stellassx94.github.io/xjq-new-nest/** from the `stellassx94/xjq-new-nest` repo.
- **The backend** — `apps-script-pledge/`, a Google Apps Script bound to the `Bishan Renovation` spreadsheet. Holds the data, sends the emails.

The page calls the script as a JSON API. The older item-claiming build is untouched in `apps-script/` (git-ignored, local only) — keep it until this one works, then it can go.

## Source of truth

Spreadsheet: `Bishan Renovation`

| Tab | What it is | Do you touch it? |
|---|---|---|
| `Pledges` | Append-only log — one row per pledge. **This is the source of truth.** | Only the `status`, `received_on`, `received_amount_sgd`, `notes` columns |
| `claims_paid_on` (in `Pledges`) | A friend saying "I've sent it". A claim, never a confirmation — it never sets `status` | Read only |
| `Pledge Dashboard` | **Formulas.** Totals at the top, one row per pledge below, all live | Read only — but safe to add your own columns to the right |
| `Pledge Config` | Key/value settings for the public page | Yes, this is your control panel |
| `Registry Items` | **Controls the "What it goes toward" section.** Nothing else feeds it | Yes — see the column table below |
| `Paste Links Here` | Paste product URLs, the script scrapes them | Yes |
| `Housewarming/Later Appliances` | Your working item list | Yes |
| `Registry Responses` / `Registry Summary` | Historical, from the old claim-based registry | Ignore |

## Pledge Config

| Key | Notes |
|---|---|
| `paynow_number` | Your PayNow mobile or UEN |
| `paynow_name` | The name that shows in their banking app, so they know the transfer is right |
| `paynow_qr_image_url` | Public `https://` link to your QR image. Blank hides the QR |
| `page_headline` / `page_subtext` | The big title and the warm line under it |
| `suggested_amounts` | Comma-separated preset chips, e.g. `50, 100, 200, 388` |
| `site_url` | `https://stellassx94.github.io/xjq-new-nest/` — magic links in emails point here |
| `couple_names` | "Stella & Jia Qi", shown above the headline |
| `hero_photo_url` | Optional photo of the two of you |
| `why_cash` | One or two sentences in your own voice. **Worth editing** — this is the warmest thing on the page |
| `site_password` | `xjq-bishan`. The link you share carries it, so friends never see a login |
| `closed` | `TRUE` stops new pledges and shows `closed_message` |
| `thank_you_message` | Optional extra line in thank-you emails |

## Controlling the item section

Every item on the page is one row in `Registry Items`. These are the only columns that change what friends see:

| You want to | Edit |
|---|---|
| Change the title shown | `display_name` (falls back to `scraped_title`) |
| Change the blurb under it | `description` (falls back to `remarks`) |
| Change the room label | `category` |
| Use a better photo | `display_image` — overrides the scraped one |
| Change where the card links to | `source_link`. Blank means the card is not clickable |
| Reorder the page | `sort_order`, ascending |
| Hide an item | `status` = `hidden` / `archived` / `draft`, or `active` = `FALSE` |

**It syncs, with about a minute of lag.** The script caches the public data for 60 seconds and the browser shows its last copy first. Edit a cell, wait a minute, hard-refresh.

Prices are stored but deliberately **not shown** on the page — for the same reason there is no target.

## What a friend sees

1. Progress bar, your headline, and the browse-only item grid.
2. They enter name, email and any amount, plus an optional note.
3. They get a **reference code** (`NEST-4KQ2`) with the PayNow QR on screen, and the same in an email.
4. They transfer whenever they like, putting the reference code in the PayNow reference field.
5. "Email me my pledge link" sends a private link to a page showing their own pledges, the QR again if unpaid, and a cancel button. Links last 30 days; requesting a new one re-issues the token.

The page never shows who gave how much — only first names and a count.

## Your routine

**Reconciling (the only recurring chore).** Open your bank transaction list, match the reference code in each transfer to the row in `Pledges`, and set `status` to `Received`. Fill `received_amount_sgd` only if they sent a different amount from what they pledged. The dashboard follows automatically.

**Thanking.** `New Nest Pledges` → `Send thank-you emails`. It emails everyone marked `Received` who hasn't been thanked yet, then stamps `thanked_on` so nobody gets thanked twice. Gmail caps at ~100 emails/day; it sends 40 per run and tells you how many are left.

**Chasing.** The dashboard highlights anything still `Pledged` after 7 days in amber. There is no auto-nudge — a personal message lands better anyway.

**Someone changed their mind.** They can cancel from their own link, or you set `status` to `Cancelled`. Cancelled rows drop out of every total but stay in the log.

## Setup

Already done: script pushed and deployed, web app created, `Pledges` / `Pledge Config` / `Pledge Dashboard` tabs created, config filled in, QR hosted, site wired to the backend.

**What is left — two things only you can do.**

1. **Authorize the script.** Open the [script editor](https://script.google.com/d/1B8TpQGt6mKAqHN6p4PaHR2mlcmikSNAUVdUOftFQtAgwJ-d-0sXjKI1J/edit), pick `setupPledgeSheets_` from the function dropdown, hit **Run**, and click through the consent screen. It asks for this spreadsheet and to **send email as you** — that is the confirmation and thank-you mail. Google cannot grant a script its own permissions over an API; it needs your click.

   Until this is done the site shows "Could not load the page" and the `/exec` URL returns *Access denied*.

2. **Fill in two blanks** in `Pledge Config`: `paynow_number` and `paynow_name`. The QR alone works, but showing the number reassures people they are paying the right person.

Then open https://stellassx94.github.io/xjq-new-nest/, make one test pledge to yourself, check the email arrives, and set that row's `status` to `Cancelled`.

## Changing the code later

Editing `Code.gs` is not enough — Apps Script needs a **new deployment version** (Deploy → Manage deployments → pencil → Version: New version) before the change goes live.

## Changing the page later

Edit `docs/index.html`, then:

```
git add -A && git commit -m "..." && git push
```

Live in about a minute. No Apps Script deploy needed for page-only changes.

## Automation

The pledge script has no triggers, and the dashboard needs none: it is built from formulas, so it updates the instant anything changes — including when **you** edit a status by hand, which no script would ever see.

If the dashboard ever looks broken (someone deletes a formula cell), `New Nest Pledges` → `Reinstall dashboard formulas` puts it back.

Item scraping still belongs to the **older** registry script bound to the same spreadsheet — its edit trigger and 15-minute trigger keep `Registry Items` fresh. The pledge script only reads that tab, and shrugs off failures there so the pledge form keeps working regardless.


## Notes

- Menu and internal functions end with `_` so they cannot be called from the public page. The only public entry points are `getRegistryDataForClient`, `submitPledgeForClient`, `requestPledgeLinkForClient`, `getMyPledgeForClient`, `cancelPledgeForClient`.
- "Email me my pledge link" returns the same message whether or not the address exists, so the page can't be used to check who gave.
- Emails, tokens and reference codes never appear in the public page data.
- Neither does how much has actually been **received**. Friends see one pledged total; the received/outstanding split stays in your sheet.
- Submissions are throttled per email (30s for pledges, 60s for link requests).

## Addresses

| | |
|---|---|
| Share this with friends | https://stellassx94.github.io/xjq-new-nest/?k=xjq-bishan |
| Your dashboard, one tap | https://stellassx94.github.io/xjq-new-nest/sheet |
| Repo | https://github.com/stellassx94/xjq-new-nest |
| Spreadsheet | [Bishan Renovation](https://docs.google.com/spreadsheets/d/19fARddBTHQLFfhmUdToxM69infZVPKKr61WsL7gv65o/edit) |
| Script editor | [New Nest Pledge Fund](https://script.google.com/d/1B8TpQGt6mKAqHN6p4PaHR2mlcmikSNAUVdUOftFQtAgwJ-d-0sXjKI1J/edit) |
| Apps Script `/exec` URL | `https://script.google.com/macros/s/AKfycbymXJtIBFhLRBfiLC6eM-hJlnKU-muSIxBfzHIfbBlo5TP_qFJrdKdZeT8HDj-5Ghpl/exec` |
