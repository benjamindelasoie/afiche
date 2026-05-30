/**
 * Unit tests for the signed-cookie session helpers.
 *
 * Coverage targets from the eng-review test diagram:
 *   - HMAC sign round-trips successfully
 *   - HMAC verify rejects forged signature
 *   - HMAC verify rejects expired payload (>30 days old)
 *   - Constant-time secret compare (smoke check — actual constant-time
 *     guarantee comes from Node's crypto.timingSafeEqual)
 *   - getSecret() fails loud on missing/empty ADMIN_SECRET
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  isValidAdminPassword,
  isValidSessionCookie,
  mintSessionCookieValue,
  ADMIN_SESSION_MAX_AGE,
} from './admin-auth';

describe('admin-auth — signed-cookie session helpers', () => {
  beforeEach(() => {
    process.env.ADMIN_SECRET = 'test-secret-do-not-use-in-prod';
  });

  afterEach(() => {
    delete process.env.ADMIN_SECRET;
    vi.useRealTimers();
  });

  describe('isValidAdminPassword', () => {
    it('accepts the exact ADMIN_SECRET value', () => {
      expect(isValidAdminPassword('test-secret-do-not-use-in-prod')).toBe(true);
    });

    it('rejects a wrong password', () => {
      expect(isValidAdminPassword('wrong-password')).toBe(false);
    });

    it('rejects an empty submission', () => {
      expect(isValidAdminPassword('')).toBe(false);
    });

    it('rejects a length-different submission (constant-time path returns false on length mismatch)', () => {
      expect(isValidAdminPassword('short')).toBe(false);
      expect(isValidAdminPassword('much-longer-than-the-actual-secret-value')).toBe(
        false,
      );
    });

    it('throws when ADMIN_SECRET is unset', () => {
      delete process.env.ADMIN_SECRET;
      expect(() => isValidAdminPassword('anything')).toThrow(/ADMIN_SECRET/);
    });

    it('throws when ADMIN_SECRET is empty string', () => {
      process.env.ADMIN_SECRET = '';
      expect(() => isValidAdminPassword('anything')).toThrow(/ADMIN_SECRET/);
    });
  });

  describe('mintSessionCookieValue + isValidSessionCookie — round-trip', () => {
    it('a freshly minted cookie verifies successfully', () => {
      const cookie = mintSessionCookieValue();
      expect(isValidSessionCookie(cookie)).toBe(true);
    });

    it('rejects undefined / missing cookie', () => {
      expect(isValidSessionCookie(undefined)).toBe(false);
    });

    it('rejects empty-string cookie', () => {
      expect(isValidSessionCookie('')).toBe(false);
    });

    it('rejects a cookie with no signature delimiter', () => {
      expect(isValidSessionCookie('not-a-valid-cookie-shape')).toBe(false);
    });

    it('rejects a cookie with a wrong signature', () => {
      const cookie = mintSessionCookieValue();
      // Tamper with the last 4 chars of the signature.
      const tampered = cookie.slice(0, -4) + 'XXXX';
      expect(isValidSessionCookie(tampered)).toBe(false);
    });

    it('rejects a cookie signed with a different secret', () => {
      // Mint with one secret, then change the secret. The signature
      // should no longer verify against the new secret.
      const cookie = mintSessionCookieValue();
      process.env.ADMIN_SECRET = 'a-completely-different-secret';
      expect(isValidSessionCookie(cookie)).toBe(false);
    });

    it('rejects a cookie whose payload is older than ADMIN_SESSION_MAX_AGE', () => {
      // Mint a cookie at "now". Verify works.
      const cookie = mintSessionCookieValue();
      expect(isValidSessionCookie(cookie)).toBe(true);

      // Advance time past the max-age window.
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now + (ADMIN_SESSION_MAX_AGE + 60) * 1000);
      expect(isValidSessionCookie(cookie)).toBe(false);
    });

    it('rejects a future-stamped payload (clock-skew defense)', () => {
      // Construct a cookie whose timestamp is way in the future.
      const futureTs = Math.floor(Date.now() / 1000) + 60 * 60 * 24; // +1 day
      const payload = `${futureTs}.abcdef0123456789`;
      const signature = createHmac('sha256', process.env.ADMIN_SECRET!)
        .update(payload)
        .digest('base64url');
      const cookie = `${payload}.${signature}`;
      expect(isValidSessionCookie(cookie)).toBe(false);
    });

    it('rejects a cookie with a non-numeric timestamp', () => {
      const payload = 'not-a-number.nonce';
      const signature = createHmac('sha256', process.env.ADMIN_SECRET!)
        .update(payload)
        .digest('base64url');
      const cookie = `${payload}.${signature}`;
      expect(isValidSessionCookie(cookie)).toBe(false);
    });
  });
});
