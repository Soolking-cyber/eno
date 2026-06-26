import { NextResponse, after } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { createSupabaseServer } from '@/lib/supabase/server'
import { phoneForSeller, telHref, zaloHref } from '@/lib/contact'
import { rateLimit } from '@/lib/ratelimit'
import { sendMetaCapiEvent, metaUserDataFromHeaders } from '@/lib/meta-capi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const IP_SALT = process.env.CONTACT_IP_SALT || 'eno-contact'

function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(IP_SALT + ip).digest('hex').slice(0, 32)
}

// Reveal a verified listing's seller contact — ONLY to an authenticated user.
// The phone never appears in any anonymous payload; it's delivered here after a
// JWT-revalidated getUser() check, rate-limited, and logged as a lead.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // getUser() revalidates the JWT with Supabase Auth (cookie sessions are spoofable).
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'

  // Rate limit per user AND per IP (sliding window). Both must pass.
  const [byUser, byIp] = await Promise.all([
    rateLimit('contact:user', user.id, 30, '1 h'),
    rateLimit('contact:ip', ip, 60, '1 h'),
  ])
  if (!byUser.success || !byIp.success) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const listing = await db.listing.findUnique({
    where: { id },
    select: { id: true, verified: true, seller: { select: { id: true, phone: true } } },
  })
  // Only verified (public) listings expose contact — never pending/hidden ones.
  if (!listing || !listing.verified) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Only the seller's REAL stored phone — never a synthetic/fallback number.
  const phone = phoneForSeller({ phone: listing.seller.phone })
  if (!phone) return NextResponse.json({ error: 'no_contact' }, { status: 404 })

  // Log the reveal once per (listing, viewer); bump contactCount only on a NEW row.
  try {
    await db.contactReveal.create({
      data: { listingId: listing.id, viewerId: user.id, ipHash: hashIp(ip) },
    })
    await db.listing.update({ where: { id: listing.id }, data: { contactCount: { increment: 1 } } })
    // New buyer lead → Meta CAPI Contact (server-side, after response flushes — zero
    // client cost; no-ops until CAPI env is set). Only on a NEW reveal (this try block).
    after(() =>
      sendMetaCapiEvent('Contact', {
        eventSourceUrl: req.headers.get('referer') || undefined,
        userData: metaUserDataFromHeaders(req.headers, { email: user.email, phone: user.phone, externalId: user.id }),
        customData: { content_ids: [listing.id], content_type: 'product' },
      }),
    )
  } catch (e: unknown) {
    // P2002 = already revealed by this viewer → no double count, still return contact.
    if (!(e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002')) {
      console.error('[contact] log failed', e)
    }
  }

  return NextResponse.json({ phone, telHref: telHref(phone), zaloHref: zaloHref(phone) })
}
