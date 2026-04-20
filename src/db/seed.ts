/**
 * Seed the local DB with sample cinemas, films, and screenings.
 *
 * Run with:  npm run db:seed
 *
 * Safe to re-run: clears all tables first, then inserts fresh rows.
 * DO NOT run this against a production DB.
 */

import 'dotenv/config';
import { db, cinemas, films, screenings } from './index';

async function seed() {
  console.log('🌱 Seeding Afiche local DB...\n');

  // Clear existing data (safe on local; would be destructive on prod).
  console.log('Clearing existing rows...');
  await db.delete(screenings);
  await db.delete(films);
  await db.delete(cinemas);

  // --- Cinemas ---
  console.log('Inserting cinemas...');
  await db.insert(cinemas).values([
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
      ticketingBaseUrl: 'https://cinelorca.com.ar',
    },
    {
      id: 'cinepolis-recoleta',
      name: 'Cinépolis Recoleta',
      neighborhood: 'Recoleta',
      type: 'chain',
      address: 'Arenales 2400',
      ticketingBaseUrl: 'https://cinepolis.com.ar',
    },
  ]);

  // --- Films ---
  console.log('Inserting films...');
  const filmRows = await db
    .insert(films)
    .values([
      {
        title: 'La Flor',
        scrapedTitle: 'La Flor',
        director: 'Mariano Llinás',
        year: 2018,
        country: 'AR',
        runtimeMin: 808,
        synopsisEs:
          'Casi catorce horas de cine argentino en una sola sesión. Seis historias, cuatro actrices, un proyecto imposible que Llinás tardó diez años en terminar.',
        matchSource: 'none',
      },
      {
        title: 'Stalker',
        scrapedTitle: 'Stalker',
        titleOriginal: 'Сталкер',
        director: 'Andrei Tarkovsky',
        year: 1979,
        country: 'URSS',
        runtimeMin: 162,
        synopsisEs:
          'La meditación más hipnótica del cine soviético: tres hombres atravesando la Zona hacia una habitación que cumple deseos secretos.',
        matchSource: 'none',
      },
      {
        title: 'Perfect Days',
        scrapedTitle: 'Perfect Days',
        director: 'Wim Wenders',
        year: 2023,
        country: 'JP/DE',
        runtimeMin: 124,
        synopsisEs:
          'Wenders filma a un hombre que limpia baños públicos en Tokio. Suena menor, es mayúscula.',
        matchSource: 'none',
      },
      {
        title: 'Anatomía de una caída',
        scrapedTitle: 'Anatomía de una caída',
        director: 'Justine Triet',
        year: 2023,
        country: 'FR',
        runtimeMin: 151,
        synopsisEs: 'Palma de Oro en Cannes 2023. Procedimental judicial con el mejor guion del año.',
        matchSource: 'none',
      },
      {
        title: 'Oppenheimer',
        scrapedTitle: 'Oppenheimer',
        director: 'Christopher Nolan',
        year: 2023,
        country: 'US',
        runtimeMin: 180,
        matchSource: 'none',
      },
      {
        title: 'Dune: Parte Dos',
        scrapedTitle: 'Dune: Parte Dos',
        director: 'Denis Villeneuve',
        year: 2024,
        country: 'US',
        runtimeMin: 166,
        matchSource: 'none',
      },
    ])
    .returning({ id: films.id, title: films.title });

  // Build title → id lookup
  const idByTitle = new Map(filmRows.map((f) => [f.title, f.id]));

  // --- Screenings ---
  console.log('Inserting screenings...');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysFromNow = (days: number, hour: number, minute = 0) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    d.setHours(hour, minute, 0, 0);
    return d;
  };

  await db.insert(screenings).values([
    // Today
    {
      filmId: idByTitle.get('La Flor')!,
      cinemaId: 'lugones',
      startsAtUtc: daysFromNow(0, 19),
      tags: ['unique'],
      sourceUrl: 'https://complejoteatral.gob.ar/sala-leopoldo-lugones/la-flor',
    },
    {
      filmId: idByTitle.get('Stalker')!,
      cinemaId: 'malba',
      startsAtUtc: daysFromNow(0, 20, 30),
      tags: ['restored', 'retrospective'],
      sourceUrl: 'https://malba.org.ar/cine/stalker',
    },
    {
      filmId: idByTitle.get('Perfect Days')!,
      cinemaId: 'lorca',
      startsAtUtc: daysFromNow(0, 20),
      tags: ['premiere'],
      sourceUrl: 'https://cinelorca.com.ar/perfect-days',
    },
    {
      filmId: idByTitle.get('Oppenheimer')!,
      cinemaId: 'cinepolis-recoleta',
      startsAtUtc: daysFromNow(0, 21),
      tags: [],
      sourceUrl: 'https://cinepolis.com.ar/oppenheimer',
    },

    // Tomorrow
    {
      filmId: idByTitle.get('Anatomía de una caída')!,
      cinemaId: 'lorca',
      startsAtUtc: daysFromNow(1, 19, 30),
      tags: ['premiere'],
      sourceUrl: 'https://cinelorca.com.ar/anatomia',
    },
    {
      filmId: idByTitle.get('Dune: Parte Dos')!,
      cinemaId: 'cinepolis-recoleta',
      startsAtUtc: daysFromNow(1, 21, 30),
      tags: [],
      sourceUrl: 'https://cinepolis.com.ar/dune-2',
    },

    // Day after
    {
      filmId: idByTitle.get('Stalker')!,
      cinemaId: 'malba',
      startsAtUtc: daysFromNow(2, 20),
      tags: ['restored', 'retrospective'],
      sourceUrl: 'https://malba.org.ar/cine/stalker',
    },
  ]);

  // Count rows in each table for confirmation
  const [cinemaCount] = await db.select({ c: cinemas.id }).from(cinemas);
  const allCinemas = await db.select().from(cinemas);
  const allFilms = await db.select().from(films);
  const allScreenings = await db.select().from(screenings);

  console.log('\n✅ Seed complete:');
  console.log(`   cinemas:    ${allCinemas.length}`);
  console.log(`   films:      ${allFilms.length}`);
  console.log(`   screenings: ${allScreenings.length}`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  });
