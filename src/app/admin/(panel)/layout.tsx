import Link from 'next/link';

/**
 * Panel shell — the authenticated admin surfaces (unmatched queue, runs). The
 * section nav lives here, scoped to this route group, so it never renders on
 * the unauthenticated /admin/login screen: pre-auth, those links are dead
 * (they bounce back to login) and they needlessly advertise the panel's shape.
 *
 * Intentionally NO auth check here — per Next.js 16's authentication guide,
 * layout-level auth leaks through Partial Rendering and Server Actions. The
 * verifySession() DAL helper handles the check at the top of every page and
 * every server action; that is the boundary, not this layout.
 */
export default function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full flex-col">
      <header className="border-b border-neutral-200 px-6 py-3">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin/unmatched" className="text-base font-semibold">
              Admin · afiche
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
