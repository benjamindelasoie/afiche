/**
 * One-off corrective: fix venue addresses that disagreed with the venues' own
 * sites (verified 2026-06-04 against lumiton.ar). The prod-safe seed
 * (seed-cinemas.ts) uses ON CONFLICT DO NOTHING, so it can't update existing
 * rows — this targeted UPDATE does. Idempotent: re-running just re-sets the
 * same values. Only touches the rows/columns listed below.
 *
 * Run with:  npm run db:fix-cinema-addresses        (local)
 *            npm run db:fix-cinema-addresses:prod    (Turso)
 *
 * Once applied to local + prod this script can be deleted.
 */

import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db, cinemas } from './index';

const FIXES: { id: string; neighborhood?: string; address: string }[] = [
  // Was "Alberdi 895, Olivos" — full street name per the source.
  { id: 'cine-york', address: 'Juan Bautista Alberdi 895, Olivos' },
  // Was "Av. Mitre 4155, Munro" — Lumiton lists screenings at Vélez Sarsfield.
  { id: 'centro-cultural-munro', address: 'Vélez Sarsfield 4650, Munro' },
  // Was "Av. del Libertador 800, Vicente López" — it's the Museo Lumiton, the
  // Casa de las Estrellas in Munro.
  {
    id: 'lumiton',
    neighborhood: 'Munro',
    address: 'Sargento Juan Bautista Cabral 2354, Munro',
  },
];

async function fixAddresses() {
  console.log(`🔧 Correcting ${FIXES.length} cinema addresses...`);

  for (const fix of FIXES) {
    const set: { address: string; neighborhood?: string } = {
      address: fix.address,
    };
    if (fix.neighborhood) set.neighborhood = fix.neighborhood;
    await db.update(cinemas).set(set).where(eq(cinemas.id, fix.id));
    console.log(`   ✓ ${fix.id} → ${fix.address}`);
  }

  const rows = await db
    .select({
      id: cinemas.id,
      neighborhood: cinemas.neighborhood,
      address: cinemas.address,
    })
    .from(cinemas);
  console.log('✅ Done. Current venue addresses:');
  for (const c of rows) console.log(`   - ${c.id}  ${c.neighborhood}  ${c.address}`);
}

fixAddresses()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ fix-cinema-addresses failed:', err);
    process.exit(1);
  });
