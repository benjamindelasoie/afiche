import { describe, it, expect, vi, beforeEach } from 'vitest';

const getScreeningByIdMock = vi.fn();
vi.mock('@/db/queries', () => ({
  getScreeningById: (...args: unknown[]) => getScreeningByIdMock(...args),
}));
vi.mock('@/lib/ics', () => ({
  buildScreeningIcs: () => 'BEGIN:VCALENDAR\r\nEND:VCALENDAR',
}));

const { GET } = await import('./route');

function getWith(id: string) {
  return GET(new Request('https://afiche.ar/api/screening/x/ics'), {
    params: Promise.resolve({ id }),
  });
}

describe('GET /api/screening/[id]/ics', () => {
  beforeEach(() => getScreeningByIdMock.mockReset());

  it.each(['0', '01', 'abc', '', '12a', '-1'])('404s on invalid id %j', async (bad) => {
    const res = await getWith(bad);
    expect(res.status).toBe(404);
    expect(getScreeningByIdMock).not.toHaveBeenCalled();
  });

  it('404s when the screening does not exist', async () => {
    getScreeningByIdMock.mockResolvedValue(null);
    const res = await getWith('999');
    expect(res.status).toBe(404);
    expect(getScreeningByIdMock).toHaveBeenCalledWith(999);
  });

  it('returns 200 with calendar headers and body for a valid screening', async () => {
    getScreeningByIdMock.mockResolvedValue({ id: 42 }); // shape irrelevant — ics is mocked
    const res = await getWith('42');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="afiche-screening-42.ics"',
    );
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    await expect(res.text()).resolves.toContain('BEGIN:VCALENDAR');
  });
});
