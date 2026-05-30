import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-5xl min-w-0 px-4 py-16 sm:px-6 md:py-24">
      <section className="space-y-6 py-12 text-center">
        <h1 className="text-ink font-serif text-2xl leading-tight text-balance italic md:text-3xl">
          Esta sala no está en nuestra cartelera.
        </h1>
        <p className="text-ink-gray font-serif text-lg italic">
          Cubrimos cines independientes y de repertorio de Buenos Aires.
        </p>
        <Link
          href="/"
          className="tracking-eyebrow text-carmine border-carmine mt-2 inline-block border-b font-mono text-[11px] uppercase"
        >
          ← Cartelera actual
        </Link>
      </section>
    </main>
  );
}
