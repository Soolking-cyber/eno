import { db } from '@/lib/db'
import { subdomainKeyHolders, validateHandle } from '@/lib/handle'
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

    // ⚠️ EVERY HOLDER OF `h`'s SUBDOMAIN KEY, not just of `h` (SEO wave B, I2b): with `sdc_store`
    // held, `sdcstore` is taken too, because both would be `sdcstore.eno.vn` — and `claimHandle`
    // refuses it, so an editor that said "available" would only fail on Save.
    // ⚠️ "MINE" MEANS THE ROW `claimHandle` WILL FREE, i.e. THE EDITOR'S OWN TARGET (review of I2b):
    // it deletes only that owner's current handle before the subdomain-key check, so your PROFILE's
    // `sdcstore` still blocks your SHOP claiming `sdc_store`. Counting any of your rows as yours said
    // "available" and Save then answered 409. Without `target` (an older client) the old answer —
    // either of your rows — stands.
    const target = new URL(req.url).searchParams.get('target')
    const rows = await subdomainKeyHolders(h)
    // "Available" includes "it's already yours" so re-saving the current name — or re-spelling it —
    // doesn't read as taken in the editor.
    if (!rows.length) return { handle: h, valid: true, available: true }
    const isMine = async (row: { profileId: string | null; sellerId: string | null }) => {
      if (target !== 'seller' && row.profileId === userId) return true
      if (target === 'profile' || row.sellerId === null) return false
      return (await db.seller.count({ where: { id: row.sellerId, ownerId: userId } })) > 0
    }
    let mine = true
    for (const row of rows) {
      if (await isMine(row)) continue
      mine = false
      break
    }
    return { handle: h, valid: true, available: mine, reason: mine ? undefined : 'taken' }
  },
)
