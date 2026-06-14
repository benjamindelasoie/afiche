import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const revalidatePathMock = vi.fn();
vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

const { POST } = await import('./route');

const ORIGINAL = process.env.REVALIDATE_SECRET;

function postWith(headers: Record<string, string> = {}): Request {
  return new Request('https://afiche.ar/api/revalidate', { method: 'POST', headers });
}

describe('POST /api/revalidate', () => {
  beforeEach(() => revalidatePathMock.mockReset());
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.REVALIDATE_SECRET;
    else process.env.REVALIDATE_SECRET = ORIGINAL;
  });

  it('returns 500 when REVALIDATE_SECRET is not configured', async () => {
    delete process.env.REVALIDATE_SECRET;
    const res = await POST(postWith({ 'x-revalidate-secret': 'anything' }));
    expect(res.status).toBe(500);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the provided secret is wrong', async () => {
    process.env.REVALIDATE_SECRET = 'correct-secret';
    const res = await POST(postWith({ 'x-revalidate-secret': 'wrong' }));
    expect(res.status).toBe(401);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('returns 401 when the secret header is missing', async () => {
    process.env.REVALIDATE_SECRET = 'correct-secret';
    const res = await POST(postWith());
    expect(res.status).toBe(401);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it('revalidates / and /cartelera and returns 200 on the correct secret', async () => {
    process.env.REVALIDATE_SECRET = 'correct-secret';
    const res = await POST(postWith({ 'x-revalidate-secret': 'correct-secret' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      revalidated: true,
      paths: ['/', '/cartelera'],
    });
    expect(revalidatePathMock).toHaveBeenCalledWith('/');
    expect(revalidatePathMock).toHaveBeenCalledWith('/cartelera');
  });
});
