import { NextRequest, NextResponse } from 'next/server'
import { checkListingOwner } from '@/lib/listing-owner'
import { setStatusCore } from '@/lib/core/listings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A seller sets the availability of their OWN listing: 'active' (live),
// 'sold' or 'hidden' (pulled from the public feed, kept in the dashboard).
// auth → core → respond (the core is shared with the future /api/v1).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await checkListingOwner(id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.code })

  let body: { status?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const r = await setStatusCore(id, String(body.status || ''))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code })
  return NextResponse.json({ ok: true, status: r.status })
}
