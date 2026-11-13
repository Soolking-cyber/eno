import { NextResponse } from 'next/server'
import { ApiError } from '@/lib/api/api-error'
import { readJsonCapped } from '@/lib/api/body'
import { MAX_ROWS_PER_POST, MT_POST_BODY_CAP, mtJobAuthorized, mtJobToken, mtWrite, type MtRowIn } from '@/lib/mt-job'
import { logWarn } from '@/lib/log'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * THE DAILY TRANSLATION'S RESULTS, FROM eno REACH (src/lib/mt-job.ts). Body `{ rows: [{ hash, target, value }] }`, at most
 * MAX_ROWS_PER_POST. Each row is checked here again (mtWrite); the ones that pass are written, and the listing pages that show them
 * marked for a fresh render, in one transaction. ⛔ OFF (404) until MT_JOB_TOKEN is set.
 */
export async function POST(request: Request) {
  const token = mtJobToken()
  if (!token) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
  if (!mtJobAuthorized(request.headers.get('authorization'), token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE })
  }
  let body: { rows?: unknown }
  try {
    body = await readJsonCapped<{ rows?: unknown }>(request, MT_POST_BODY_CAP)
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError('bad_request', 400)
    return NextResponse.json({ error: err.code }, { status: err.status, headers: NO_STORE })
  }
  const rows = body && typeof body === 'object' && Array.isArray(body.rows) ? (body.rows as MtRowIn[]) : null
  if (!rows || rows.length > MAX_ROWS_PER_POST) {
    return NextResponse.json({ error: 'bad_request', max: MAX_ROWS_PER_POST }, { status: 400, headers: NO_STORE })
  }
  let result: Awaited<ReturnType<typeof mtWrite>>
  try {
    result = await mtWrite(rows)
  } catch (e) {
    logWarn('[mt] write failed', { name: (e as Error)?.name ?? null, message: String((e as Error)?.message ?? '').slice(0, 200) })
    return NextResponse.json({ error: 'write_failed' }, { status: 500, headers: NO_STORE })
  }
  return NextResponse.json({ written: result.written, rejected: result.rejected }, { headers: NO_STORE })
}
