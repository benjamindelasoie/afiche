/**
 * Per-screening .ics (iCalendar) download.
 *
 * GET /api/screening/<id>/ics → VCALENDAR body with one VEVENT for the
 * screening. Calendar clients (Google / Apple / Outlook) recognize the
 * Content-Type + the .ics filename and import in one tap.
 *
 * The URL keeps the .ics extension in the *filename* (Content-Disposition)
 * rather than the URL path; Next.js App Router dynamic segments can't
 * combine a [bracket] with a literal `.ics` suffix in the same folder
 * name, so the extension lives in the response header where calendar
 * apps look for it anyway.
 *
 * force-dynamic: the response embeds `now` in DTSTAMP. We can't
 * meaningfully cache the body (every fetch should report a current
 * stamp), and the underlying screening data also changes via scrape.
 */

import { NextResponse } from 'next/server';
import { getScreeningById } from '@/db/queries';
import { buildScreeningIcs } from '@/lib/ics';

export const dynamic = 'force-dynamic';

const ID_RE = /^[1-9]\d{0,9}$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  if (!ID_RE.test(rawId)) {
    return new NextResponse('Not Found', { status: 404 });
  }
  const id = Number.parseInt(rawId, 10);
  const screening = await getScreeningById(id);
  if (!screening) {
    return new NextResponse('Not Found', { status: 404 });
  }
  const body = buildScreeningIcs(screening);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="afiche-screening-${id}.ics"`,
      'Cache-Control': 'no-store',
    },
  });
}
