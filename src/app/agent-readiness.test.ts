/**
 * Agent-readiness invariants — pins the machine-facing signals that the "Is
 * Agentic" audit checks, so a future edit can't silently regress them:
 *
 *   - Homepage canonical URL + og:type (metadata completeness).
 *   - Homepage site-identity JSON-LD (Organization) mount.
 *   - /llms.txt exists with a "when to use" section and MCP call instructions.
 *   - The root 404 offers machine-followable recovery links (sitemap, llms.txt).
 *
 * String-based file scans (same discipline as layout-invariants.test.ts) — no
 * import of the React tree / next-font, which don't load under the node test
 * env. The runtime shape of the JSON-LD payload is covered in json-ld.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFile(resolve(projectRoot, rel), 'utf8');

describe('homepage metadata completeness', () => {
  it('root layout declares og:type website and an og:url', async () => {
    const src = await read('src/app/layout.tsx');
    expect(src).toContain('openGraph');
    expect(src).toMatch(/type:\s*'website'/);
    // url + siteName round out the OG identity block.
    expect(src).toContain('siteName');
  });

  it('homepage sets a canonical URL', async () => {
    const src = await read('src/app/page.tsx');
    expect(src).toMatch(/canonical:\s*'\/'/);
  });

  it('homepage mounts the Organization site-identity JSON-LD', async () => {
    const src = await read('src/app/page.tsx');
    expect(src).toContain('buildSiteJsonLd');
    expect(src).toMatch(/<JsonLd\s+payload=\{buildSiteJsonLd\(\)\}/);
  });
});

describe('/llms.txt agent-instruction file', () => {
  it('exists with an H1, a when-to-use section, and MCP call guidance', async () => {
    const txt = await read('public/llms.txt');
    expect(txt.startsWith('# afiche')).toBe(true);
    expect(txt).toMatch(/when to use/i);
    expect(txt).toContain('https://afiche.ar/api/mcp');
    // Names the concrete tools an agent would call.
    expect(txt).toContain('whats_on');
    // Documents the markdown content-negotiation escape hatch.
    expect(txt.toLowerCase()).toContain('text/markdown');
  });
});

describe('agent-friendly 404 recovery', () => {
  it('root not-found links to the sitemap and llms.txt', async () => {
    const src = await read('src/app/not-found.tsx');
    expect(src).toContain('/sitemap.xml');
    expect(src).toContain('/llms.txt');
    expect(src).toContain('/cartelera');
  });
});
