import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { normalizeParams, describeParams, toUrlParams } from '@/lib/saved-search'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_PER_USER = 20

// GET: the signed-in user's saved searches (newest first), each with a ready-to-run URL.
export async function GET() {
  const me = await getCurrentProfile()
  if (!me) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const rows = await db.savedSearch.findMany({ where: { profileId: me.id }, orderBy: { createdAt: 'desc' } })
  const searches = rows.map((r) => {
    const params = (() => { try { return JSON.parse(r.params) } catch { return {} } })()
    return { id: r.id, label: r.label, notify: r.notify, createdAt: r.createdAt.toISOString(), url: `/?${toUrlParams(params)}` }
  })
  return NextResponse.json({ searches })
}

// POST { label?, params }: save the current filter set. Caps per user; label falls
// back to a generated summary. lastNotifiedAt starts now so only FUTURE matches alert.
export async function POST(req: NextRequest) {
  const me = await getCurrentProfile()
  if (!me) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  let body: { label?: string; params?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }

  const params = normalizeParams(body.params)
  const count = await db.savedSearch.count({ where: { profileId: me.id } })
  if (count >= MAX_PER_USER) return NextResponse.json({ error: 'limit_reached', max: MAX_PER_USER }, { status: 409 })

  const label = (typeof body.label === 'string' && body.label.trim() ? body.label.trim() : describeParams(params)).slice(0, 120)
  const created = await db.savedSearch.create({
    data: { profileId: me.id, label, params: JSON.stringify(params), notify: true },
  })
  return NextResponse.json({ id: created.id, label: created.label, url: `/?${toUrlParams(params)}` }, { status: 201 })
}
