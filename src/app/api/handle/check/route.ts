import { db } from '@/lib/db'
import { validateHandle } from '@/lib/handle'
import { route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Live availability check for the handle editor (debounced client-side).
// Authed + rate-limited: handles are public identifiers (every claimed one is
// visible at /@name), so this isn't an enumeration oracle — the limit just keeps
// it from being scripted as a bulk name scanner.
//
// ⚠️ WS6 MIGRATION, and this is the shape where the wrapper actually pays: BOTH the auth block and
// the rate-limit block become options, and route() emits exactly the codes this route already
// emitted — `auth_required` 401 and `rate_limited` 429, same strings, same statuses, keyed on the
// caller just as `rateLimit('handle-check', meId, 60, '1 m')` was.
//
// ⚠️ NOT `strict`. The original was fail-open, and this is a public-identifier lookup rather than a
// paid call or a PII reveal — failing it closed during a limiter blip would break the handle editor
// for everyone and protect nothing. The strict/open reasoning lives in src/lib/ratelimit.ts.
//
// ⚠️ `reason: undefined` on the available branch is deliberate and unchanged: JSON.stringify drops
// undefined keys, so the body stays `{handle,valid,available}` exactly as before rather than
// gaining a `"reason":null`. Returning a plain object from the handler serialises identically.
export const GET = route(
  { auth: 'userId', rateLimit: { bucket: 'handle-check', limit: 60, window: '1 m' } },
  async ({ req, userId }) => {
    const h = String(new URL(req.url).searchParams.get('h') || '').trim().toLowerCase().replace(/^@/, '')
    const err = validateHandle(h)
    if (err) return { handle: h, valid: false, available: false, reason: err }

    const row = await db.handle.findUnique({ where: { handle: h }, select: { profileId: true, sellerId: true } })
    // "Available" includes "it's already yours" (either your user or your shop handle)
    // so re-saving the current name doesn't read as taken in the editor.
    if (!row) return { handle: h, valid: true, available: true }
    const mine =
      row.profileId === userId ||
      (row.sellerId !== null &&
        (await db.seller.count({ where: { id: row.sellerId, ownerId: userId } })) > 0)
    return { handle: h, valid: true, available: mine, reason: mine ? undefined : 'taken' }
  },
)
