import { NextResponse } from 'next/server'
import { mtJobAuthorized, mtJobToken, mtTodo } from '@/lib/mt-job'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * THE DAILY TRANSLATION'S WORK, FOR eno REACH (src/lib/mt-job.ts). Reach's worker asks with `Authorization: Bearer <MT_JOB_TOKEN>`
 * and gets every live listing text with the languages it still needs. ⛔ OFF (404) until the token is set; never cached.
 */
export async function GET(request: Request) {
  const token = mtJobToken()
  if (!token) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
  if (!mtJobAuthorized(request.headers.get('authorization'), token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE })
  }
  return NextResponse.json(await mtTodo(), { headers: NO_STORE })
}
