/**
 * Self-heal — Actor 1, Layer 1 (data heal).
 *
 * Runs after a scrape: audit → judge the active-stuck films with the existing
 * SDK judge → auto-apply the corroborated, high-confidence matches to the
 * tmdb_overrides table → queue the rest → Telegram digest → revalidate.
 *
 * Dry-run by default: it judges and prints what WOULD apply vs queue, but
 * writes nothing. `--write` performs the DB writes, sends the digest, and
 * triggers revalidation.
 *
 *   npm run db:self-heal             # dry run, local
 *   npm run db:self-heal -- --write
 *   npm run db:self-heal:prod -- --write
 *
 * The judge is the ONLY model call here (candidate-set judging); no claude -p.
 * The web-research and Layer-2 issue lanes are separate, later work.
 */

import 'dotenv/config';
import { computeAuditBrief, activeStuckFilms } from '@/scrapers/audit';
import {
  buildHealProposals,
  processProposals,
  classifyProposal,
  type HealFilm,
  type CandidateFacts,
} from '@/scrapers/self-heal';
import { searchMovies, getMovie, extractDirectors, hasTmdbToken } from '@/tmdb/client';
import { judgeCandidates } from '@/tmdb/judge';
import { stripSearchNoise } from '@/tmdb/similarity';
import { isNonFilmContainer } from '@/tmdb/container';
import type { AuditAlert } from '@/scrapers/audit';

/** Same multi-query shaping the judge-unmatched script uses. */
async function searchCandidates(f: HealFilm) {
  const year = f.scrapedYear ?? undefined;
  const queries = [f.scrapedTitle];
  if (f.titleOriginal && f.titleOriginal !== f.scrapedTitle)
    queries.push(f.titleOriginal);
  const cleaned = stripSearchNoise(f.scrapedTitle);
  if (cleaned !== f.scrapedTitle) queries.push(cleaned);

  const seen = new Set<number>();
  const out = [];
  for (const q of queries) {
    for (const r of await searchMovies(q, year)) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        out.push(r);
      }
    }
  }
  return out;
}

async function candidateFacts(tmdbId: number): Promise<CandidateFacts> {
  const d = await getMovie(tmdbId);
  return {
    directors: extractDirectors(d),
    year: d?.release_date ? Number(d.release_date.slice(0, 4)) : null,
  };
}

function printAlerts(alerts: AuditAlert[]) {
  if (alerts.length === 0) {
    console.log('— Alerts: none ✨');
    return;
  }
  console.log(`— Alerts (${alerts.length}):`);
  for (const a of alerts) console.log(`  [${a.kind}] ${a.cinemaId}: ${a.detail}`);
}

async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return; // not configured → skip silently, like scrape-cron.sh
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text }),
    });
  } catch (err) {
    console.error('telegram send failed:', err instanceof Error ? err.message : err);
  }
}

async function triggerRevalidate(): Promise<void> {
  const url = process.env.REVALIDATE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!url || !secret) return; // not configured → skip
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-revalidate-secret': secret },
    });
    if (!res.ok) console.error(`revalidate returned ${res.status}`);
  } catch (err) {
    console.error('revalidate failed:', err instanceof Error ? err.message : err);
  }
}

async function main() {
  const write = process.argv.includes('--write');
  if (!hasTmdbToken()) throw new Error('TMDB_API_TOKEN is not set');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');

  const brief = await computeAuditBrief();
  console.log(
    `🩺 Self-heal · ${process.env.DATABASE_URL ?? '(unset)'}` +
      `${write ? '' : '  (dry run — pass --write to apply)'}\n`,
  );
  printAlerts(brief.alerts);

  const stuck: HealFilm[] = (await activeStuckFilms(new Date()))
    .filter((f) => !isNonFilmContainer(f.scrapedTitle))
    .map((f) => ({
      id: f.id,
      scrapedTitle: f.scrapedTitle,
      scrapedYear: f.scrapedYear,
      director: f.director,
      titleOriginal: f.titleOriginal,
    }));

  console.log(`\n— Judging ${stuck.length} active-stuck film(s) (containers excluded)\n`);
  const { proposals, noCandidate, declined } = await buildHealProposals(stuck, {
    searchCandidates,
    judge: judgeCandidates,
  });
  const filmById = new Map(stuck.map((s) => [s.id, s]));

  if (!write) {
    for (const p of proposals) {
      const decision = classifyProposal(
        p,
        filmById.get(p.filmId)?.director ?? null,
        await candidateFacts(p.tmdbId),
      );
      const mark = decision.action === 'auto-apply' ? '✓ APPLY ' : '· queue ';
      const why = decision.action === 'queue' ? ` (${decision.reason})` : '';
      console.log(
        `${mark} ${p.scrapedTitle} → tmdb ${p.tmdbId} conf=${p.confidence.toFixed(2)}${why}`,
      );
    }
    console.log(
      `\n${proposals.length} judged · ${noCandidate.length} no-candidate · ` +
        `${declined.length} declined\nDry run — nothing written.`,
    );
    return;
  }

  const { applied, queued } = await processProposals(proposals, async (p) => ({
    scrapedDirector: filmById.get(p.filmId)?.director ?? null,
    candidate: await candidateFacts(p.tmdbId),
  }));

  const digest =
    `afiche self-heal\n` +
    `applied: ${applied.length} · queued: ${queued.length} · ` +
    `no-candidate: ${noCandidate.length} · alerts: ${brief.alerts.length}\n` +
    applied.map((p) => `✓ ${p.scrapedTitle} → tmdb ${p.tmdbId}`).join('\n') +
    (queued.length
      ? `\nqueue:\n${queued.map((q) => `· ${q.proposal.scrapedTitle} (${q.reason})`).join('\n')}`
      : '') +
    (noCandidate.length
      ? `\nno-candidate:\n${noCandidate.map((f) => `? ${f.scrapedTitle}`).join('\n')}`
      : '') +
    (brief.alerts.length
      ? `\nalerts:\n${brief.alerts.map((a) => `⚠️ ${a.cinemaId}: ${a.kind}`).join('\n')}`
      : '');

  console.log(`\n${digest}`);
  await sendTelegram(digest);
  if (applied.length > 0) await triggerRevalidate();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ self-heal failed:', err);
    process.exit(1);
  });
