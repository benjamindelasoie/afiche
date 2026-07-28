/**
 * Tests for the freshness alert endpoint. The behaviour that matters is the
 * one the incident exposed: a scrape that NEVER RAN must produce an alert.
 * Everything else here is guarding the auth gate and the no-false-alarm cases.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const q = vi.hoisted(() => ({ getLastScrapeTime: vi.fn() }));
vi.mock('@/db/queries', () => q);

const { GET } = await import('./route');

const SECRET = 'test-cron-secret';

function request(auth?: string): Request {
  return new Request('https://afiche.ar/api/health/freshness', {
    headers: auth ? { authorization: auth } : {},
  });
}

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3_600_000);
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  q.getLastScrapeTime.mockReset();
  process.env.CRON_SECRET = SECRET;
  process.env.TELEGRAM_BOT_TOKEN = 'tok';
  process.env.TELEGRAM_CHAT_ID = '123';
  delete process.env.AFICHE_STALE_HOURS;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/health/freshness — auth', () => {
  it('rejects a missing or wrong bearer token when CRON_SECRET IS configured', async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request('Bearer nope'))).status).toBe(401);
    expect((await GET(request(SECRET))).status).toBe(401); // no "Bearer " prefix
  });
});

// Dormant-by-default. Nobody has set this up yet, and a daily cron erroring
// against an unconfigured deploy would paint the Vercel dashboard red for a
// feature that was never switched on.
describe('GET /api/health/freshness — unconfigured is quiet, not broken', () => {
  it('returns 200 and reports why it is dormant when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    q.getLastScrapeTime.mockResolvedValue(hoursAgo(3));

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.alerting).toBe('disabled');
    expect(body.alertingDisabledReason).toBe('CRON_SECRET not set');
  });

  it('NEVER alerts while CRON_SECRET is unset, even on a week-old cartelera', async () => {
    // Guards the abuse vector: with no token to check, the endpoint is
    // readable, so the Telegram send must be unreachable.
    delete process.env.CRON_SECRET;
    q.getLastScrapeTime.mockResolvedValue(hoursAgo(24 * 7));

    const body = await (await GET(request())).json();

    expect(body.stale).toBe(true); // still reports the truth
    expect(body.alerted).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still reports freshness accurately while dormant', async () => {
    delete process.env.CRON_SECRET;
    q.getLastScrapeTime.mockResolvedValue(hoursAgo(3));
    expect((await (await GET(request())).json()).stale).toBe(false);
  });
});

describe('GET /api/health/freshness — verdict', () => {
  it('reports fresh and does NOT alert on a recent scrape', async () => {
    q.getLastScrapeTime.mockResolvedValue(hoursAgo(3));
    const res = await GET(request(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.stale).toBe(false);
    expect(body.alerted).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('alerts when the last success is older than the threshold', async () => {
    // The actual incident: a 7-day gap nobody was told about.
    q.getLastScrapeTime.mockResolvedValue(hoursAgo(24 * 7));
    const res = await GET(request(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(body.stale).toBe(true);
    expect(body.alerted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('api.telegram.org');
  });

  it('alerts when there has NEVER been a successful scrape', async () => {
    q.getLastScrapeTime.mockResolvedValue(null);
    const body = await (await GET(request(`Bearer ${SECRET}`))).json();

    expect(body.lastScrapeAt).toBeNull();
    expect(body.ageHours).toBeNull();
    expect(body.stale).toBe(true);
    expect(body.alerted).toBe(true);
  });

  it('does not alert just under the threshold, does just over it', async () => {
    q.getLastScrapeTime.mockResolvedValue(hoursAgo(25));
    expect((await (await GET(request(`Bearer ${SECRET}`))).json()).stale).toBe(false);

    q.getLastScrapeTime.mockResolvedValue(hoursAgo(27));
    expect((await (await GET(request(`Bearer ${SECRET}`))).json()).stale).toBe(true);
  });

  it('honours an AFICHE_STALE_HOURS override', async () => {
    process.env.AFICHE_STALE_HOURS = '4';
    q.getLastScrapeTime.mockResolvedValue(hoursAgo(6));
    expect((await (await GET(request(`Bearer ${SECRET}`))).json()).stale).toBe(true);
  });

  it('is dormant (not broken) when Telegram is unconfigured', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    q.getLastScrapeTime.mockResolvedValue(hoursAgo(48));

    const res = await GET(request(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.stale).toBe(true); // verdict still reported
    expect(body.alerting).toBe('disabled');
    expect(body.alertingDisabledReason).toBe('Telegram not configured');
    expect(body.alerted).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports alerted:false honestly when Telegram is configured but failing', async () => {
    q.getLastScrapeTime.mockResolvedValue(hoursAgo(48));
    fetchMock.mockRejectedValue(new Error('network down'));

    const res = await GET(request(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(res.status).toBe(200); // an alerting failure is not a 500
    expect(body.stale).toBe(true);
    expect(body.alerting).toBe('enabled'); // configured, just didn't get through
    expect(body.alerted).toBe(false);
  });
});
