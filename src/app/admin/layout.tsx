import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin · afiche',
  // Strategy A noindex — every admin surface (login + panel) stays out of search.
  robots: { index: false, follow: false },
};

/**
 * Admin subtree shell. Deliberately minimal: just the noindex metadata
 * umbrella covering both /admin/login and the (panel) group — no chrome. The
 * section nav lives in (panel)/layout.tsx so it never renders on the
 * unauthenticated login screen.
 *
 * No auth check in any layout — it leaks through Partial Rendering and Server
 * Actions (Next.js auth guide); verifySession() in each page/action is the
 * boundary.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
