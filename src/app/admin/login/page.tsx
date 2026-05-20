import type { Metadata } from 'next';
import { loginAction } from './actions';

export const metadata: Metadata = {
  title: 'Admin · Afiche',
  // Strategy A noindex — admin surfaces never appear in search.
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ error?: string; next?: string }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const { error, next } = await searchParams;
  const showError = error === 'invalid';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-neutral-500">Operator panel — Afiche</p>
      </header>

      <form action={loginAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Password</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            autoFocus
            required
            className="rounded border border-neutral-300 px-3 py-2 text-base focus:border-neutral-600 focus:outline-none"
          />
        </label>

        {next ? <input type="hidden" name="next" value={next} /> : null}

        <button
          type="submit"
          className="mt-2 rounded bg-neutral-900 px-4 py-2 text-base font-medium text-white hover:bg-neutral-700"
        >
          Sign in
        </button>

        {showError ? (
          <p role="alert" className="text-sm text-red-600">
            Invalid password.
          </p>
        ) : null}
      </form>
    </main>
  );
}
