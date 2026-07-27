import type { Metadata } from 'next';
import Link from 'next/link';
import { listCinemas } from '@/db/queries';
import {
  PageShell,
  BackLink,
  Caps,
  SectionHeading,
  focusRing,
} from '@/app/_components/ui';
import { cn } from '@/lib/cn';

// /acerca — "Sobre afiche". The site's editorial about page: what afiche is,
// how it's built, the salas it covers, and — quietly, at the very bottom — the
// read-only MCP endpoint (afiche as data). It's the one human-readable home for
// the MCP surface; nothing in the site chrome signals the MCP lives here beyond
// a plain "sobre afiche" footer link. Interior-page composition: a back-link to
// the cartelera, a left-aligned reading column, es-AR editorial voice.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sobre afiche',
  description:
    'Afiche es una cartelera curada de los cines independientes y de repertorio de Buenos Aires: qué es, cómo se arma, qué salas cubre y cómo leer la cartelera con asistentes de IA vía MCP.',
};

const MCP_ENDPOINT = 'https://afiche.ar/api/mcp';
const MCP_CONNECT = `claude mcp add --transport http afiche ${MCP_ENDPOINT}`;

export default async function AcercaPage() {
  const cinemas = await listCinemas();

  return (
    <PageShell width="5xl" pad="roomy">
      <BackLink>Cartelera</BackLink>

      <article className="mt-8 max-w-2xl md:mt-10">
        {/* Hero */}
        <header>
          <h1 className="font-serif text-[clamp(2.5rem,8vw,4.5rem)] leading-[0.95] tracking-[-0.01em] text-balance">
            Sobre afiche
          </h1>
          <p className="text-ink-gray mt-3 font-serif text-xl italic md:text-2xl">
            Cartelera curada de Buenos Aires
          </p>
        </header>

        {/* Lede */}
        <p className="text-ink mt-10 font-serif text-2xl leading-snug text-pretty md:text-3xl">
          Afiche es una cartelera — un mapa de lo que se proyecta esta semana en las salas
          independientes y de repertorio de Buenos Aires. Una sola pantalla para todo el
          circuito.
        </p>

        {/* La idea */}
        <div className="text-ink mt-10 space-y-4 text-base leading-relaxed md:text-lg">
          <p>
            Cada sala publica su programación a su manera —un PDF, una grilla, una imagen
            escaneada, un sitio que cambia los jueves—. Afiche las lee todas, reúne las
            funciones en un solo lugar y las ordena por <em>película</em>: no por sala, no
            por horario. Así ves de un vistazo qué se da hoy, este finde o la semana que
            viene.
          </p>
          <p>
            Sin buscador, sin cuenta, sin algoritmo. La cartelera es el índice. Hecho por
            cinéfilos, para cinéfilos.
          </p>
        </div>

        {/* Cómo se arma */}
        <section className="mt-16">
          <SectionHeading variant="bordered">Cómo se arma</SectionHeading>
          <p className="text-ink mt-5 text-base leading-relaxed text-pretty md:text-lg">
            Todas las madrugadas afiche revisa los sitios de las salas, junta las
            funciones nuevas y colapsa la misma película —que suele aparecer con títulos
            distintos en cada cine— en una sola ficha. Después la enriquece con datos de
            TMDB: afiche, sinopsis, director, elenco, país. Lo que ves es el circuito
            entero, deduplicado y puesto en limpio.
          </p>
        </section>

        {/* Las salas */}
        <section className="mt-16">
          <SectionHeading variant="bordered">Las salas</SectionHeading>
          <p className="text-ink mt-5 text-base leading-relaxed text-pretty md:text-lg">
            Cubrimos el circuito independiente y de repertorio. Las cadenas quedan afuera,
            a propósito.
          </p>
          <ul className="mt-6 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            {cinemas.map((c) => (
              <li
                key={c.id}
                className="border-t border-black/10 first:border-t-0 sm:[&:nth-child(2)]:border-t-0"
              >
                <Link
                  href={`/sala/${c.id}`}
                  className={cn(
                    'group flex items-baseline justify-between gap-3 py-3 transition-colors',
                    focusRing,
                  )}
                >
                  <span className="text-ink group-hover:text-carmine font-serif text-lg transition-colors">
                    {c.name}
                  </span>
                  {c.neighborhood ? (
                    <Caps as="span" className="text-ink-gray shrink-0 pt-1">
                      {c.neighborhood}
                    </Caps>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* afiche como datos — the quiet MCP coda */}
        <section className="mt-16">
          <SectionHeading variant="bordered">afiche como datos</SectionHeading>
          <p className="text-ink mt-5 text-base leading-relaxed text-pretty md:text-lg">
            La cartelera también se puede leer a máquina. Afiche publica sus funciones vía
            MCP —el Model Context Protocol—, así cualquier asistente de IA puede responder
            «¿qué dan esta noche en Palermo?» con datos reales, en vivo.
          </p>

          <div className="border-carmine mt-6 border-l-2 bg-black/[0.02]">
            <dl className="space-y-4 px-5 py-5">
              <div>
                <Caps as="dt" variant="card" className="text-ink-gray">
                  Endpoint
                </Caps>
                <dd className="text-ink mt-1 font-mono text-sm break-all">
                  {MCP_ENDPOINT}
                </dd>
              </div>
              <div>
                <Caps as="dt" variant="card" className="text-ink-gray">
                  Conectar · Claude Code
                </Caps>
                <dd className="mt-1 overflow-x-auto">
                  <code className="text-ink font-mono text-sm whitespace-pre">
                    {MCP_CONNECT}
                  </code>
                </dd>
              </div>
              <div>
                <Caps as="dt" variant="card" className="text-ink-gray">
                  Herramientas
                </Caps>
                <dd className="text-ink-gray mt-1 font-mono text-xs">
                  whats_on · search_films · get_film · list_cinemas
                </dd>
              </div>
            </dl>
          </div>
          <p className="text-ink-gray mt-3 text-sm">
            Solo lectura, sobre datos públicos. Sin credenciales.
          </p>
        </section>

        {/* Colophon */}
        <footer className="mt-16 border-t-8 border-double border-black pt-6">
          <p className="text-ink-gray text-sm leading-relaxed">
            Afiche es software de código disponible, bajo licencia PolyForm Noncommercial.
            Hecho en Buenos Aires.
          </p>
        </footer>
      </article>
    </PageShell>
  );
}
