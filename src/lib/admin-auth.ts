/**
 * Signed-cookie session helpers for the operator admin panel.
 *
 * Shape on the wire: `${payload}.${signature}` where
 *   - payload = `${unix-seconds}.${16-byte-base64url-nonce}`
 *   - signature = HMAC-SHA256(payload, ADMIN_SECRET) → base64url
 *
 * Why HMAC over JWT: one operator, no claims, no rotation surface. The
 * cookie attests "you knew the secret at some point in the last 30 days,"
 * nothing more. JWT-shaped tokens would carry alg/iss/aud bloat for zero
 * marginal value in a single-tenant tool.
 *
 * Constant-time comparison for both the password (login) and the cookie
 * signature (verify). Single-operator threat model is mild, but the helpers
 * are one function each — getting it right is cheaper than getting it wrong.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'afiche_admin_session';
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

export const ADMIN_SESSION_COOKIE = COOKIE_NAME;
export const ADMIN_SESSION_MAX_AGE = COOKIE_MAX_AGE_SECONDS;

/**
 * Read ADMIN_SECRET. Fails loud if absent — empty-string fallback would
 * silently compare-equal against an empty password and grant access.
 */
function getSecret(): string {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || secret.length === 0) {
    throw new Error(
      'ADMIN_SECRET env var is missing or empty. Set it in .env.local (dev) and Vercel project settings (preview + production).',
    );
  }
  return secret;
}

/**
 * HMAC-SHA256 of payload using ADMIN_SECRET, base64url-encoded.
 */
function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

/**
 * Constant-time string compare. Returns false on length mismatch (which is
 * non-constant, but length is not secret in this surface).
 */
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Validate a submitted password against ADMIN_SECRET. Used by the login
 * server action. Constant-time to avoid timing-attack surface even at
 * single-tenant scale.
 */
export function isValidAdminPassword(submitted: string): boolean {
  return constantTimeEqual(submitted, getSecret());
}

/**
 * Mint a fresh session cookie value. Caller sets it on the response with
 * the appropriate cookie attributes (httpOnly, secure, sameSite, etc.).
 */
export function mintSessionCookieValue(): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(12).toString('base64url'); // 16 chars base64url
  const payload = `${issuedAt}.${nonce}`;
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

/**
 * Verify a session cookie value. Returns true when the signature is valid
 * AND the cookie was minted within the last COOKIE_MAX_AGE_SECONDS.
 *
 * Failures are uniform — invalid signature, expired payload, malformed
 * shape all return false. The caller redirects to login on any false.
 */
export function isValidSessionCookie(value: string | undefined): boolean {
  if (!value) return false;
  // Shape: timestamp.nonce.signature → split on the LAST dot so a nonce
  // with embedded dots (shouldn't happen with base64url, but defensive)
  // doesn't break parsing.
  const lastDot = value.lastIndexOf('.');
  if (lastDot < 0) return false;
  const payload = value.slice(0, lastDot);
  const signature = value.slice(lastDot + 1);
  if (!payload || !signature) return false;

  const expected = sign(payload);
  if (!constantTimeEqual(signature, expected)) return false;

  // Payload shape: `${unix-seconds}.${nonce}`
  const firstDot = payload.indexOf('.');
  if (firstDot < 0) return false;
  const issuedAtStr = payload.slice(0, firstDot);
  const issuedAt = Number.parseInt(issuedAtStr, 10);
  if (!Number.isFinite(issuedAt)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (now - issuedAt > COOKIE_MAX_AGE_SECONDS) return false;
  if (issuedAt > now + 60) return false; // clock skew tolerance, but no future-stamped cookies

  return true;
}
