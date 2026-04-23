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

# Grab the URL — save it, you'll need it for Vercel (and scrape-prod.sh hardcodes it)
turso db show afiche --url
# → libsql://afiche-<org>.turso.io

# Mint an auth token (don't lose this — you can only see it once)
turso db tokens create afiche
# → eyJhbGciOi...
```

Apply the schema to the fresh DB:

```bash
# Temporarily point .env.local at Turso to run migrations
# (Keep the file local. Don't commit this change.)
DATABASE_URL='libsql://afiche-benjamindelasoie.aws-us-east-1.turso.io' \
DATABASE_AUTH_TOKEN='<token>' \
  npx drizzle-kit migrate

# Seed the cinemas table (prod-safe: ON CONFLICT DO NOTHING, no films/screenings).
DATABASE_URL='libsql://afiche-benjamindelasoie.aws-us-east-1.turso.io' \
DATABASE_AUTH_TOKEN='<token>' \
  npx tsx src/db/seed-cinemas.ts
```

Verify:

```bash
turso db shell afiche "SELECT id, name FROM cinemas;"
# → you should see 7 rows
```

### Re-scrape prod from scratch (recovery)

If a scraper bug has poisoned prod with wrong data, wipe the programming
tables (screenings + films + scrape_runs — cinemas/providers stay) and
re-run the scrapers:

```bash
DATABASE_URL='libsql://afiche-benjamindelasoie.aws-us-east-1.turso.io' \
DATABASE_AUTH_TOKEN='<token>' \
  npx tsx src/db/reset-programming.ts

DATABASE_URL='libsql://afiche-benjamindelasoie.aws-us-east-1.turso.io' \
DATABASE_AUTH_TOKEN='<token>' \
  npx tsx src/scrapers/run.ts
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

## 3. Dev-machine .env.local (the prod scrape path)

Daily scraping runs from your dev machine via `npm run scrape:prod`. That wraps
`scripts/scrape-prod.sh`, which sources `.env.local` and overrides `DATABASE_URL`
to the Turso prod endpoint for just that run.

Add these to `.env.local` alongside the dev values you already have:

| Name                   | Value                                                 |
|------------------------|-------------------------------------------------------|
| `DATABASE_URL`         | `file:./local.db` — leave pointing at local SQLite for dev |
| `DATABASE_AUTH_TOKEN`  | Turso token from step 1 (used only by scrape-prod.sh) |
| `TMDB_API_TOKEN`       | your v4 Read Access Token                             |
| `REVALIDATE_SECRET`    | same 32-byte hex as Vercel (must match)               |

`scrape-prod.sh` hardcodes the production Turso URL and the Vercel site URL
(both public), then pulls `DATABASE_AUTH_TOKEN`, `TMDB_API_TOKEN`, and
`REVALIDATE_SECRET` from `.env.local`. It fails loudly if any secret is missing
rather than running with a broken token.

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

From the dev machine, once Vercel is deployed and `.env.local` has the Turso
token:

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

---

## 5. What to monitor

- **Vercel → Deployments** for build failures on push
- **scrape-prod.sh exit status** on the dev machine; warnings column in `scrape_runs` surfaces provider-level issues
- **Turso → Dashboard** for query / storage usage (free tier is generous)

If a scrape fails, the script exits non-zero and prints the failing step. Re-run
it manually once you've fixed the issue.
