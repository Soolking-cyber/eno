// "Improve with AI" under the teacher's About text — owner, 2026-10-21: "add ai enhancement once they write about them
// use ai with best practices of self introduction description so it will help teachers to land on jobs it should read
// all teacher info that was inputed and description they have and enhance it in short concise but very effective form
// use gemini 3.8 flash as in other places". Rewrites the About text from the form's CURRENT answers (the body: a new
// teacher has only a draft) with Gemini on Vertex and returns the text; stores no text. What is sent and what comes
// back: src/lib/teachers/bio-context.ts; the instruction and the call: bio-ai.ts; the words beside the button: bio-notice.ts.
// ⛔ Vertex only (getGeminiVertex, as every teacher AI path: the notice promises Google Cloud processing not used for
// training). Nothing stored — no profile, draft or listing write: the teacher's own Save keeps the text — and nothing of
// the answers, the text or the reply logged (names, statuses and counts only). The consent record BEFORE anything leaves
// (PDP Law 91/2025 Art 9; Decree 356/2025 Art 6). Never the teacher's own text handed back as a rewrite (the rephrase
// route's fallback): an answer that is not one is a 502.
// ⛔ Signed in: the About step renders only signed in (teacher.eno.vn shows only 'plans' — profile.ts PRE_SIGNIN_STEPS),
// the limits are per account, and a consent record must name a person. No edition or host gate: the teacher API routes
// answer on both editions (CLAUDE.md gates only visa, itinerary and PayPal); the record's `host` is the public one —
// nginx forwards it (infra/vn-node/nginx/proxy-params.conf `proxy_set_header Host $host`), only our zones reach it.
import { createHash, randomUUID } from 'node:crypto'
import { route, ApiError } from '@/lib/api/handler'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { logError, logWarn } from '@/lib/log'
import { appendAudit } from '@/lib/compliance/audit'
import { rateLimit, kv } from '@/lib/ratelimit'
import { chargeAiTeacherReserve } from '@/lib/ai-guard'
import { aiErrorStatus } from '@/lib/ai-retry'
import { getGeminiVertex } from '@/lib/gemini'
import { EDITION } from '@/lib/edition'
import { NATIVE_UA_RE } from '@/lib/consent-value'
import { clientIp } from '@/lib/client-ip'
import { rewriteTeacherBio } from '@/lib/teachers/bio-ai'
import { BIO_OWN_TEXT_MIN, teacherBioRequest } from '@/lib/teachers/bio-context'
import { TEACHER_BIO_NOTICE_VERSION, bioNoticeBody } from '@/lib/teachers/bio-notice'
import { wordCount } from '@/lib/teachers/search-floor'
import { TEACHER_DRAFT_MAX_BYTES } from '@/lib/teachers/draft'
import { LANGUAGE_CODES } from '@/lib/languages'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Rewrites per account — a teacher taps it once or twice, and again after an edit; anything more is a loop. */
const PER_HOUR = 10
const PER_DAY = 30
/** The feature's own share of a day's Gemini spend — reached, the button says "not available right now", never "you". */
const FEATURE_PER_DAY = 1_000
/** Rewrites per connection a day — a school's shared network fits; a handful of throwaway accounts on one does not drain the day. */
const PER_IP_PER_DAY = 100
const CONSENT_LOCK_TIMEOUT = '1000ms'
const NOTICE_SHA = createHash('sha256').update(bioNoticeBody()).digest('hex').slice(0, 16)
/** The page's language when the teacher agreed — any of the eleven (en, vi as authored; the others machine-translated). */
const LANGS: ReadonlySet<string> = new Set(LANGUAGE_CODES)

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** The answers and an About text are a few KB — the draft route's cap (a whole answer set, four times over). */
const MAX_BODY_BYTES = TEACHER_DRAFT_MAX_BYTES * 4
/**
 * The body, read only up to `max` bytes — the draft route's reader (teachers/me/draft): a chunked, unlabelled or
 * mislabelled body never buffers past it. null: over the cap.
 */
async function readCapped(req: Request, max: number): Promise<string | null> {
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) { await reader.cancel().catch((e) => logError(e, { op: 'teachers.bio.bodyCancel' })); return null }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** The CV import's record writer (teachers/me/import): one row in the compliance log, with a bounded wait for its lock. */
async function audit(profileId: string, action: string, detail: Prisma.InputJsonObject) {
  await db.$transaction(async (tx) => {
    // A bounded wait on the log's advisory lock — the consent route's rule (src/app/api/consent/route.ts).
    await tx.$executeRaw`SELECT set_config('lock_timeout', ${CONSENT_LOCK_TIMEOUT}, true)`
    await appendAudit(tx, { actorType: 'user', actorId: profileId, action, subjectType: 'profile', subjectId: profileId, detail })
  }, { maxWait: 1_000 })
}

export const POST = route({ auth: 'profile' }, async ({ req, profile }) => {
  const ai = getGeminiVertex()
  if (!ai) throw new ApiError('ai_unavailable', 503)

  // A small JSON body (the form's answers, an About text of at most LIMITS.bio), checked BEFORE the lock and the limits:
  // a malformed, stale or empty request is refused for free and never holds the account's lock — and read only up to
  // MAX_BODY_BYTES (gate review, codex + opus 2026-10-22: an unbounded body was parsed before any limit).
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY_BYTES) throw new ApiError('payload_too_large', 413)
  const text = await readCapped(req, MAX_BODY_BYTES)
  if (text === null) throw new ApiError('payload_too_large', 413)
  let body: unknown = null
  try { body = JSON.parse(text) } catch { /* not JSON — bad_request below */ }
  if (!isRecord(body) || !isRecord(body.t)) throw new ApiError('bad_request', 400)
  if (body.notice !== TEACHER_BIO_NOTICE_VERSION) return Response.json({ error: 'notice_changed', notice: 'bio' }, { status: 409, headers: { 'cache-control': 'private, no-store' } })
  // The teacher's own words come first: the button shows from BIO_OWN_TEXT_MIN characters (the post wizard's Polish floor).
  const own = typeof body.t.bio === 'string' ? body.t.bio.trim() : ''
  if (own.length < BIO_OWN_TEXT_MIN) throw new ApiError('too_short', 400)
  // The answers as the model will see them: normalised as a save keeps them and read field by field — whatever else
  // the body carries (a name, a phone, a salary) never reaches it (bio-context.ts). Nothing to write from — an About
  // text that was only contact details, and no answers — is refused here, for free (gate review, 2026-10-21).
  const request = teacherBioRequest(body.t)
  if (!request.facts.length && !request.ownBio) throw new ApiError('too_short', 400)
  const lang = LANGS.has(String(body.lang)) ? String(body.lang) : 'en'
  const shownSha = /^[0-9a-f]{64}$/.test(String(body.shown)) ? String(body.shown) : null

  // ⛔ ONE REWRITE AT A TIME PER ACCOUNT: a second tap — another tab, a retry while the first still runs — is refused
  // before any limit is spent, so a double tap never pays twice. It outlives any request (maxDuration 60 s; the
  // rewrite's own deadline 50 s — bio-ai.ts), and it is OWNED: released only while it still holds this request's token,
  // so a request that somehow ran past it can never free a later request's lock (the CV import's lock).
  const busyKey = `teacher-bio:busy:${profile.id}`
  const busyToken = randomUUID()
  if ((await kv.set(busyKey, busyToken, { nx: true, ex: 90 })) !== 'OK') throw new ApiError('rate_limited', 429)
  try {
    // ⛔ ONE AFTER ANOTHER, NEVER Promise.all — a denied attempt still counts (ratelimit.ts), so a capped account must
    // never reach the next counter. The account's own limits first; the shared ones last.
    if (!(await rateLimit('teacher-bio', profile.id, PER_HOUR, '1 h', { strict: true })).success) throw new ApiError('rate_limited', 429)
    if (!(await rateLimit('teacher-bio-day', profile.id, PER_DAY, '1 d', { strict: true })).success) throw new ApiError('rate_limited', 429)
    // ⛔ A connection's own day cap: sign-in is passwordless, so a few throwaway accounts on one connection could
    // otherwise spend the whole feature's day. Said as "not available right now", never "your limit": a school's or a
    // carrier's shared network can reach it first.
    if (!(await rateLimit('teacher-bio-ip', clientIp(req), PER_IP_PER_DAY, '1 d', { strict: true })).success) throw new ApiError('ai_unavailable', 503)
    // The day's shared caps. One unit per TAP: the hedge's second 3.8 Flash, the Flash-Lite fallback and the one retry
    // after a refused answer all ride on it (bio-ai.ts) — the feature's own 1,000 a day is the bound that matters here.
    if (!(await rateLimit('teacher-bio-global', 'all', FEATURE_PER_DAY, '1 d', { strict: true })).success) throw new ApiError('ai_unavailable', 503)
    // Teacher onboarding's RESERVED budget, not the shared pool (security review item 19): a busy day for the other AI
    // features can no longer block teachers from finishing their profile.
    if (!(await chargeAiTeacherReserve())) throw new ApiError('ai_unavailable', 503)

    // ⛔ THE CONSENT RECORD BEFORE THE TRANSFER (Decree 356 Art 6.1–6.2: the controller proves the consent) — the CV
    // import's record, with what was sent as COUNTS and FLAGS only, never a word of it. If this write fails, nothing leaves.
    const readId = randomUUID()
    const host = req.headers.get('host') ?? ''
    const native = NATIVE_UA_RE.test(req.headers.get('user-agent') || '')
    try {
      await audit(profile.id, 'teacher.bio.consent', {
        // `translated`: the page was read in one of the nine machine-translated languages — `noticeSha` names the English
        // and Vietnamese words it was translated FROM; `shownSha` is the page's own hash of the words it SHOWED (sent by
        // the page, so as the page reports it).
        readId, notice: TEACHER_BIO_NOTICE_VERSION, noticeSha: NOTICE_SHA, shownSha, lang, translated: lang !== 'en' && lang !== 'vi', edition: EDITION, host, native,
        recipient: 'Google Cloud (Vertex AI, Gemini)', location: process.env.GEMINI_LOCATION || 'global',
        facts: request.facts.length, ownText: request.ownBio.length > 0,
      })
    } catch (e) {
      logWarn('[teacher-bio] consent record failed', { name: (e as Error)?.name })
      throw new ApiError('ai_unavailable', 503)
    }

    // Written in the language of the teacher's own text; the page's (Vietnamese, else English) only when there is none.
    const result = await rewriteTeacherBio(ai, request, { fallback: lang === 'vi' ? 'Vietnamese' : 'English' })
    // Best effort, on purpose: the text has been sent by now, and a failed outcome row must not cost the teacher the
    // rewrite (the consent row — the one the law asks for — was written first, or nothing was sent).
    const outcome = result.ok
      ? { outcome: 'ok', model: result.model, calls: result.calls, words: wordCount(result.bio) }
      : result.failure === 'rejected' ? { outcome: 'rejected', reason: result.reason, calls: result.calls } : { outcome: 'failed', calls: result.calls }
    await audit(profile.id, 'teacher.bio.result', { readId, ...outcome }).catch((e) => {
      logWarn('[teacher-bio] outcome record failed', { name: (e as Error)?.name })
    })
    if (!result.ok) {
      // ⛔ The failure's KIND only — the gate's reason, or the model error's NAME and STATUS, never its message: a parse
      // error quotes the reply, and the reply is the teacher's text rewritten.
      logWarn('[teacher-bio] no rewrite', {
        failure: result.failure,
        reason: result.failure === 'rejected' ? result.reason : null,
        calls: result.calls,
        name: result.failure === 'model' ? ((result.error as Error)?.name ?? typeof result.error) : null,
        status: result.failure === 'model' ? aiErrorStatus(result.error) : null,
      })
      throw new ApiError('ai_failed', 502)
    }
    return Response.json({ bio: result.bio, model: result.model }, { headers: { 'cache-control': 'private, no-store' } })
  } finally {
    // Still ours? (A check then a delete — the CV import's unlock, teachers/me/import. kv has no compare-and-delete; the
    // window between the two is a few ms, and only a request that ran its whole 90 s lease could lose it in there — this
    // one ends inside ~55 s: the rewrite's 50 s deadline, and every call bounded by the SDK's own timeout.)
    await kv.get<string>(busyKey)
      .then((held) => (held === busyToken ? kv.del(busyKey) : undefined))
      .catch((e) => logError(e, { op: 'teachers.bio.unlock' }))
  }
})
