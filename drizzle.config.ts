/**
 * Drizzle-kit config.
 *
 * Auto-detects dialect based on DATABASE_URL:
 *   - file:./local.db      → 'sqlite' dialect (uses better-sqlite3 locally)
 *   - libsql://...turso.io → 'turso' dialect (uses libSQL with auth token)
 *
 * The runtime (src/db/client.ts) uses libSQL for both cases, so the split
 * only affects drizzle-kit (migrations + studio), not the app itself.
 */

import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.',
  );
}

const isLocalFile = url.startsWith('file:');

export default isLocalFile
  ? defineConfig({
      schema: './src/db/schema.ts',
      out: './drizzle',
      dialect: 'sqlite',
      dbCredentials: { url },
      verbose: true,
      strict: true,
    })
  : defineConfig({
      schema: './src/db/schema.ts',
      out: './drizzle',
      dialect: 'turso',
      dbCredentials: {
        url,
        authToken: process.env.DATABASE_AUTH_TOKEN,
      },
      verbose: true,
      strict: true,
    });
