/**
 * Cine Lorca provider. Two-screen arthouse on Av. Corrientes 1428,
 * inaugurated 1968. All films screened in original-language with subtitles.
 * Programming cycle is Thursday → Wednesday.
 *
 * Strategy:
 *   Lorca publishes its weekly cartelera as a JPEG image only — no HTML
 *   schedule, no API. Each Thursday a new image goes up with that week's
 *   program. We send the image to Claude Haiku 4.5 vision and parse the
 *   structured JSON it returns.
 *
 *   1. Fetch /current-production from the Wix-hosted site.
 *   2. Locate the <img> reference whose URL ends in `cartelera.jpeg`.
 *   3. Download the image bytes.
 *   4. Call Claude vision with the image + a strict-JSON-output prompt.
 *   5. Parse + validate the JSON response into a ParsedCartelera.
 *   6. Expand each (film × time × day-in-validity-range) → one screening.
 *
 * Why a vision model and not local OCR:
 *   We tried tesseract.js (with column cropping, 3x upscaling, multiple
 *   PSM modes) — see git history. On Lorca's stylized poster type it
 *   correctly extracted only 1 of 7 titles per week, with another match
 *   pointing at the wrong film entirely. Tesseract's failure modes
 *   (chars split mid-word, single-char substitutions, dropped lines on
 *   narrow-cell wraps) defeat the cleanup heuristics we tried, and the
 *   manual-patch tax on a weekly cartelera was too high. Claude vision
 *   handles this kind of poster reliably for ~$0.01 per scrape.
 *
 * The vision call is encapsulated in `readCarteleraWithVision()`. If we
 * ever want to swap the backend (a different VLM, a hand-rolled OCR
 * pipeline, a structured-feed if Lorca ever publishes one), the change
 * stays inside this module — the provider, parser-output shape, and
 * caller all stay the same.
 */

import * as cheerio from 'cheerio';
import Anthropic from '@anthropic-ai/sdk';
import { type Provider, type ProviderRunResult, type ScrapedScreening } from './types';

const PROGRAMACION_URL = 'https://cinelorca.wixsite.com/cine-lorca/current-production';
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const VISION_MODEL = 'claude-haiku-4-5-20251001';
const VISION_MAX_TOKENS = 2000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ParsedFilm {
  title: string;
  times: Array<{ hour: number; minute: number }>;
}

export interface ParsedCartelera {
  validFrom: { year: number; month: number; day: number } | null;
  validTo: { year: number; month: number; day: number } | null;
  films: ParsedFilm[];
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const cineLorcaProvider: Provider = {
  id: 'lorca',
  name: 'Cine Lorca',

  async fetch(): Promise<ProviderRunResult> {
    const warnings: string[] = [];
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        return {
          cinemaId: 'lorca',
          screenings: [],
          success: false,
          warnings,
          error:
            'ANTHROPIC_API_KEY not set — Cine Lorca requires Claude vision to ' +
            'parse its image-only cartelera. Add the key to .env.local (or ' +
            '.env.prod for production scrapes). See .env.example.',
        };
      }

      const html = await fetchText(PROGRAMACION_URL);
      const imageUrl = extractCarteleraImageUrl(html);
      if (!imageUrl) {
        return {
          cinemaId: 'lorca',
          screenings: [],
          success: false,
          warnings,
          error: `cartelera image not found on ${PROGRAMACION_URL}`,
        };
      }

      const image = await fetchBytes(imageUrl);
      const parsed = await readCarteleraWithVision(image);

      if (!parsed.validFrom || !parsed.validTo) {
        return {
          cinemaId: 'lorca',
          screenings: [],
          success: false,
          warnings,
          error: 'vision response did not include a validity range',
        };
      }
      if (parsed.films.length === 0) {
        return {
          cinemaId: 'lorca',
          screenings: [],
          success: false,
          warnings,
          error: 'vision response had no films',
        };
      }

      // Sanity check: Lorca's cycle is always 6-8 days (Thursday → Wednesday).
      // A wider range almost always means vision misread a DD/MM date as MM/DD
      // and produced a multi-week phantom run (observed 2026-05-02: vision
      // parsed "06/05" as June 5 instead of May 6, exploding a 7-day window
      // into 37 days). Refuse to ingest rather than poison Turso with bogus
      // future screenings.
      const days = countValidityDays(parsed.validFrom, parsed.validTo);
      if (days < 4 || days > 14) {
        return {
          cinemaId: 'lorca',
          screenings: [],
          success: false,
          warnings,
          error: `vision returned implausible validity range of ${days} days (expected 6-8 for Thu→Wed). Likely a DD/MM vs MM/DD misread on one of the bounds.`,
        };
      }

      const screenings = expandScreenings(parsed, PROGRAMACION_URL);
      return { cinemaId: 'lorca', screenings, success: true, warnings };
    } catch (err) {
      return {
        cinemaId: 'lorca',
        screenings: [],
        success: false,
        warnings,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Image-URL extraction (pure)
// ---------------------------------------------------------------------------

/**
 * Find the cartelera JPEG URL on a /current-production HTML page.
 *
 * Two strategies, in order:
 *
 *   1. User-uploaded JPEG with Wix's `~mv2` marker. Wix injects the `~mv2`
 *      infix into the filename of any image uploaded through the site
 *      editor's media manager. UI icons (PNGs without ~mv2) and Wix-set
 *      "page hero" images (which feed `og:image`, sometimes a venue lobby
 *      shot rather than the cartelera) lack this marker. Among matching
 *      JPEGs we pick the one with the largest rendered area (parsed from
 *      `/fill/w_NNN,h_NNN/` or `/fit/w_NNN,h_NNN/` in the URL). Verified
 *      2026-05-02 against the live page after the regex-only strategy
 *      below started missing.
 *
 *   2. Fallback: scan <img> tags for the SEO-friendly `cartelera.jpeg`
 *      filename. Older uploads got the rename; if Lorca returns to that
 *      habit (or the `~mv2` marker disappears in a Wix redesign), this
 *      still works.
 *
 * Note on og:image: it's NOT a reliable anchor for the cartelera. On the
 * 2026-05-02 capture og:image pointed at the lobby/venue photo, while the
 * actual cartelera lived in a separate ~mv2 <img>. Don't add og:image as
 * a fallback without re-validating.
 */
export function extractCarteleraImageUrl(html: string): string | null {
  const $ = cheerio.load(html);

  let bestMv2: { url: string; area: number } | null = null;
  $('img').each((_, el) => {
    const candidates = [$(el).attr('src') ?? '', $(el).attr('srcset') ?? ''];
    for (const c of candidates) {
      // Match a Wix media URL whose filename carries the ~mv2 marker and
      // ends in .jpg/.jpeg. URLs with the marker AFTER the /media/ segment
      // and BEFORE the transform path (`/v1/...`) are user-uploaded.
      const matches = c.matchAll(
        /https?:\/\/static\.wixstatic\.com\/media\/[^\s"']*~mv2\.jpe?g[^\s"']*/gi,
      );
      for (const m of matches) {
        const url = m[0];
        const area = parseRenderedArea(url);
        if (!bestMv2 || area > bestMv2.area) bestMv2 = { url, area };
      }
    }
  });
  if (bestMv2) return (bestMv2 as { url: string }).url;

  let found: string | null = null;
  $('img').each((_, el) => {
    if (found) return;
    const candidates = [$(el).attr('src') ?? '', $(el).attr('srcset') ?? ''];
    for (const c of candidates) {
      const m = c.match(/https?:\/\/static\.wixstatic\.com\/[^\s"']*cartelera\.jpe?g/i);
      if (m) {
        found = m[0];
        return;
      }
    }
  });
  return found;
}

/**
 * Parse the rendered area (width × height) from a Wix CDN transform URL.
 * Looks for `/fit/w_NNN,h_NNN/` or `/fill/w_NNN,h_NNN/` in the path.
 * Returns 0 when no transform parameters are present (the URL likely
 * serves the original at unknown dimensions).
 */
function parseRenderedArea(url: string): number {
  const m = url.match(/\/(?:fit|fill|crop)\/[^/]*w_(\d+)[^/]*h_(\d+)/);
  if (!m) return 0;
  return parseInt(m[1], 10) * parseInt(m[2], 10);
}

// ---------------------------------------------------------------------------
// Vision extraction (impure)
// ---------------------------------------------------------------------------

const VISION_PROMPT = `You are looking at the weekly cartelera (film schedule) of Cine Lorca, a Buenos Aires arthouse cinema. The image is a printed-style poster with a black background and white panels containing film blocks.

Return ONLY a JSON object with exactly this shape, no prose, no markdown fences:

{
  "validFrom": { "day": <1-31>, "month": <1-12> },
  "validTo": { "day": <1-31>, "month": <1-12> },
  "year": <YYYY>,
  "films": [
    { "title": "<title exactly as printed, preserving case and punctuation>", "times": ["HH:MM", ...] }
  ]
}

Rules:
- The validity range appears in the left column as "PROGRAMACIÓN VÁLIDA DESDE EL DD/MM AL DD/MM" with the year on its own line nearby.
- This is ARGENTINE DATE FORMAT: the first number in each slash-pair is the DAY, the second is the MONTH. Always.
  Example: "30/04 AL 06/05" means starts April 30 (day=30, month=4), ends May 6 (day=6, month=5).
  NEVER interpret "06/05" as June 5 — it's always May 6 here. If a number is greater than 12, it's the day.
- The cycle is always 6 to 8 days long (Thursday through Wednesday). If your parsed dates produce a longer range, you misread one of them. Re-check.
- Each film block contains a quoted title, one or more "HH:MM hs." showtime lines, and a "Duración: ... MIN ..." line.
- Times in 24-hour format. "20:05 hs." → "20:05".
- IGNORE the SALA labels (Sala 1, Sala 2). We don't track which auditorium.
- IGNORE pricing.
- IGNORE the "Abrimos nuestras puertas" footer.
- Preserve diacritics. If a title is multi-line on the poster, join with a single space.`;

async function readCarteleraWithVision(image: Buffer): Promise<ParsedCartelera> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const message = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: VISION_MAX_TOKENS,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: image.toString('base64'),
            },
          },
          { type: 'text', text: VISION_PROMPT },
        ],
      },
    ],
  });
  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('vision response had no text content');
  }
  return parseVisionResponse(textBlock.text);
}

/**
 * Parse the JSON the vision model returned. Tolerant to ```json fences
 * because models occasionally add them despite the "no markdown" instruction.
 */
export function parseVisionResponse(raw: string): ParsedCartelera {
  const stripped = raw
    .replace(/^\s*```(?:json)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();

  let data: unknown;
  try {
    data = JSON.parse(stripped);
  } catch {
    throw new Error(`vision response was not valid JSON: ${raw.slice(0, 200)}`);
  }

  if (!isVisionShape(data)) {
    throw new Error(
      `vision JSON missing required fields: ${JSON.stringify(data).slice(0, 300)}`,
    );
  }

  const year = data.year;
  const validFrom = { year, month: data.validFrom.month, day: data.validFrom.day };

  // Year-rollover guard: when the to-date precedes the from-date in the
  // printed year, the cycle crosses Dec → Jan, so to-year is from-year + 1.
  const fromMs = Date.UTC(year, validFrom.month - 1, validFrom.day);
  const toCandidateMs = Date.UTC(year, data.validTo.month - 1, data.validTo.day);
  const toYear = toCandidateMs < fromMs ? year + 1 : year;
  const validTo = { year: toYear, month: data.validTo.month, day: data.validTo.day };

  const films = data.films
    .map((f) => ({
      title: f.title.trim(),
      times: (f.times ?? [])
        .map(parseHHMM)
        .filter((t): t is { hour: number; minute: number } => t !== null),
    }))
    .filter((f) => f.title.length > 0 && f.times.length > 0);

  return { validFrom, validTo, films };
}

interface VisionShape {
  validFrom: { day: number; month: number };
  validTo: { day: number; month: number };
  year: number;
  films: Array<{ title: string; times: string[] }>;
}

function isVisionShape(d: unknown): d is VisionShape {
  if (typeof d !== 'object' || d === null) return false;
  const o = d as Record<string, unknown>;
  if (typeof o.year !== 'number') return false;
  if (!isDayMonth(o.validFrom) || !isDayMonth(o.validTo)) return false;
  if (!Array.isArray(o.films)) return false;
  return o.films.every(
    (f) =>
      typeof f === 'object' &&
      f !== null &&
      typeof (f as { title: unknown }).title === 'string' &&
      Array.isArray((f as { times: unknown }).times),
  );
}

function isDayMonth(d: unknown): d is { day: number; month: number } {
  if (typeof d !== 'object' || d === null) return false;
  const o = d as Record<string, unknown>;
  return (
    typeof o.day === 'number' &&
    typeof o.month === 'number' &&
    o.day >= 1 &&
    o.day <= 31 &&
    o.month >= 1 &&
    o.month <= 12
  );
}

function parseHHMM(s: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

// ---------------------------------------------------------------------------
// Expansion (pure)
// ---------------------------------------------------------------------------

export function expandScreenings(
  parsed: ParsedCartelera,
  sourceUrl: string,
): ScrapedScreening[] {
  if (!parsed.validFrom || !parsed.validTo) return [];
  const days = enumerateDays(parsed.validFrom, parsed.validTo);
  const out: ScrapedScreening[] = [];
  for (const film of parsed.films) {
    for (const d of days) {
      for (const t of film.times) {
        out.push({
          cinemaId: 'lorca',
          filmTitle: film.title,
          startsAtUtc: buildBaLocalToUtc(d.year, d.month, d.day, t.hour, t.minute),
          tags: [],
          sourceUrl,
        });
      }
    }
  }
  return out;
}

/**
 * Count the inclusive day span between validFrom and validTo. A normal
 * Lorca cycle returns 7 (Thursday through Wednesday).
 */
function countValidityDays(
  from: { year: number; month: number; day: number },
  to: { year: number; month: number; day: number },
): number {
  const fromMs = Date.UTC(from.year, from.month - 1, from.day);
  const toMs = Date.UTC(to.year, to.month - 1, to.day);
  if (toMs < fromMs) return 0;
  return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000)) + 1;
}

function enumerateDays(
  from: { year: number; month: number; day: number },
  to: { year: number; month: number; day: number },
): Array<{ year: number; month: number; day: number }> {
  const start = Date.UTC(from.year, from.month - 1, from.day);
  const end = Date.UTC(to.year, to.month - 1, to.day);
  if (end < start) return [];
  const days: Array<{ year: number; month: number; day: number }> = [];
  for (let ms = start; ms <= end; ms += 24 * 60 * 60 * 1000) {
    const d = new Date(ms);
    days.push({
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
    });
  }
  return days;
}

/**
 * Build a UTC Date from BA local (year, month, day, hour, minute).
 * Argentina is UTC-3 with no DST. Hour 24 → midnight start of next day,
 * kept consistent with the other providers.
 */
function buildBaLocalToUtc(
  year: number,
  month: number,
  day: number,
  hourBa: number,
  minuteBa: number,
): Date {
  let y = year;
  let m = month - 1;
  let d = day;
  let h = hourBa;
  if (hourBa === 24) {
    h = 0;
    const next = new Date(Date.UTC(y, m, d + 1));
    y = next.getUTCFullYear();
    m = next.getUTCMonth();
    d = next.getUTCDate();
  }
  return new Date(Date.UTC(y, m, d, h + 3, minuteBa, 0, 0));
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'es-AR,es;q=0.9' },
  });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.text();
}

async function fetchBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'es-AR,es;q=0.9' },
  });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}
