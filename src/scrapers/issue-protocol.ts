/**
 * The matcher-pattern issue protocol — the one place that owns the signature
 * marker embedded in issue bodies. Layer 2 writes it, the dedup and Actor 2
 * read it; keeping the prefix and the parse in a single module stops the three
 * call sites from drifting.
 */

/** Comment marker carrying a cause signature, e.g. container-or-placeholder. */
export function signatureComment(signature: string): string {
  return `<!-- afiche-pattern-sig: ${signature} -->`;
}

/** The signature embedded in an issue body, or null if none. */
export function readSignature(body: string | null | undefined): string | null {
  const m = body?.match(/afiche-pattern-sig:\s*([a-z0-9-]+)/i);
  return m ? m[1] : null;
}
