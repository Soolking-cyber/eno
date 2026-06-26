import { NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { normalizePhone } from '@/lib/phone'
import { phoneTakenByOther } from '@/lib/phone-unique'
import { sendMetaCapiEvent, metaUserDataFromHeaders } from '@/lib/meta-capi'

export const runtime = 'nodejs'

const TYPES = new Set(['individual', 'business'])

// Records the one-time account profile chosen right after first sign-in:
//  - individual: their name (the rest of contact is captured when they post).
//  - business:   business name + representative person's name + phone → a Seller
//                storefront is created/claimed now so the dashboard, analytics and
//                "posting as <business>" prefill all work immediately.
// Owner-scoped via getCurrentProfile() (trusts the session, never the client).
export async function POST(req: Request) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  // True only on the genuine FIRST onboarding (accountType still null) → so the
  // CompleteRegistration conversion below isn't re-sent if the type is changed later.
  const firstOnboard = !profile.accountType

  let body: { accountType?: string; businessName?: string; displayName?: string; phone?: string } = {}
  try { body = await req.json() } catch { /* empty body → invalid below */ }

  const accountType = String(body.accountType || '')
  if (!TYPES.has(accountType)) return NextResponse.json({ error: 'invalid_account_type' }, { status: 400 })

  const displayName = String(body.displayName || '').trim().slice(0, 80) || profile.displayName || null
  const businessName = accountType === 'business'
    ? (String(body.businessName || '').trim().slice(0, 120) || null)
    : null
  const phone = normalizePhone(String(body.phone || '')) || profile.phone || null

  if (accountType === 'business' && !businessName) {
    return NextResponse.json({ error: 'business_name_required' }, { status: 400 })
  }

  // One number ↔ one account: a business rep's phone can't be a number already tied
  // to another account (any format — it's normalized). The user's own phone is fine.
  if (phone && await phoneTakenByOther(phone, profile.id)) {
    return NextResponse.json({ error: 'phone_taken' }, { status: 409 })
  }

  await db.profile.update({
    where: { id: profile.id },
    data: {
      accountType,
      businessName,
      displayName,
      // Only set the profile phone if we don't already have a verified one.
      ...(profile.phone ? {} : phone ? { phone } : {}),
    },
  })

  // Business → ensure a storefront exists (name = business, contact phone = rep's).
  if (accountType === 'business') {
    const owned = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } })
    if (owned) {
      await db.seller.update({ where: { id: owned.id }, data: { name: businessName!, ...(phone ? { phone } : {}) } })
    } else {
      // Claim an unowned guest storefront on phone match, else create a new one.
      const byPhone = phone ? await db.seller.findUnique({ where: { phone }, select: { id: true, ownerId: true } }) : null
      try {
        if (byPhone && !byPhone.ownerId) {
          await db.seller.update({ where: { id: byPhone.id }, data: { ownerId: profile.id, name: businessName! } })
        } else {
          await db.seller.create({ data: { name: businessName!, ownerId: profile.id, ...(phone ? { phone } : {}), responseRate: 100 } })
        }
      } catch {
        // Phone already claimed by another seller → create without it (rare).
        await db.seller.create({ data: { name: businessName!, ownerId: profile.id, responseRate: 100 } })
      }
    }
  }

  // Server-side conversion (CompleteRegistration) for Meta ad optimization. Fires
  // AFTER the response flushes (zero added latency) and no-ops until CAPI env is set.
  if (firstOnboard) {
    after(() =>
      sendMetaCapiEvent('CompleteRegistration', {
        eventSourceUrl: req.headers.get('referer') || undefined,
        userData: metaUserDataFromHeaders(req.headers, { phone, externalId: profile.id }),
        customData: { content_name: 'eno_account', status: accountType },
      }),
    )
  }

  return NextResponse.json({ ok: true, accountType })
}
