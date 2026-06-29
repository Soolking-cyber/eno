import { NextRequest, NextResponse } from 'next/server'
import { checkListingOwner } from '@/lib/listing-owner'
import { updateListingCore, deleteListingCore } from '@/lib/core/listings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// PATCH — a seller edits their OWN listing (title/description/price/district/
// condition/images…). Category isn't editable here. auth → core → respond; the edit
// logic (validation, searchText rebuild, republish gate, reindex) lives in the shared
// core so the future /api/v1 PATCH reuses it verbatim.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await checkListingOwner(id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.code })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const r = await updateListingCore(id, body)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code })
  return NextResponse.json({ ok: true })
}

// DELETE — a seller removes their OWN listing (cascades reports/conversations).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await checkListingOwner(id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.code })
  await deleteListingCore(id)
  return NextResponse.json({ ok: true })
}
