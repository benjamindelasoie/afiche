import { getThisWeeksScreenings, formatTimeBA } from '@/db/queries';
import { TAG_LABELS_ES } from '@/db';

// This page is a Server Component — it runs on the server, awaits the DB
// directly, and ships rendered HTML. Zero client-side JS is shipped for the
// content below (only whatever Next.js needs for Link prefetching).
export default async function HomePage() {
  const days = await getThisWeeksScreenings();

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      {/* Masthead */}
      <header className="border-y-8 border-double border-black py-8 text-center">
        <h1 className="text-8xl font-black italic tracking-tight">Afiche</h1>
        <p className="mt-2 italic">cartelera curada de Buenos Aires</p>
        <p className="mt-1 text-xs uppercase tracking-[0.3em] text-neutral-600">
          cine más allá de la pochoclera
        </p>
      </header>

      {/* Week view */}
      <section className="mt-12 space-y-12">
        {days.length === 0 ? (
          <p className="text-center italic text-neutral-500">
            No hay funciones cargadas. Ejecutá <code>npm run db:seed</code> para ver datos de ejemplo.
          </p>
        ) : (
          days.map((day) => (
            <div key={day.dateKey}>
              {/* Day banner */}
              <div
                className={`py-3 px-4 mb-6 ${
                  day.isToday ? 'bg-black text-[#f4ebd8]' : 'border-b-2 border-dashed border-black'
                }`}
              >
                <h2 className="text-3xl font-black italic tracking-widest uppercase">
                  {day.label}
                </h2>
                <p className="text-xs font-mono uppercase tracking-[0.3em] mt-1 opacity-70">
                  {day.screenings.length} función{day.screenings.length === 1 ? '' : 'es'}
                </p>
              </div>

              {/* Screening rows */}
              <div className="space-y-4">
                {day.screenings.map((s) => (
                  <article
                    key={s.id}
                    className={`p-5 border ${
                      s.cinema.type === 'indie'
                        ? 'border-[#c1272d] bg-[#c1272d]/5 border-l-4'
                        : 'border-neutral-300 bg-black/[0.02] opacity-80'
                    }`}
                  >
                    {/* Tags */}
                    {s.tags.length > 0 && (
                      <div className="flex gap-2 mb-2 flex-wrap">
                        {s.tags.map((t) => (
                          <span
                            key={t}
                            className="text-[10px] font-mono tracking-[0.2em] uppercase px-2 py-0.5 bg-[#c1272d] text-[#f4ebd8]"
                          >
                            {TAG_LABELS_ES[t]}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-start justify-between gap-6">
                      {/* Poster thumbnail or typographic fallback */}
                      {s.cinema.type === 'indie' && (
                        <div className="shrink-0 w-20 h-28 bg-black text-[#f4ebd8] flex items-center justify-center overflow-hidden border border-black shadow-[4px_4px_0_#c1272d]">
                          {s.film.posterUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={s.film.posterUrl}
                              alt={s.film.title}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <span className="text-[10px] italic text-center px-1 leading-tight">
                              {s.film.title}
                            </span>
                          )}
                        </div>
                      )}
                      <div className="flex-1">
                        <h3 className="text-2xl font-black italic leading-tight">
                          {s.film.title}
                        </h3>
                        {s.film.director && (
                          <p className="text-sm italic text-neutral-600 mt-1">
                            {s.film.director}
                            {s.film.year && ` · ${s.film.year}`}
                            {s.film.country && ` · ${s.film.country}`}
                            {s.film.runtimeMin && ` · ${s.film.runtimeMin} min`}
                          </p>
                        )}
                        {s.film.synopsisEs && s.cinema.type === 'indie' && (
                          <p className="mt-3 text-sm italic border-l-2 border-[#c1272d] pl-3 max-w-2xl">
                            {s.film.synopsisEs}
                          </p>
                        )}
                      </div>

                      <div className="text-right shrink-0">
                        <p
                          className={`text-xs font-mono tracking-[0.2em] uppercase ${
                            s.cinema.type === 'indie' ? 'text-[#c1272d] font-bold' : 'text-neutral-600'
                          }`}
                        >
                          {s.cinema.type === 'indie' && '★ '}
                          {s.cinema.name}
                        </p>
                        {s.cinema.neighborhood && (
                          <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 mt-1">
                            {s.cinema.neighborhood}
                          </p>
                        )}
                        <p className="text-2xl font-black italic mt-2 text-[#c1272d]">
                          {formatTimeBA(s.startsAtUtc)}
                        </p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      {/* Footer */}
      <footer className="mt-20 pt-8 border-t-8 border-double border-black text-center">
        <p className="italic">Afiche — hecho por cinéfilos, para cinéfilos</p>
        <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-neutral-500 mt-2">
          última actualización · datos de ejemplo
        </p>
      </footer>
    </main>
  );
}
