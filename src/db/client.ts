/**
 * Database client — singleton libSQL connection + Drizzle ORM.
 *
 * Uses libSQL (Turso's SQLite fork). Accepts two connection styles:
 *   - Local SQLite file:   DATABASE_URL=file:./local.db
 *   - Turso cloud:         DATABASE_URL=libsql://your-db.turso.io
 *                          DATABASE_AUTH_TOKEN=<token>
 *
 * In Next.js (serverless), each invocation may import this module once.
 * The `globalThis` trick keeps a single client across hot-reloads in dev.
 */

import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.',
  );
}

// Reuse the client across hot-reloads in dev — prevents "too many open" errors.
declare global {
  // eslint-disable-next-line no-var
  var __afiche_libsql_client: ReturnType<typeof createClient> | undefined;
}

const libsqlClient =
  globalThis.__afiche_libsql_client ??
  createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__afiche_libsql_client = libsqlClient;
}

export const db = drizzle(libsqlClient, { schema });
export type Database = typeof db;
