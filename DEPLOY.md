# Deploying Afiche

First-time deploy to Vercel (web) + Turso (DB) + dev-machine cron (daily scrape).
Follow this top to bottom — each step feeds env vars into the next.

> **Note on the scrape cron.** Daily scraping runs from the dev machine via
> `npm run scrape:prod`, NOT from GitHub Actions. Runner IPs get HTTP 403 from
> lumiton.ar (Cloudflare) and complejoteatral.gob.ar (datacenter-IP reputation).
> The GHA workflow is kept around as `workflow_dispatch` only (manual trigger)
> in case we ever put a proxy in front of the scraper. See section 4.

---

## 1. Turso (production database)

Turso is libSQL-as-a-service. Our schema already targets libSQL locally, so no code changes.

```bash
# Install the CLI once
curl -sSfL https://get.tur.so/install.sh | bash

# Sign up / log in (opens browser)
turso auth signup    # or: turso auth login

# Create the prod DB
turso db create afiche

# Grab the URL — save it, you'll need it for Vercel (scrape-prod.sh reads it from .env.prod)
turso db show afiche --url
# → libsql://afiche-<org>.turso.io

# Mint an auth token (don't lose this — you can only see it once)
turso db tokens create afiche
# → eyJhbGciOi...
```

Set up `.env.prod` first (see Section 3 for the full schema), then apply the schema and seed:

```bash
npm run db:migrate:prod
npm run db:seed-cinemas:prod
```

Verify:

```bash
turso db shell afiche "SELECT id, name FROM cinemas;"
# → you should see 7 rows
```

> Note: schema migrations also run automatically on every Vercel deploy (`drizzle-kit migrate && next build` is the build command — see `package.json`). The manual `db:migrate:prod` is for first-time setup or running migrations out-of-band.

### Re-scrape prod from scratch (recovery)

If a scraper bug has poisoned prod with wrong data, wipe the programming
tables (screenings + films + scrape_runs — cinemas/providers stay) and
re-run the scrapers:

```bash
dotenv -e .env.prod -- tsx src/db/reset-programming.ts
npm run scrape:prod
```

For local dev, the shortcut is `npm run db:rescrape` — chains
`db:reset-programming && db:scrape` against `.env.local`.

---

## 2. Vercel (web frontend)

1. Sign up / log in at https://vercel.com
2. **Add New → Project** → import `benjamindelasoie/afiche`
3. Framework preset should auto-detect **Next.js**. Leave build & output defaults.
4. **Environment Variables** — add these four, all for Production + Preview:

   | Name                   | Value                                |
   |------------------------|--------------------------------------|
   | `DATABASE_URL`         | `libsql://afiche-<org>.turso.io`     |
   | `DATABASE_AUTH_TOKEN`  | the Turso token from step 1         |
   | `TMDB_API_TOKEN`       | your v4 Read Access Token           |
   | `REVALIDATE_SECRET`    | `openssl rand -hex 32` → paste      |

5. **Deploy.** First build takes ~2 min. You'll get a URL like `afiche-xyz.vercel.app`.
6. (Optional) **Domains** → add a custom domain if you have one.

Copy the production URL — `scrape-prod.sh` hardcodes it as the revalidate target, so if yours differs from `afiche.vercel.app` you'll want to edit `scripts/scrape-prod.sh:25`.

---

## 3. Dev-machine env files: `.env.local` (dev) + `.env.prod` (prod)

Two files, strictly separated. Both are gitignored.

**`.env.local`** — local dev only. Used by `npm run dev`, `npm run db:migrate`, `npm run db:studio`, `npm run db:scrape`, etc. Never touches Turso.

| Name                | Value                                                          |
|---------------------|----------------------------------------------------------------|
| `DATABASE_URL`      | `file:./local.db` (local SQLite)                               |
| `TMDB_API_TOKEN`    | your v4 Read Access Token                                      |
| `ANTHROPIC_API_KEY` | optional — required only for the Cine Lorca provider. Empty = Lorca stays dormant; rest of the scrape continues normally. Get one at https://console.anthropic.com/. Cost is ~$0.01/scrape. |

**`.env.prod`** — Turso + the Vercel deployment. Used by every `:prod`-suffixed npm script (`db:migrate:prod`, `db:studio:prod`, `db:seed-cinemas:prod`) and by `scripts/scrape-prod.sh`.

| Name                   | Value                                                          |
|------------------------|----------------------------------------------------------------|
| `DATABASE_URL`         | `libsql://afiche-<org>.turso.io`                               |
| `DATABASE_AUTH_TOKEN`  | the Turso token from Section 1                                 |
| `TMDB_API_TOKEN`       | your v4 Read Access Token                                      |
| `REVALIDATE_SECRET`    | same 32-byte hex as Vercel (must match)                        |
| `ANTHROPIC_API_KEY`    | optional — see `.env.local` row above. Same value is fine in both files. |
| `TELEGRAM_BOT_TOKEN`   | optional — for the scheduled-scrape failure alert (`scripts/scrape-cron.sh`). Create a bot via @BotFather → it gives you the token. Empty = no Telegram ping (the local macOS notification still fires). |
| `TELEGRAM_CHAT_ID`     | optional — your Telegram numeric chat id (message @userinfobot to get it, or read it from `https://api.telegram.org/bot<token>/getUpdates` after you DM your bot once). Needed alongside the token. |

The split exists so you cannot accidentally point `db:studio` or `db:scrape` at prod, and so prod operations (`:prod` suffix) are explicit and self-documenting in `package.json`.

> **Note on the Anthropic key.** Vercel does NOT need this — vision is called from the dev-machine scrape script (`npm run scrape:prod`), not from any runtime route. Add to `.env.local` for local dev scrapes, `.env.prod` for the prod scrape. Vercel env vars stay at the original four.

`scrape-prod.sh` reads everything from `.env.prod`. The only hardcoded value is the canonical site URL (`https://afiche.ar` — public, so no harm).

### Scheduled scrape (macOS)

The prod scrape has to run from a residential IP (datacenter IPs get 403'd by Cloudflare at lumiton.ar / complejoteatral.gob.ar), so it runs from your Mac, not CI. To automate it on a laptop that sleeps:

```bash
bash scripts/install-scrape-launchd.sh   # LaunchAgent: 09:00 + 18:00 local, catches up on wake
```

`scripts/scrape-cron.sh` is the wrapper it runs — it resolves node via nvm (launchd's env is bare), skips if a scrape already succeeded in the last 12h, logs to `.scrape-cron.log`, and on failure fires a macOS notification plus (if `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` are set in `.env.prod`) a Telegram message. `launchd` replays a missed run when the Mac wakes from sleep; a full *shutdown's* missed run isn't replayed (boot it and the next run catches up). An always-on box (Mac mini) closes that last gap with no changes. Uninstall: `launchctl bootout gui/$(id -u)/ar.afiche.scrape && rm ~/Library/LaunchAgents/ar.afiche.scrape.plist`.

### GitHub Actions secrets (optional, for the manual-trigger fallback)

The GHA workflow is `workflow_dispatch` only now, but if you want the option of
re-running from the Actions tab (e.g. after putting a proxy in front of the
scraper), set the same secrets at
**Settings → Secrets and variables → Actions**:

| Name                   | Value                                                 |
|------------------------|-------------------------------------------------------|
| `DATABASE_URL`         | `libsql://afiche-<org>.turso.io`                      |
| `DATABASE_AUTH_TOKEN`  | same as dev machine                                   |
| `TMDB_API_TOKEN`       | same                                                  |
| `REVALIDATE_SECRET`    | same                                                  |
| `SITE_URL`             | `https://afiche.vercel.app` (no trailing slash)       |

---

## 4. First scrape (and ongoing refresh)

From the dev machine, once Vercel is deployed and `.env.prod` is in place:

```bash
npm run scrape:prod
```

Expected output:
- `🎞  Scraping against Turso prod...` followed by per-cinema stats
- `🔄 Revalidating https://afiche.vercel.app...` → `✓ Cache revalidated.`
- `Done. Check https://afiche.vercel.app to verify.`

Visit the site. The cartelera should render real data from Turso on next load.

Run this on whatever cadence feels right — daily is fine, the providers haven't
shown meaningful intra-day churn. If you want literal cron, wire it via
`crontab -e` on the dev machine.

**Manual GHA fallback (not currently working — reserved for when a proxy lands):**
Go to **Actions → Scrape cinemas → Run workflow → main → Run**. 4 of 5
providers will currently return 403; use this path only if you've put a proxy
(CF Worker, Vercel Edge, paid residential) in front of the scraper first.

### Manual TMDB patching

Some films don't auto-match against TMDB — usually because TMDB indexes them under a different Spanish title (e.g., "The Straight Story" is "Una historia verdadera" in TMDB, not "Una historia sencilla" as Lugones lists it). For these, the scraper sets `match_source = 'none-attempted'` and won't keep re-querying.

The scraper's tail prints all currently-stuck films:

```
Unenriched films (3) — set films.tmdb_id in Drizzle Studio to link manually, then re-run enrichment:
  [42]  Una historia sencilla  (no year)
  [73]  La ciudad y los perros  (1985)
  ...
```

To patch one:

1. Look up the film on tmdb.org, copy the numeric id from the URL (`tmdb.org/movie/<id>`).
2. `npm run db:studio:prod`. Find the row in `films` (the bracket-id from the report is `films.id`). **Set only `tmdb_id`. Don't change `match_source`.** Save.
3. `npm run db:enrich:prod`. The enrichment pass picks up the row, fetches the TMDB record, and flips `match_source` to `'manual'` (locked from re-search).

> If you also set `match_source='manual'` yourself, the system still picks the row up (as long as `poster_url` is null — the heuristic for "not yet enriched"). Either flow works; the simplest is to leave `match_source` alone.

Faster than re-running the whole `scrape:prod` because it skips every provider's slow fetch.

Alternative for one-off cases: add an entry to `tmdb-overrides.json` (mapped on `scraped_title`, applied to every future row that matches). Use the override file when the same title will recur across scrapes; use Studio patching for one-shot rescues of an existing row.

---

## 5. What to monitor

- **Vercel → Deployments** for build failures on push
- **scrape-prod.sh exit status** on the dev machine; warnings column in `scrape_runs` surfaces provider-level issues
- **Turso → Dashboard** for query / storage usage (free tier is generous)

If a scrape fails, the script exits non-zero and prints the failing step. Re-run
it manually once you've fixed the issue.
