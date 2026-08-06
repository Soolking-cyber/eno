import { z } from 'zod'
import { db } from '@/lib/db'
import { LANGS } from '@/lib/i18n/langs'
import { logError } from '@/lib/log'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Persist the signed-in user's chosen UI language onto their Profile so server-side
// messages (e.g. moderation notifications) reach them in the right language. Fire-and-
// forget from the language context; a no-op (401) for guests.
//
// ⚠️ FIRST ROUTE ON `route()`, AND IT IS BYTE-IDENTICAL ON THE WIRE. Verified by snapshotting all
// six branches before and after: guest → 401 `auth_required`, malformed JSON → 400 `bad_request`,
// unknown locale → 400 `invalid_locale`, MISSING field → 400 `invalid_locale`, and both 200
// `{"ok":true}` paths. That is the migration contract for all 167 handlers — the wrapper deletes
// the retyped preamble and changes nothing a client can observe.
//
// ⚠️ `auth: 'userId'`, NOT `'profile'`. This route only needs "who is this", and
// `getCurrentProfileId()` verifies the JWT LOCALLY with no auth-server round trip and no DB read;
// `src/lib/admin.ts` warns explicitly against adding work to that path. Reaching for `'profile'`
// because it is the wrapper's obvious mode would have added a Profile read plus lazy provisioning
// to a fire-and-forget call the language context makes on every switch.
const VALID_LOCALES = new Set<string>(LANGS)

/**
 * ⚠️ DELIBERATELY PERMISSIVE — a stricter schema would change the wire.
 * The old code did `String(body.locale || '').trim()` and rejected anything outside LANGS with
 * `invalid_locale`, so a MISSING field and a WRONG field produced the SAME 400 code. Validating
 * with `z.object({ locale: z.string() })` would reject the missing case as `bad_request` instead —
 * a better API and a behaviour change, which is not what this step is for. The membership check
 * therefore stays in the handler, exactly where it was. Tightening it is step 5 of the plan, with
 * the client updated in the same commit.
 */
const Body = z.object({ locale: z.unknown() }).partial()

export const POST = route({ auth: 'userId', body: Body, invalidBodyCode: 'bad_request' }, async ({ userId, body }) => {
  const locale = String(body.locale ?? '').trim()
  if (!VALID_LOCALES.has(locale)) throw new ApiError('invalid_locale', 400)

  // Only write when it actually changed (cheap read first to avoid needless updates).
  const cur = await db.profile.findUnique({ where: { id: userId }, select: { locale: true } })
  if (cur && cur.locale !== locale) {
    await db.profile.update({ where: { id: userId }, data: { locale } }).catch((e) => logError(e, { op: 'profile.saveLocale' }))
  }
  return { ok: true }
})
