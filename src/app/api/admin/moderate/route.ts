import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'

// Single admin endpoint for the moderation queue. Every action re-checks the
// session server-side via getAdmin() — never trust a client-side gate.
export async function POST(req: NextRequest) {
  const admin = await getAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { action?: string; id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const action = String(body.action || '')
  const id = String(body.id || '').trim()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  switch (action) {
    case 'approve': {
      // Publish the listing and clear any open reports against it.
      const listing = await db.listing.findUnique({ where: { id }, select: { id: true } })
      if (!listing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      await db.$transaction([
        db.listing.update({
          where: { id },
          data: {
            verified: true,
            verifiedAt: new Date(),
            verifiedBy: admin,
            verificationMethod: 'admin-review',
          },
        }),
        db.report.updateMany({ where: { listingId: id, status: 'open' }, data: { status: 'resolved' } }),
      ])
      return NextResponse.json({ ok: true })
    }

    case 'reject': {
      // Remove the listing entirely (cascade deletes its reports).
      const listing = await db.listing.findUnique({ where: { id }, select: { id: true } })
      if (!listing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      await db.listing.delete({ where: { id } })
      return NextResponse.json({ ok: true })
    }

    case 'unpublish': {
      // Pull a live listing back into the queue (reverse of approve).
      await db.listing.update({ where: { id }, data: { verified: false } })
      return NextResponse.json({ ok: true })
    }

    case 'resolve-report':
    case 'dismiss-report': {
      const status = action === 'resolve-report' ? 'resolved' : 'dismissed'
      await db.report.update({ where: { id }, data: { status } })
      return NextResponse.json({ ok: true })
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}
