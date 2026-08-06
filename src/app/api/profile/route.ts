import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { containsPhoneNumber, normalizePhone } from '@/lib/phone'
import { phoneTakenByOther } from '@/lib/phone-unique'
import { isListingImageUrl } from '@/lib/listing-image'
import { containsContactInfo } from '@/lib/publish-guard'
import { rateLimit } from '@/lib/ratelimit'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Edit the signed-in user's OWN profile (the person/account — distinct from the
// business storefront, which is PATCH /api/seller). For an individual this is
// their account; for a business it's the representative behind the account.
//
// ⚠️ WS6 MIGRATION — THE AUTH PREAMBLE ONLY. The limiter deliberately does NOT move into
// `rateLimit:`, because its `strict` flag is computed from the PARSED BODY (`body.phone !== undefined`)
// and the wrapper's option is a static config applied BEFORE the body is read. Hoisting it would
// force one blanket choice: strict-always blocks ordinary name/avatar edits during a limiter blip,
// open-always re-opens the phone-existence oracle the comment below exists to close. So the parse
// stays first and the limiter stays in the handler, in exactly the order it ran before.
//
// ⚠️ `auth: 'profile'`: the old code called `getCurrentProfile()`, which lazily provisions the row
// this handler then updates. Only `profile.id` is read, so `'userId'` looks cheaper — but it would
// return an id for a JWT whose Profile row does not exist yet and P2025 the update.
//
// ⚠️ NO `body:` SCHEMA. Malformed JSON answers `{"error":"Invalid body"}` — not an ApiErrorCode, so
// it cannot be `invalidBodyCode`, and tidying it to `invalid_body` would be a silent wire change.
// The per-field hand-coercion also stays: `String(body.displayName)` accepts a number where a zod
// schema would 400.
//
// ⚠️ ONE BRANCH IS NOT BYTE-IDENTICAL: the `throw e` re-raise on a non-P2002 Prisma error used to
// reach Next's default 500. route() now catches it, logs with an `op`, and returns
// `{"error":"internal_error"}` 500 — an improvement, but a wire change on that failure path.
export const PATCH = route({ auth: 'profile' }, async ({ req, profile }) => {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  // The distinct 409 phone_taken response is an account-existence oracle; throttle
  // so it can't be looped to enumerate which phone numbers have eno.vn accounts.
  // ⚠️ STRICT ONLY WHEN A PHONE IS BEING SET, and the body parse moved above this line to make
  // that possible. The limiter fails OPEN by default, so an rl_check outage un-capped exactly the
  // oracle this comment exists to close: loop PATCH with {phone: <candidate>} and read a clean
  // boolean for "does this number have an account?". Failing the whole route closed would be the
  // blunt fix and would block ordinary display-name and avatar edits during a limiter blip for no
  // security gain — so only the branch that answers the oracle is strict.
  const rl = await rateLimit('profile-update', profile.id, 20, '1 h', { strict: body.phone !== undefined })
  if (!rl.success) throw new ApiError('rate_limited', 429)

  const data: Record<string, unknown> = {}
  if (body.displayName !== undefined) {
    const name = String(body.displayName).trim().slice(0, 80)
    if (name.length < 2) throw new ApiError('name_too_short', 400)
    if (containsPhoneNumber(name)) throw new ApiError('no_phone_in_name', 400)
    // ⚠️ This screened for a PHONE but not for an EMAIL, while the publish gate rejects
    // both — so the app happily saved a display name it would later refuse to publish
    // with, and the seller got a "fix your listing" error on a clean listing. The two
    // rules must stay symmetric: displayName is public (chat counterparty, review author,
    // listing contact), so contact info in it is the same leak either way.
    if (containsContactInfo(name)) throw new ApiError('no_contact_in_name', 400)
    data.displayName = name
  }
  if (body.avatarUrl !== undefined) {
    const url = body.avatarUrl ? String(body.avatarUrl) : null
    if (url && !isListingImageUrl(url)) throw new ApiError('bad_avatar', 400)
    data.avatarUrl = url
  }
  if (body.phone !== undefined) {
    const phone = normalizePhone(String(body.phone || ''))
    if (body.phone && phone.replace(/\D/g, '').length < 9) throw new ApiError('bad_phone', 400)
    // One number ↔ one account (any format). Reject if another account already uses
    // it — as their profile phone or storefront contact.
    if (phone && await phoneTakenByOther(phone, profile.id)) throw new ApiError('phone_taken', 409)
    data.phone = phone || null
  }

  if (Object.keys(data).length === 0) return { ok: true }
  try {
    await db.profile.update({ where: { id: profile.id }, data })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') throw new ApiError('phone_taken', 409)
    throw e
  }
  return { ok: true }
})
