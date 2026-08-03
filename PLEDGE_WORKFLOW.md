# New Nest Pledge Fund — Workflow

Friends pledge any amount into one pot. You buy the items yourself.

Two pieces:

- **The page** your friends see — `docs/index.html`, served free at **https://stellassx94.github.io/xjq-new-nest/** from the `stellassx94/xjq-new-nest` repo.
- **The backend** — `apps-script-pledge/`, a Google Apps Script bound to the `Bishan Renovation` spreadsheet. Holds the data, sends the emails.

The page calls the script as a JSON API. The older item-claiming build is untouched in `apps-script/` (git-ignored, local only) — keep it until this one works, then it can go.

## Accounts

Everything here — the spreadsheet, the Apps Script project, the Gmail that sends
the confirmations — belongs to **simsxs@gmail.com**. Any tool or API call must
authenticate as that account. `jiaqisuen11@gmail.com` is a different account and
will fail with what looks like an expired-token error but is not one.

GitHub Pages is served from the `stellassx94` account.

## Source of truth

Spreadsheet: `Bishan Renovation`

It has 30+ tabs from the whole renovation. Only these have anything to do with the pledge page — the **`New Nest — Start Here`** tab (first in the row) links to each of them and shows a live preview of what friends are seeing.

| Tab | What it is | Do you touch it? |
|---|---|---|
| `New Nest — Start Here` | Navigation, plus a live preview of the item list | Read only |
| `Pledges` | Append-only log — one row per pledge. **This is the source of truth.** | Only the `status`, `received_on`, `received_amount_sgd`, `notes` columns |
| `claims_paid_on` / `claimed_amount_sgd` (in `Pledges`) | A friend saying "I've sent it" and how much. Trusted as done; never sets `status` | Read only |
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
| `whatsapp_number` | **Blank — fill this in.** Full international form, e.g. `6591234567`. Switches on the "Message us" button for friends. Anyone with the page link can see it |

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

1. How much has been pledged so far, your headline, and the browse-only item grid. **No target and no progress bar** — this is a gift, not a fundraiser, and a bar implies a share each friend owes.
2. They enter name, email and any amount, plus an optional note.
3. They get the PayNow QR on screen, and the same in an email. **No reference code to copy** — it exists in your sheet but is never asked of them, since you are not matching bank lines.
4. They transfer whenever they like.
5. When they have transferred they tap **"I've sent it"** and confirm the amount. That closes the loop for them — the QR disappears and the row turns green. Nothing waits on you.
6. "Email me my pledge link" sends a private link to a page showing their own pledges, the QR only if still unpaid, and a cancel button. Links last 30 days; requesting a new one re-issues the token.

The page never shows who gave how much — only first names and a count.

## Your routine

**You do not confirm payments. That is deliberate.** PayNow gives individuals no API, webhook or notification — no bank will ever tell this site that money arrived, so confirming would mean you reading a statement line by line. Instead, when a friend taps **"I've sent it"** and says how much, we take their word for it. Their side is finished immediately; nothing waits on you.

That claim lands in `claims_paid_on` and `claimed_amount_sgd`. It **never** sets `status`, so if you ever do want to check a transfer against your bank you still can — set `status` to `Received` and it takes priority. Nothing depends on you doing it.

**Thanking (the only real chore, and it is a nice one).** Two ways:

- **WhatsApp** — the `Thank on WhatsApp` column in `Pledge Dashboard`. One click opens WhatsApp with a message already typed, naming them. Pick the friend, hit send. No phone numbers are stored anywhere.
- **Email** — `New Nest Pledges` → `Send thank-you emails`. Goes to everyone who said they sent it (or that you marked `Received`) and has not been thanked, then stamps `thanked_on` so nobody is thanked twice. ~40 per run, Gmail caps around 100/day.

**Nudging.** Amber rows are people who pledged over a week ago and have not said they sent anything. It is a prompt for a friendly message, not a debt — and plenty of them will simply have forgotten to tap the button.

**Someone changed their mind.** They can cancel from their own link, or you set `status` to `Cancelled`. Cancelled rows drop out of every total but stay in the log.

## Setup

Already done: script pushed and deployed, web app created, `Pledges` / `Pledge Config` / `Pledge Dashboard` tabs created, config filled in, QR hosted, site wired to the backend.

The script is authorized and running. **What is left — things only you can do.**

1. **Fill in two blanks** in `Pledge Config`: `paynow_number` and `paynow_name`. The QR alone works, but showing the number reassures people they are paying the right person.
2. **Rewrite `why_cash` in your own voice.** The current text is a placeholder written by me. It is the warmest thing on the page and it should sound like you.
4. **Fill in `whatsapp_number`** in `Pledge Config` if you want the "Message us" button on the site.
5. **Hide two dead tabs**: right-click `Registry Responses` and `Registry Summary` → Hide sheet. They are leftovers from the old claim-based registry. (No API can hide a tab, so this one is manual.)

Then open https://stellassx94.github.io/xjq-new-nest/, make one test pledge to yourself, check the email arrives, and set that row's `status` to `Cancelled`.

## Changing the code later

Editing `Code.gs` is not enough — Apps Script needs a **new deployment version** (Deploy → Manage deployments → pencil → Version: New version) before the change goes live.

## Why the page is fast now

Apps Script answers in **2–3 seconds** even when its own cache is warm. That is its floor. GitHub Pages answers in **~0.03s**.

So everything that is not money or names is mirrored into `docs/data.json` and served from Pages. The page paints hero, blurb and items almost immediately, then the live API fills in the pledged total and names a couple of seconds later.

**Your sheet edits reach friends immediately regardless** — the live call runs on every page load and overwrites the snapshot. A stale snapshot only affects the first instant of first paint, never what someone ends up seeing.

`docs/data.json` is **generated, never edited by hand.** A GitHub Action refreshes it every 30 minutes and commits only when something actually changed.

**The repo is public**, so the snapshot deliberately contains **no pledged total, no friends' names, no emails, and not your PayNow or WhatsApp numbers** — those are stripped, and the workflow fails rather than publishing them if they ever reappear. It carries only the item list and the page text.

One setup step only you can do: **add the page password as an Actions secret.** Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret** → name `SITE_KEY`, value `xjq-bishan`. Until then the workflow fails with a clear message and the committed snapshot simply stays as it is.

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
| Apps Script `/exec` URL | `https://script.google.com/macros/s/AKfycbylNBW3GEAyJkh4s6nBGQ8pzJyyhcVU1rdUO-iYUPEmGrv-mCRYICOi-MSt0H-QSvEq/exec` |
