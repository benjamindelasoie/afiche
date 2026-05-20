'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE,
  isValidAdminPassword,
  mintSessionCookieValue,
} from '@/lib/admin-auth';

/**
 * Validate the submitted password, set the signed session cookie, and
 * redirect to the deep link (?next=...) or /admin/unmatched.
 *
 * Failure path: redirect back to /admin/login?error=invalid&next=... so
 * the page can render an inline error without needing a client component.
 *
 * Server-only. No client state, no useActionState. Form posts straight here.
 */
export async function loginAction(formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '');
  const next = sanitizeNext(String(formData.get('next') ?? ''));

  if (!isValidAdminPassword(password)) {
    const params = new URLSearchParams({ error: 'invalid' });
    if (next) params.set('next', next);
    redirect(`/admin/login?${params.toString()}`);
  }

  const jar = await cookies();
  jar.set(ADMIN_SESSION_COOKIE, mintSessionCookieValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ADMIN_SESSION_MAX_AGE,
  });

  redirect(next || '/admin/unmatched');
}

/**
 * Only accept ?next= values that are local paths inside /admin/. Rejects
 * absolute URLs, protocol-relative URLs, and paths outside the admin
 * tree — open-redirect defense (the cookie now exists; bouncing to an
 * attacker-controlled URL would expose the operator).
 */
function sanitizeNext(raw: string): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/admin')) return null;
  if (raw.startsWith('//')) return null;
  if (raw.startsWith('/admin/login')) return null;
  return raw;
}
