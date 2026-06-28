import { NextRequest, NextResponse, after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { checkListingOwner } from '@/lib/listing-owner'
import { reindexListing } from '@/lib/listing-index'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = new Set(['active', 'sold', 'hidden'])

// A seller sets the availability of their OWN listing: 'active' (live),
// 'sold' or 'hidden' (pulled from the public feed, kept in the dashboard).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await checkListingOwner(id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.code })

  let body: { status?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const status = String(body.status || '')
  if (!STATUSES.has(status)) return NextResponse.json({ error: 'invalid_status' }, { status: 400 })

  // Re-activating also counts as confirming it's still available.
  await db.listing.update({
    where: { id },
    data: { status, ...(status === 'active' ? { availabilityConfirmedAt: new Date() } : {}) },
  })
  revalidatePath(`/listings/${id}`) // sold/hidden must drop from the cached page (it 404s non-active)
  after(() => reindexListing(id)) // active → (re)index for AI search; sold/hidden → remove
  return NextResponse.json({ ok: true, status })
}
