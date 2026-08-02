# Things for the New Nest

A pledge page for a housewarming. Friends pledge any amount they like; we do the shopping.

- **`docs/index.html`** — the public page, served by GitHub Pages.
- **`apps-script-pledge/`** — the backend: a Google Apps Script bound to the `Bishan Renovation` spreadsheet. Stores pledges, sends confirmation / magic-link / thank-you emails, and rebuilds the owner dashboard.
- **`PLEDGE_WORKFLOW.md`** — setup and the day-to-day routine.

The page is static and holds no secrets. PayNow details, the goal and all page copy live in the `Pledge Config` tab of the spreadsheet; pledge data never leaves the Sheet.
