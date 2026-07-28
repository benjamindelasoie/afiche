/**
 * Cartelera freshness check — alert on a scrape that never happened.
 *
 * Why this exists on VERCEL rather than on the scrape host: the failure it
 * watches for is that host being asleep. Over a week in July 2026 it never
 * woke, `scrape-cron.sh` never executed, and the site served week-old
 * showtimes with nothing to signal it. `scrape-cron.sh` pings on a FAILED
 * scrape, which is the case that self-corrects; it is structurally incapable
 * of noticing a scrape that never ran, because no code runs.
 *
 * Vercel is always up and can read the same prod DB, so the check lives here.
 * The freshness signal already exists — `scrape_runs.finished_at` for the most
 * recent successful run, the same value the site footer renders as
 * "actualizado el …".
 *
 * Behaviour: GET always reports the current freshness. It only *alerts* when
 * fully configured. Safe to call repeatedly — Vercel cron is at-least-once,
 * and a duplicate ping is a far smaller problem than a missed one, so there is
 * deliberately no dedupe.
 *
 * DORMANT BY DEFAULT. Alerting is opt-in and an unconfigured deploy is quiet,
 * not broken: the daily cron returns 200 with `alerting: 'disabled'` and an
 * explicit reason. Erroring instead would paint the Vercel dashboard red every
 * day for a feature nobody switched on — noise that trains you to ignore this
 * endpoint, which is the opposite of the point.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`, which Vercel sends automatically
 * on cron invocations. When CRON_SECRET is SET the token is enforced (401 on
 * mismatch). When it is unset the endpoint is readable but can never alert —
 * that combination is what closes the abuse vector, since the only side effect
 * worth protecting is the Telegram send. The payload itself is not sensitive:
 * the site footer already publishes the last-updated time to every visitor.
 */

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getLastScrapeTime } from '@/db/queries';

/**
 * Hours before a cartelera is considered stale. The scrape is scheduled twice
 * daily, so 26h means "we have missed more than a full day" — long enough that
 * a single skipped run or a late catch-up on wake does not page, short enough
 * that nobody browses a week-old cartelera unaware.
 */
const DEFAULT_STALE_HOURS = 26;

export const dynamic = 'force-dynamic';

function secretsMatch(provided: string | null, expected: string): boolean {
  if (provided === null) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function notifyTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    return res.ok;
  } catch {
    // An alerting failure must not turn into a 500 — the caller still wants
    // the freshness verdict, and Vercel logs carry the detail.
    return false;
  }
}

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  const provided = req.headers.get('authorization');
  const token = provided?.startsWith('Bearer ') ? provided.slice(7) : null;

  // Enforce the token only when one is configured. A wrong token against a
  // configured deploy is a real error and still 401s.
  if (expected && !secretsMatch(token, expected)) {
    return NextResponse.json({ error: 'invalid secret' }, { status: 401 });
  }

  // Alerting requires BOTH an authenticated call and Telegram credentials.
  // Missing either is a dormant state, reported plainly rather than raised.
  const telegramReady = Boolean(
    process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID,
  );
  const alertingDisabledReason = !expected
    ? 'CRON_SECRET not set'
    : !telegramReady
      ? 'Telegram not configured'
      : null;

  const staleHours = Number(process.env.AFICHE_STALE_HOURS ?? DEFAULT_STALE_HOURS);
  const lastScrapeAt = await getLastScrapeTime();
  const now = Date.now();

  // No successful run on record at all — a fresh deploy, or the scrape has
  // never worked. Either way it is not fresh, and silence would be wrong.
  const ageHours =
    lastScrapeAt === null ? null : (now - lastScrapeAt.getTime()) / 3_600_000;
  const stale = ageHours === null || ageHours > staleHours;

  let alerted = false;
  if (stale && alertingDisabledReason === null) {
    const detail =
      ageHours === null
        ? 'no successful scrape on record'
        : `last success ${ageHours.toFixed(1)}h ago (threshold ${staleHours}h)`;
    alerted = await notifyTelegram(
      `⚠️ afiche: la cartelera está desactualizada — ${detail}. ` +
        'Revisá el scrape host y su .scrape-cron.log.',
    );
  }

  return NextResponse.json({
    lastScrapeAt: lastScrapeAt?.toISOString() ?? null,
    ageHours: ageHours === null ? null : Number(ageHours.toFixed(2)),
    staleHours,
    stale,
    alerting: alertingDisabledReason === null ? 'enabled' : 'disabled',
    // Present only while dormant, so `curl` tells you what is missing.
    ...(alertingDisabledReason ? { alertingDisabledReason } : {}),
    alerted,
  });
}
