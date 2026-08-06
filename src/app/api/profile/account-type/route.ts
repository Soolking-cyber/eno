import { NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { TOS_VERSION } from '@/lib/site-legal'
import { getVerifiedPhone } from '@/lib/admin'
import { normalizePhone } from '@/lib/phone'
import { phoneTakenByOther } from '@/lib/phone-unique'
import { sendMetaCapiEvent, metaUserDataFromHeaders } from '@/lib/meta-capi'
import { parseAttributionCookie } from '@/lib/attribution'
import { consolidateSellerHandle, revertToPersonalHandle } from '@/lib/handle'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'

const TYPES = new Set(['individual', 'business'])

// Records the one-time account profile chosen right after first sign-in:
//  - individual: their name (the rest of contact is captured when they post).
//  - business:   business name + representative person's name + phone → a Seller
//                storefront is created/claimed now so the dashboard, analytics and
//                "posting as <business>" prefill all work immediately.
// Owner-scoped via getCurrentProfile() (trusts the session, never the client).
//
// ⚠️ WS6 MIGRATION. The auth preamble and the strict limiter become options; every code below is
// unchanged (`auth_required` 401, `rate_limited` 429, then the domain 400/409s).
//
// ⚠️ `auth: 'profile'`, NOT `'userId'`. This is not the wrapper reaching for the heavier mode — the
// handler reads five columns off the row (`accountType` for firstOnboard, `displayName`, `phone`,
// `tosVersion`, `email` for the CAPI payload). `getCurrentProfile()` also LAZILY PROVISIONS the row,
// which the `db.profile.update` below depends on: onboarding is often the very first authenticated
// write an account makes, so `'userId'` would hand back an id with no row and P2025 the update.
//
// ⚠️ NO `body:` SCHEMA, DELIBERATELY. The old parse was `try { … } catch {}` with an empty-object
// fallback, so a MISSING or MALFORMED body falls through to `invalid_account_type` 400 — not
// `bad_request`. A schema would change that code, and the client (onboard-client.tsx) branches on it.
// The hand-coercion (`String(body.x || '')`) stays verbatim for the same reason: it accepts a number
// where zod would reject one.
//
// ⚠️ ONE BRANCH IS NOT BYTE-IDENTICAL: nothing here wrapped the Prisma writes, so a DB rejection was
// an unhandled throw and Next answered its own default 500. route() now catches it and returns
// `{"error":"internal_error"}` 500 — an improvement, but a wire change on the failure path.
export const POST = route(
  {
    auth: 'profile',
    // Account-type is set once or rarely changed; cap per account so the phone_taken (409)
    // response can't be probed as a "does this number have an account?" oracle.
    // ⚠️ strict: FAIL CLOSED. The comment below names the threat, and phoneTakenByOther() further down
    // answers it as a clean boolean — an un-limited caller can enumerate which phone numbers have an
    // account. This route runs once or twice in an account's lifetime, so failing closed during a
    // limiter outage is nearly free. Fixing only the profile editor would just move the oracle here.
    rateLimit: { bucket: 'account-type', limit: 12, window: '1 h', strict: true },
  },
  async ({ req, profile }) => {
  // True only on the genuine FIRST onboarding (accountType still null) → so the
  // CompleteRegistration conversion below isn't re-sent if the type is changed later.
  const firstOnboard = !profile.accountType

  let body: { accountType?: string; businessName?: string; displayName?: string; phone?: string; legalName?: string; legalAddress?: string; idNumber?: string } = {}
  try { body = await req.json() } catch { /* empty body → invalid below */ }

  const accountType = String(body.accountType || '')
  if (!TYPES.has(accountType)) throw new ApiError('invalid_account_type', 400)

  const displayName = String(body.displayName || '').trim().slice(0, 80) || profile.displayName || null
  const businessName = accountType === 'business'
    ? (String(body.businessName || '').trim().slice(0, 120) || null)
    : null
  const phone = normalizePhone(String(body.phone || '')) || profile.phone || null

  if (accountType === 'business' && !businessName) {
    throw new ApiError('business_name_required', 400)
  }

  // ── Legal identity for the individual→business SWITCH (owner directive 2026-07-23;
  //    Đ.29 ND52 collection duty). The prior type comes from the SERVER row (never the
  //    request), so the gate can't be bypassed by lying about the current state. FIRST
  //    onboarding (accountType null) stays lenient per the launch policy — the gate is
  //    on the explicit upgrade, where trading intent is declared; the business editor
  //    keeps collecting/curating these fields afterwards. Values already stored on the
  //    owned storefront satisfy the gate (a business→individual→business round trip
  //    is not re-typed). Validation mirrors src/lib/core/seller.ts EXACTLY (9–13
  //    digits — deliberately the editor's lenient range, launch policy: one rule,
  //    both doors). idNumber never renders publicly. ──
  const legalName = String(body.legalName || '').trim().slice(0, 160) || null
  const legalAddress = String(body.legalAddress || '').trim().slice(0, 240) || null
  const idDigits = String(body.idNumber || '').replace(/\D/g, '')
  if (idDigits && (idDigits.length < 9 || idDigits.length > 13)) {
    throw new ApiError('bad_id_number', 400)
  }
  // One read serves the gate AND the storefront branch below (was a second lookup).
  const ownedSeller = await db.seller.findUnique({
    where: { ownerId: profile.id },
    select: { id: true, legalName: true, legalAddress: true, idNumber: true },
  })
  if (accountType === 'business' && profile.accountType === 'individual') {
    if (!(legalName || ownedSeller?.legalName)) throw new ApiError('legal_name_required', 400)
    if (!(legalAddress || ownedSeller?.legalAddress)) throw new ApiError('legal_address_required', 400)
    if (!(idDigits || ownedSeller?.idNumber)) throw new ApiError('id_number_required', 400)
  }
  // Persisted onto the storefront in every create/claim/update path below; the
  // identityUpdatedAt stamp only moves when a legal field was actually provided.
  const legalData = {
    ...(legalName ? { legalName } : {}),
    ...(legalAddress ? { legalAddress } : {}),
    ...(idDigits ? { idNumber: idDigits } : {}),
    ...(legalName || legalAddress || idDigits ? { identityUpdatedAt: new Date() } : {}),
  }

  // One number ↔ one account: a business rep's phone can't be a number already tied
  // to another account (any format — it's normalized). The user's own phone is fine.
  if (phone && await phoneTakenByOther(phone, profile.id)) {
    throw new ApiError('phone_taken', 409)
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
      // ⚠️ THE SCREEN ABOVE THE BUTTON MUST SAY WHAT IS BEING ACCEPTED — see onboard-client.tsx.
      // These two columns are EVIDENCE of what a person agreed to and when, and until 2026-08-01
      // this wrote them while the onboarding screen mentioned the Terms nowhere at all.
      ...(profile.tosVersion === TOS_VERSION ? {} : { tosAcceptedAt: new Date(), tosVersion: TOS_VERSION }),
    },
  })

  // Business → ensure a storefront exists (name = business, contact phone = rep's).
  if (accountType === 'business') {
    if (ownedSeller) {
      await db.seller.update({ where: { id: ownedSeller.id }, data: { name: businessName!, ...(phone ? { phone } : {}), ...legalData } })
    } else {
      // Claim an unowned guest storefront on a VERIFIED phone match, else create a new one.
      // ⚠️ `phone` here comes from the REQUEST BODY (`body.phone` above), so a match alone proves
      // nothing. Claiming re-parents the storefront and with it every listing, review and rating,
      // redirects all future buyer threads (conversations resolve the seller from Seller.ownerId),
      // and is irreversible — the genuine owner's verified auto-claim in profile.ts requires
      // `ownerId: null`. The `phoneTakenByOther` gate earlier cannot catch it either: it ignores
      // unowned sellers by design, because they are meant to be claimable by whoever VERIFIES the
      // number. So the claim is gated on the caller's auth-confirmed phone, matching the correct
      // implementation at src/lib/profile.ts:71-77 ("Verified phone only, never a self-typed one").
      const byPhone = phone ? await db.seller.findUnique({ where: { phone }, select: { id: true, ownerId: true, phone: true } }) : null
      const verifiedPhone = byPhone && !byPhone.ownerId ? await getVerifiedPhone() : null
      try {
        if (byPhone && !byPhone.ownerId && verifiedPhone && verifiedPhone === byPhone.phone) {
          // Atomic claim-once via the ownerId:null guard, so two racing claims cannot both win.
          const claimed = await db.seller.updateMany({
            where: { id: byPhone.id, ownerId: null },
            data: { ownerId: profile.id, name: businessName!, claimedAt: new Date(), ...legalData },
          })
          // ⚠️ On a LOST race, re-read before creating — Seller.ownerId is @unique, so if our own
          // concurrent request already made one, a blind create throws P2002 and 500s onboarding.
          if (claimed.count === 0 && !(await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } }))) {
            await db.seller.create({ data: { name: businessName!, ownerId: profile.id, ...legalData, responseRate: 100 } })
          }
        } else if (byPhone && !byPhone.ownerId) {
          // Unowned storefront on this number and the caller has not verified it.
          // ⚠️ ASK THEM TO VERIFY rather than silently creating a SECOND, empty storefront. That
          // was the first version of this fix and it is unrecoverable: `Seller.ownerId` is @unique,
          // so the empty row takes their one storefront slot, and the verified auto-claim at
          // src/lib/profile.ts:73-77 is an unguarded `updateMany({ where: { phone, ownerId: null } })`
          // — stamping a second row for the same owner breaks that unique index, the write throws,
          // its `try` swallows it, and the storefront they actually built stays orphaned forever.
          // ⚠️ A RETURNED Response, NOT `throw new ApiError` — and that is not a style choice. This
          // sits INSIDE the try/catch whose catch creates a storefront unconditionally, so an
          // ApiError thrown here would be swallowed by that catch and produce exactly the second
          // empty storefront the comment above forbids. `return` is not intercepted by `catch`;
          // route() passes a returned Response straight through, unchanged.
          return NextResponse.json({ error: 'verify_phone_to_claim' }, { status: 409 })
        } else {
          await db.seller.create({ data: { name: businessName!, ownerId: profile.id, ...(phone ? { phone } : {}), ...legalData, responseRate: 100 } })
        }
      } catch {
        // Phone already claimed by another seller → create without it (rare).
        await db.seller.create({ data: { name: businessName!, ownerId: profile.id, ...legalData, responseRate: 100 } })
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

  return { ok: true, accountType }
  },
)
