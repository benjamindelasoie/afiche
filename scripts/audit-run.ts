/**
 * Post-scrape audit CLI — prints the deterministic audit brief.
 *
 *   npm run db:audit-run          # local
 *   npm run db:audit-run:prod     # Turso
 *
 * Add --json to emit only the machine-readable brief (what the self-healing
 * agent consumes); default also prints a human summary.
 */

import 'dotenv/config';
import { computeAuditBrief } from '@/scrapers/audit';

async function main() {
  const jsonOnly = process.argv.includes('--json');
  const brief = await computeAuditBrief();

  if (jsonOnly) {
    console.log(JSON.stringify(brief, null, 2));
    return;
  }

  console.log(`🩺 Audit · ${process.env.DATABASE_URL ?? '(unset)'}`);
  console.log(`   ${brief.runsConsidered} run(s) in the last 24h\n`);

  if (brief.alerts.length === 0) {
    console.log('— Alerts: none ✨');
  } else {
    console.log(`— Alerts (${brief.alerts.length}):`);
    for (const a of brief.alerts) {
      console.log(`  [${a.kind}] ${a.cinemaId}: ${a.detail}`);
    }
  }

  console.log(`\n— Active-stuck films (${brief.stuckFilms.length}):`);
  for (const f of brief.stuckFilms) {
    const year = f.scrapedYear ?? f.year;
    console.log(
      `  [${f.id}] ${f.scrapedTitle}${year ? ` (${year})` : ''}` +
        (f.venues.length ? ` · ${f.venues.join(', ')}` : ''),
    );
  }

  console.log(`\n${JSON.stringify(brief, null, 2)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ audit-run failed:', err);
    process.exit(1);
  });
