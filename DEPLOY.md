# Deploying Afiche

First-time deploy to Vercel (web) + Turso (DB) + GitHub Actions (daily scrape).
Follow this top to bottom — each step feeds env vars into the next.

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

# Grab the URL — save it, you'll need it for Vercel + GHA
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
DATABASE_URL='libsql://afiche-<org>.turso.io' \
DATABASE_AUTH_TOKEN='<token>' \
  npx drizzle-kit migrate

# Seed the cinemas table
DATABASE_URL='libsql://afiche-<org>.turso.io' \
DATABASE_AUTH_TOKEN='<token>' \
  npx tsx src/db/seed.ts
```

Verify:

```bash
turso db shell afiche "SELECT id, name FROM cinemas;"
# → you should see 5 rows
```

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

Copy the production URL — you'll need it for the GHA scraper webhook.

---

## 3. GitHub Actions secrets (for daily scraping)

Open https://github.com/benjamindelasoie/afiche → **Settings → Secrets and variables → Actions → New repository secret**. Add:

| Name                   | Value                                                 |
|------------------------|-------------------------------------------------------|
| `DATABASE_URL`         | same as Vercel                                        |
| `DATABASE_AUTH_TOKEN`  | same as Vercel                                        |
| `TMDB_API_TOKEN`       | same as Vercel                                        |
| `REVALIDATE_SECRET`    | same as Vercel (they must match)                      |
| `SITE_URL`             | `https://afiche-xyz.vercel.app` (no trailing slash)   |

---

## 4. First scrape

The schedule is `0 8 * * *` (daily 08:00 UTC = 05:00 BA). To run it immediately:

1. Go to **Actions → Scrape cinemas**
2. Click **Run workflow** → `main` → **Run**
3. Watch the run. Expected:
   - `Run scraper against Turso` logs per-cinema stats
   - `Revalidate week-view cache` returns `{ "revalidated": true, "path": "/" }`
4. Visit the site. The week view should render real data from Turso.

---

## 5. What to monitor

- **Vercel → Deployments** for build failures on push
- **GitHub Actions → Scrape cinemas** for daily scrape health (warnings column in `scrape_runs` will surface provider-level issues)
- **Turso → Dashboard** for query / storage usage (free tier is generous)

If a scrape fails, the workflow fails loudly. You can re-run it from the Actions tab without waiting for the next cron.
