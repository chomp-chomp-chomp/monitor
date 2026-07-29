# monitor

A small, source-agnostic pipeline for polling public regulator filings
reports and surfacing what's new. Currently watches the NLRB's [Recent
Charges and Petitions Filings](https://www.nlrb.gov/reports/graphs-data/recent-filings)
report; built so additional sources are a contained addition (see
[Adding a new source](#adding-a-new-source)).

## How it works

A GitHub Actions workflow (`.github/workflows/monitor.yml`) runs every 4
hours (6x/day) and, for each registered source:

1. Fetches the source's public report (politely — sequential requests with
   a delay between pages, capped page count).
2. Diffs the fetched case numbers against a ledger of previously-seen case
   numbers (`data/seen/<source>.json`), so only genuinely new filings surface.
3. Appends new filings to a daily archive file
   (`data/archive/<source>/<YYYY-MM-DD>.json`), and regenerates a browsable
   HTML archive under `docs/archive/<source>/`.
4. Regenerates the dashboard (`docs/index.html`) — always current, updated
   every run regardless of whether anything new was found. Besides "new this
   check," it shows a **Recently seen** panel (last 25 archived filings,
   with a "view more" link to the last 100) so there's always something to
   look at even on a quiet run. All displayed timestamps are in US Eastern
   time.
5. Sends **one** email (via [Resend](https://resend.com)) only if at least
   one source has new filings — quiet runs send nothing. The email has a
   readable HTML table, a CSV attachment of the new rows, and links back to
   both the source's public report page and the dashboard.
6. Commits and pushes the changed `data/` and `docs/` files back to the
   branch the workflow ran on.

If a source's fetch fails (network error, or the page's structure changed
enough that the parser can't find the filings table), that source's ledger
and archive are left untouched — no data is lost or corrupted — and a
separate failure email is sent. The workflow run itself is also marked
failed, so a failure is never silent even if email delivery is broken too.

### First run per source (bootstrap)

The very first time a source runs, there's no ledger yet, so there's no
sensible "new" to report — everything on the page is, from the monitor's
perspective, pre-existing. That first run seeds the ledger with whatever's
on the first page of results and sends **no** notification, but it *does*
archive those filings (they're real, just not "new" as of right now) so
they show up in "Recently seen" and the archive like anything else. Every
run after that behaves normally. This avoids a first-run email blast of the
site's entire recent history.

## One-time setup

### 1. Repository secrets

Add these under Settings → Secrets and variables → Actions:

| Secret | Purpose |
|---|---|
| `RESEND_API_KEY` | API key from [resend.com](https://resend.com) (free tier: 3,000 emails/mo). |
| `NOTIFY_EMAIL_FROM` | Sender address, e.g. `Filings Monitor <onboarding@resend.dev>`. Without a verified domain in Resend, you're limited to the `onboarding@resend.dev` sender and to sending to the email address on your Resend account. |
| `NOTIFY_EMAIL_TO` | Where notifications go, e.g. `dboman@gmail.com`. |

Optionally, add a repository **variable** (Settings → Secrets and variables →
Actions → Variables tab, not Secrets — it's not sensitive) named
`DASHBOARD_URL` if your Pages URL differs from the default baked into the
workflow (`https://chomp-chomp-chomp.github.io/monitor/`). It's only used to
build the "View dashboard" link in notification emails.

### 2. GitHub Pages

Settings → Pages → Deploy from a branch → select this branch (or `main`,
once merged) and **`/docs`** — not `/ (root)`. This matters: if the source
is left at the repo root, GitHub Pages falls back to rendering `README.md`
as the homepage (since there's no `index.html` there), which looks like the
dashboard is broken when it's actually just misconfigured. The real
dashboard will be live at the resulting `*.github.io` URL (or your custom
domain) once the workflow has run at least once and committed a
`docs/index.html`.

### 3. Merge to the default branch

GitHub only fires the `schedule` trigger for workflow files that live on
the repo's **default branch**. Until this branch is merged, the cron won't
fire on its own — use the "Run workflow" button (Actions tab →
"Filings Monitor" → "Run workflow") to trigger it manually for testing.

## Adding a new source

Everything in `src/core/` (ledger, archive, dashboard, email, CSV) is
generic and works off a plain record shape:

```js
{
  source,       // stable source id, e.g. "nlrb"
  sourceLabel,  // display name, e.g. "NLRB"
  caseName,
  caseNumber,   // must be a stable, unique identifier for diffing
  dateFiled,
  caseType,
  status,
  location,
  region,
  url,          // link to the public case page
}
```

To add a source:

1. Create `src/sources/<id>.js` exporting `id`, `label`, and
   `async function fetchFilings({ seenCaseNumbers })` that returns an array
   of records in the shape above. `seenCaseNumbers` is a `Set` of
   already-known case numbers — use it to stop paginating once you've
   caught up to previously-seen results.
2. Register it in `src/sources/index.js`.

Nothing else changes — diffing, archiving, the dashboard, and email all
pick it up automatically.

## Local development

```bash
npm install
RESEND_API_KEY=... NOTIFY_EMAIL_TO=... NOTIFY_EMAIL_FROM=... npm start
```

Running locally writes to `data/` and `docs/` in your working copy just
like the workflow does — useful for testing a source's parser against the
live site before pushing.
