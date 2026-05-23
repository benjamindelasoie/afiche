import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Admin · Afiche',
  // Strategy A noindex — admin surfaces never appear in search.
  robots: { index: false, follow: false },
};

/**
 * Admin shell. Intentionally NO auth check here — per Next.js 16's
 * authentication guide, layout-level auth leaks through Partial Rendering
 * and Server Actions. The verifySession() DAL helper handles the check
 * at the top of every page and every server action.
 *
 * Pure layout shell: header with link back to the public site + nav.
 * Strategy A noindex (see metadata above).
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full flex-col">
      <header className="border-b border-neutral-200 px-6 py-3">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin/unmatched" className="text-base font-semibold">
              Admin · Afiche
            </Link>
            <nav className="flex items-center gap-3 text-sm text-neutral-600">
              <Link href="/admin/unmatched" className="hover:text-neutral-900">
                Unmatched
              </Link>
              <Link href="/admin/runs" className="hover:text-neutral-900">
                Runs
              </Link>
            </nav>
          </div>
          <Link href="/" className="text-sm text-neutral-600 hover:underline">
            ← Back to cartelera
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 p-6">{children}</main>
    </div>
  );
}
