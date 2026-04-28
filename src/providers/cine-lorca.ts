/**
 * Cine Lorca provider. Two-screen arthouse on Av. Corrientes 1428,
 * inaugurated 1968. All films screened in original-language with subtitles.
 *
 * Strategy:
 *   Lorca publishes its weekly cartelera as a JPEG image only — no HTML
 *   schedule, no API. Each Thursday a new image goes up with that week's
 *   program (Thursday → Wednesday cycle). We OCR the image to recover the
 *   schedule, parse the resulting text, and emit ScrapedScreening rows.
 *
 *   1. Fetch /current-production from the Wix-hosted site.
 *   2. Locate the <img> reference whose URL ends in `cartelera.jpeg`.
 *   3. Download the image bytes.
 *   4. Crop into 3 vertical strips (left=pricing+validity, mid=films 1-3,
 *      right=films 4-7). OCR each strip independently with PSM 6 because
 *      the multi-column layout otherwise interleaves rows across columns.
 *   5. Parse the linear text per strip:
 *        LEFT — extract validity range "DD/MM AL DD/MM" + 4-digit year.
 *        MID/RIGHT — each film block ends with a "Duración:" line; collect
 *        title (possibly multi-line) and showtimes (HH:MM hs).
 *   6. Expand each (film × time × day-in-validity-range) → one screening.
 *
 * OCR is intentionally an implementation detail of this module. The Provider
 * interface returns the same shape as every other provider; if Lorca ever
 * publishes a structured feed, ocrCartelera() can be replaced without
 * touching the parser, the provider, or any caller.
 *
 * Title quality is best-effort. Tesseract sometimes mangles short words
 * with thin strokes (e.g. "EL DRAMA" → "El DR A MA"). The TMDB matcher
 * is reasonably tolerant; persistent mismatches can be patched manually
 * via the existing tmdb_id Studio workflow.
 */

import * as cheerio from 'cheerio';
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import { type Provider, type ProviderRunResult, type ScrapedScreening } from './types';

const PROGRAMACION_URL = 'https://cinelorca.wixsite.com/cine-lorca/current-production';
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
      const ocr = await ocrCartelera(image);
      const parsed = parseCartelera(ocr, warnings);

      if (!parsed.validFrom || !parsed.validTo) {
        return {
          cinemaId: 'lorca',
          screenings: [],
          success: false,
          warnings,
          error: 'could not parse validity range from cartelera image',
        };
      }
      if (parsed.films.length === 0) {
        return {
          cinemaId: 'lorca',
          screenings: [],
          success: false,
          warnings,
          error: 'no films parsed from cartelera image',
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
 * Find the cartelera JPEG URL on a /current-production HTML page. Wix's
 * SEO filename ("cartelera.jpeg") is the stable anchor — the surrounding
 * media-CDN hash rotates with each upload.
 */
export function extractCarteleraImageUrl(html: string): string | null {
  const $ = cheerio.load(html);
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

// ---------------------------------------------------------------------------
// OCR (impure — tesseract + sharp)
// ---------------------------------------------------------------------------

interface OcrResult {
  left: string;
  mid: string;
  right: string;
}

async function ocrCartelera(image: Buffer): Promise<OcrResult> {
  const meta = await sharp(image).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('invalid image dimensions');
  }
  const cols = computeColumnCrops(meta.width);

  const worker = await createWorker('spa');
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '6' as never });

    const out: Partial<OcrResult> = {};
    for (const c of cols) {
      const strip = await sharp(image)
        .extract({ left: c.x, top: 0, width: c.width, height: meta.height })
        // 3x upscale: small fonts in the validity-range line and tight
        // film cells OCR much more cleanly at higher resolution. The
        // upscale cost is trivial for a 600x421 image.
        .resize({ width: c.width * 3 })
        .png()
        .toBuffer();
      const { data } = await worker.recognize(strip);
      out[c.name] = data.text;
    }
    return out as OcrResult;
  } finally {
    await worker.terminate();
  }
}

/**
 * Column boundaries scaled from a 600px-wide reference. Lorca's poster
 * has been visually consistent: left pricing column ~25%, middle films
 * column ~37%, right films column ~37%. If they ever resize, the
 * relative ratios should still hold.
 */
function computeColumnCrops(width: number): Array<{
  name: 'left' | 'mid' | 'right';
  x: number;
  width: number;
}> {
  const r = width / 600;
  const leftEnd = Math.round(155 * r);
  const midEnd = Math.round(380 * r);
  return [
    { name: 'left', x: 0, width: leftEnd },
    { name: 'mid', x: leftEnd, width: midEnd - leftEnd },
    { name: 'right', x: midEnd, width: width - midEnd },
  ];
}

// ---------------------------------------------------------------------------
// Parser (pure)
// ---------------------------------------------------------------------------

/**
 * Parse the three OCR strings into a structured cartelera.
 *
 * The LEFT strip carries the validity range ("23/04 AL 29/04 2026") plus
 * pricing — we extract the dates and ignore everything else.
 *
 * MID and RIGHT strips each carry a stack of film blocks. A block is
 * delimited by its trailing "Duración:" line — this is the most reliable
 * anchor in the OCR output, since titles can fragment across lines and
 * thin strokes break ("CALLE MÁLAGA" → "CAI l E MÁLAGA").
 */
export function parseCartelera(ocr: OcrResult, warnings: string[]): ParsedCartelera {
  const validity = parseValidityRange(ocr.left, warnings);
  const films = [
    ...parseFilmColumn(ocr.mid, warnings),
    ...parseFilmColumn(ocr.right, warnings),
  ];
  return { ...validity, films };
}

function parseValidityRange(
  left: string,
  warnings: string[],
): Pick<ParsedCartelera, 'validFrom' | 'validTo'> {
  // "23/04 AL 29/04" — also tolerate "23-04" or odd OCR spacing.
  const range = /(\d{1,2})\s*[/-]\s*(\d{1,2})\s+AL\s+(\d{1,2})\s*[/-]\s*(\d{1,2})/i.exec(left);
  const yearMatch = /\b(20\d{2})\b/.exec(left);
  if (!range) {
    warnings.push('lorca: could not find validity range in OCR');
    return { validFrom: null, validTo: null };
  }
  if (!yearMatch) {
    warnings.push('lorca: could not find year in OCR');
    return { validFrom: null, validTo: null };
  }
  const [, fromD, fromM, toD, toM] = range;
  const year = parseInt(yearMatch[1], 10);
  const validFrom = {
    year,
    month: parseInt(fromM, 10),
    day: parseInt(fromD, 10),
  };
  // Year-rollover guard: if the to-date is before the from-date in the
  // same year, the cycle crosses Dec → Jan, so to-year is from-year + 1.
  const fromMs = Date.UTC(year, validFrom.month - 1, validFrom.day);
  const toCandidateMs = Date.UTC(year, parseInt(toM, 10) - 1, parseInt(toD, 10));
  const toYear = toCandidateMs < fromMs ? year + 1 : year;
  const validTo = {
    year: toYear,
    month: parseInt(toM, 10),
    day: parseInt(toD, 10),
  };
  return { validFrom, validTo };
}

function parseFilmColumn(text: string, warnings: string[]): ParsedFilm[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const films: ParsedFilm[] = [];
  let titleParts: string[] = [];
  let times: Array<{ hour: number; minute: number }> = [];

  for (const line of lines) {
    // Time line: "o 14:10hs. SALA2" or "22.05 hs SALA?2"
    // (The tesseract bullet "o" and trailing SALA noise vary.)
    const timeMatch = line.match(/(\d{1,2})\s*[:.]\s*(\d{2})\s*hs/i);
    if (timeMatch) {
      const hour = parseInt(timeMatch[1], 10);
      const minute = parseInt(timeMatch[2], 10);
      if (hour >= 0 && hour <= 24 && minute >= 0 && minute < 60) {
        times.push({ hour, minute });
      } else {
        warnings.push(`lorca: rejected out-of-range time "${timeMatch[0]}"`);
      }
      continue;
    }

    // Block end: "Duración: 110 MIN - R13 - ING- SUBTITULADA"
    // (Also tolerant to OCR drift: "uración:", "yración:", "'uración:")
    if (/^['"`]?\s*[uy]?ració[nm]\b/i.test(line) || /^d?uració[nm]\b/i.test(line)) {
      const cleaned = cleanTitle(titleParts.join(' '));
      if (cleaned && times.length > 0) {
        films.push({ title: cleaned, times: [...times] });
      } else if (cleaned || times.length) {
        warnings.push(
          `lorca: dropped incomplete block (title="${cleaned ?? '∅'}" times=${times.length})`,
        );
      }
      titleParts = [];
      times = [];
      continue;
    }

    // Skip noise/header/footer
    if (
      /^cine\s+lorca/i.test(line) ||
      /^abrimos\s+nuestr/i.test(line) ||
      /^antes\s+\d/i.test(line) || // bleed from CINE LORCA: Av. Corrientes
      /^[\W_]*$/.test(line) || // pure punctuation/symbol noise
      line.length < 2
    ) {
      continue;
    }

    // Otherwise: treat as a title line (possibly continuation).
    titleParts.push(line);
  }

  return films;
}

/**
 * Clean a raw OCR title: strip enclosing quotes, drop noise punctuation,
 * collapse whitespace. Gentle — we'd rather accept a slightly dirty
 * title and let the TMDB matcher fuzz-match it than over-edit and lose
 * the signal.
 */
export function cleanTitle(raw: string): string | null {
  let s = raw
    .replace(/[“”"'`]+/g, '') // any quote-like char anywhere
    .replace(/\s+/g, ' ')
    .trim();

  // Strip a single trailing/leading isolated noise character (commonly
  // the "o" bullet that tesseract appends to time-line starts but
  // sometimes drifts into title territory).
  s = s.replace(/^[a-z]\s+/i, (m) => (m.trim().length === 1 ? '' : m));
  s = s.replace(/\s+[a-z]$/i, (m) => (m.trim().length === 1 ? '' : m));

  // Drop trailing comma (multi-line title joined with the next line).
  s = s.replace(/,\s*$/, '');

  s = s.replace(/\s+/g, ' ').trim();
  if (s.length < 2) return null;
  return s;
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

function enumerateDays(
  from: { year: number; month: number; day: number },
  to: { year: number; month: number; day: number },
): Array<{ year: number; month: number; day: number }> {
  const start = Date.UTC(from.year, from.month - 1, from.day);
  const end = Date.UTC(to.year, to.month - 1, to.day);
  if (end < start) return []; // defensive — parser already handled rollover
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
 * Argentina is UTC-3 with no DST. Hour 24 → midnight start of next day.
 * (Lorca doesn't program 24:00 today but the helper stays consistent
 * with the other providers.)
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
