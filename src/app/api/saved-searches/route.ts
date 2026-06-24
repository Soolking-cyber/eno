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
  const paramsJson = JSON.stringify(params)

  // Idempotent: re-saving the SAME filter set returns the existing row instead of
  // creating a duplicate (which the alerts cron would amplify into repeated push/
  // notifications forever). Covers double-tap, concurrent, and multi-device saves.
  const existing = await db.savedSearch.findFirst({ where: { profileId: me.id, params: paramsJson } })
  if (existing) return NextResponse.json({ id: existing.id, label: existing.label, url: `/?${toUrlParams(params)}` })

  const count = await db.savedSearch.count({ where: { profileId: me.id } })
  if (count >= MAX_PER_USER) return NextResponse.json({ error: 'limit_reached', max: MAX_PER_USER }, { status: 409 })

  const label = (typeof body.label === 'string' && body.label.trim() ? body.label.trim() : describeParams(params)).slice(0, 120)
  try {
    const created = await db.savedSearch.create({
      data: { profileId: me.id, label, params: paramsJson, notify: true },
    })
    return NextResponse.json({ id: created.id, label: created.label, url: `/?${toUrlParams(params)}` }, { status: 201 })
  } catch (e) {
    // Concurrent double-save raced past the findFirst → the unique index caught it.
    // Return the row that won instead of erroring.
    if ((e as { code?: string })?.code === 'P2002') {
      const row = await db.savedSearch.findFirst({ where: { profileId: me.id, params: paramsJson } })
      if (row) return NextResponse.json({ id: row.id, label: row.label, url: `/?${toUrlParams(params)}` })
    }
    throw e
  }
}
