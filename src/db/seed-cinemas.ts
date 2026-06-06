/**
 * Prod-safe cinema seed.
 *
 * Inserts (idempotently) the 7 cinemas the scraper needs as foreign-key
 * targets. Does NOT touch films or screenings. Safe to run against Turso
 * or any environment without wiping real data.
 *
 * Run with:  npx tsx src/db/seed-cinemas.ts
 *            (or npm run db:seed-cinemas for local dev)
 *
 * Re-running is a no-op on existing rows (ON CONFLICT DO NOTHING). If you
 * need to correct metadata for an existing cinema (name, address, etc.),
 * do it with a direct SQL UPDATE — this seed won't overwrite.
 */

import 'dotenv/config';
import { db, cinemas, type CinemaInsert } from './index';

const CINEMAS: CinemaInsert[] = [
  {
    id: 'lugones',
    name: 'Sala Leopoldo Lugones',
    neighborhood: 'San Nicolás',
    type: 'indie',
    address: 'Av. Corrientes 1530 · Teatro San Martín',
    ticketingBaseUrl: 'https://complejoteatral.gob.ar',
  },
  {
    id: 'malba',
    name: 'MALBA',
    neighborhood: 'Palermo',
    type: 'indie',
    address: 'Av. Figueroa Alcorta 3415',
    ticketingBaseUrl: 'https://malba.org.ar/cine',
  },
  {
    id: 'lorca',
    name: 'Cine Lorca',
    neighborhood: 'San Nicolás',
    type: 'indie',
    address: 'Av. Corrientes 1428',
    ticketingBaseUrl: 'https://cinelorca.wixsite.com/cine-lorca',
  },
  {
    id: 'cinepolis-recoleta',
    name: 'Cinépolis Recoleta',
    neighborhood: 'Recoleta',
    type: 'chain',
    address: 'Arenales 2400',
    ticketingBaseUrl: 'https://cinepolis.com.ar',
  },
  {
    id: 'cine-york',
    name: 'Cine York',
    neighborhood: 'Olivos',
    type: 'indie',
    address: 'Juan Bautista Alberdi 895, Olivos',
    ticketingBaseUrl: 'https://lumiton.ar',
  },
  {
    id: 'centro-cultural-munro',
    name: 'Centro Cultural Munro',
    neighborhood: 'Munro',
    type: 'indie',
    address: 'Vélez Sarsfield 4650, Munro',
    ticketingBaseUrl: 'https://lumiton.ar',
  },
  {
    id: 'lumiton',
    name: 'Lumiton',
    neighborhood: 'Munro',
    type: 'indie',
    address: 'Sargento Juan Bautista Cabral 2354, Munro',
    ticketingBaseUrl: 'https://lumiton.ar',
  },
  {
    id: 'cine-cosmos',
    name: 'Cine Cosmos',
    neighborhood: 'Balvanera',
    type: 'indie',
    address: 'Av. Corrientes 2046',
    ticketingBaseUrl: 'https://www.cinecosmos.uba.ar',
  },
  {
    id: 'cacodelphia',
    name: 'CineArte Cacodelphia',
    neighborhood: 'San Nicolás',
    type: 'indie',
    address: 'Roque Sáenz Peña 1150',
    ticketingBaseUrl: 'https://cineartecacodelphia.com.ar',
  },
  {
    id: 'cine-gaumont',
    name: 'Cine Gaumont',
    neighborhood: 'San Nicolás',
    type: 'indie',
    address: 'Av. Rivadavia 1635',
    ticketingBaseUrl: 'https://www.cinegaumont.ar',
  },
  {
    id: 'centro-cultural-borges',
    name: 'Centro Cultural Borges',
    neighborhood: 'San Nicolás',
    type: 'indie',
    address: 'Viamonte 525',
    ticketingBaseUrl: 'https://centroculturalborges.gob.ar',
  },
];

async function seedCinemas() {
  console.log(`🌱 Upserting ${CINEMAS.length} cinemas...`);

  await db.insert(cinemas).values(CINEMAS).onConflictDoNothing();

  const rows = await db.select().from(cinemas);
  console.log(`✅ Done. ${rows.length} cinemas in DB:`);
  for (const c of rows) console.log(`   - ${c.id}  ${c.name}`);
}

seedCinemas()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ seed-cinemas failed:', err);
    process.exit(1);
  });
