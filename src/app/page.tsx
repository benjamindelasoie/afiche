export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <header className="border-y-8 border-double border-black py-8 text-center">
        <h1 className="text-8xl font-black italic tracking-tight">Afiche</h1>
        <p className="mt-2 italic">cartelera curada de Buenos Aires</p>
        <p className="mt-1 text-xs uppercase tracking-[0.3em] text-neutral-500">
          cine más allá de la pochoclera
        </p>
      </header>

      <section className="mt-12">
        <p className="text-sm text-neutral-600">
          Scaffold: running. Next: data model + first provider.
        </p>
      </section>
    </main>
  );
}
