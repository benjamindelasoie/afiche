/**
 * Test helper — spins up an in-memory libSQL database and runs the real
 * Drizzle migrations against it, returning a fully-typed drizzle instance.
 *
 * Use this in tests that need to exercise actual SQL behavior (filters,
 * constraints, unique indexes) rather than mocking the database layer.
 *
 * Each call creates a fresh, isolated database — tests don't share state.
 */

import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { resolve } from 'node:path';

export type TestDb = ReturnType<typeof drizzle>;

export async function makeInMemoryDb(): Promise<TestDb> {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client);
  await migrate(db, {
    migrationsFolder: resolve(process.cwd(), 'drizzle'),
  });
  return db;
}
