/**
 * Detect a UNIQUE constraint violation on `films.slug` from a Drizzle/libsql/
 * better-sqlite3 error. The leaf SqliteError surfaces:
 *   "UNIQUE constraint failed: films.slug"
 * but Drizzle wraps that in a DrizzleQueryError whose top-level `.message`
 * is just "Failed query: update ...". Walk the `.cause` chain so the
 * substring check catches the constraint string at whichever level it
 * actually lives. Defensive over `instanceof SqliteError` because libsql
 * wraps errors differently than better-sqlite3 and we don't want to
 * depend on either runtime's internals.
 *
 * Exported so the regression test in ingest.test.ts can assert directly
 * against the wrapped DrizzleQueryError shape.
 */
export function isSlugUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  // Cap the walk at 5 hops — Drizzle → libsql → SqliteError is 3, the cap
  // is a defensive bound against a circular cause chain (rare, but a self-
  // referencing cause would otherwise loop forever).
  for (let i = 0; i < 5 && current instanceof Error; i++) {
    if (
      current.message.includes('UNIQUE constraint failed') &&
      current.message.includes('films.slug')
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
