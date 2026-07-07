import { NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { TOS_VERSION } from '@/lib/site-legal'
import { getCurrentProfile } from '@/lib/admin'
import { normalizePhone } from '@/lib/phone'
import { phoneTakenByOther } from '@/lib/phone-unique'
import { sendMetaCapiEvent, metaUserDataFromHeaders } from '@/lib/meta-capi'
import { parseAttributionCookie } from '@/lib/attribution'
import { rateLimit } from '@/lib/ratelimit'
import { consolidateSellerHandle, revertToPersonalHandle } from '@/lib/handle'

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
  // Account-type is set once or rarely changed; cap per account so the phone_taken (409)
  // response can't be probed as a "does this number have an account?" oracle.
  const rl = await rateLimit('account-type', profile.id, 12, '1 h')
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
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
      // ToS acceptance record (E-Transactions Law): onboarding is the affirmative
      // "continue = agree" step every account passes through — stamp what was
      // accepted and when. Re-stamps if the user re-onboards under a newer version.
      ...(profile.tosVersion === TOS_VERSION ? {} : { tosAcceptedAt: new Date(), tosVersion: TOS_VERSION }),
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
    // ONE public handle from the business name ("Apple Store" → apple_store) so the
    // storefront is shareable as eno.vn/apple_store. Frees any handle the profile held
    // (a business account gets a single shop handle, not two). Idempotent + best-effort.
    const s = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true, name: true } })
    if (s) await consolidateSellerHandle(s.id, s.name, profile.id)
  } else {
    // Switched to individual ("deleted" the business): drop the shop's business-name
    // handle and fall back to a PERSONAL handle from the display name (numbered if the
    // plain name is taken — "alex" → "alex1"). Keeps ONE handle per account.
    const s = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } })
    await revertToPersonalHandle(profile.id, s?.id ?? null, displayName)
  }

  // First-touch acquisition channel for THIS signup (from the eno_attr cookie set on
  // the visitor's first landing) — powers exact CAC-per-channel in our own DB.
  const attr = firstOnboard ? parseAttributionCookie(req.headers.get('cookie')) : null

  if (firstOnboard) {
    // Persist the channel onto the Profile — AFTER the response flushes (never delays
    // onboarding) and wrapped so a not-yet-migrated DB (columns missing until the
    // schema push runs) can't break signup. Exact + queryable once migrated.
    if (attr) {
      after(async () => {
        try {
          await db.profile.update({
            where: { id: profile.id },
            data: {
              attrSource: attr.source,
              attrMedium: attr.medium,
              attrCampaign: attr.campaign ?? null,
              attrReferrer: attr.referrer ?? null,
              attrLandingAt: attr.landingAt ? new Date(attr.landingAt) : new Date(),
            },
          })
        } catch (e) {
          console.error('[attr] persist failed (run the Profile schema push?)', e)
        }
      })
    }

    // Server-side conversion (CompleteRegistration) for Meta ad optimization. Fires
    // AFTER the response flushes (zero added latency) and no-ops until CAPI env is set.
    after(() =>
      sendMetaCapiEvent('CompleteRegistration', {
        eventSourceUrl: req.headers.get('referer') || undefined,
        userData: metaUserDataFromHeaders(req.headers, { email: profile.email, phone, externalId: profile.id }),
        customData: {
          content_name: 'eno_account',
          status: accountType,
          ...(attr ? { source: attr.source, medium: attr.medium, campaign: attr.campaign } : {}),
        },
      }),
    )
  }

  return NextResponse.json({ ok: true, accountType })
}
