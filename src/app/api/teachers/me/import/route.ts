// Fill the teacher form from the teacher's own CV (or LinkedIn profile PDF) — owner, 2026-10-15. Reads the file with
// Gemini on Vertex, maps the answer onto the form's own vocabulary and returns it; stores no file and no text.
// ⛔ eno.vn / www.eno.forum only, signed in: the teacher host has no session and cannot write (src/proxy.ts), and a
// consent record must name a person (PDP Law 91/2025 Art 9; Decree 356/2025 Art 6).
import { createHash, randomUUID } from 'node:crypto'
import { route, ApiError } from '@/lib/api/handler'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { logError, logWarn } from '@/lib/log'
import { appendAudit } from '@/lib/compliance/audit'
import { rateLimit, kv } from '@/lib/ratelimit'
import { AI_GLOBAL_DAILY_LIMIT } from '@/lib/ai-guard'
import { aiErrorStatus } from '@/lib/ai-retry'
import { getGeminiVertex } from '@/lib/gemini'
import { EDITION } from '@/lib/edition'
import { NATIVE_UA_RE } from '@/lib/consent-value'
import { clientIp } from '@/lib/client-ip'
import { IMPORT_MAX_BYTES, IMPORT_MAX_TEXT_CHARS, readImportFile } from '@/lib/teachers/import-file'
import { countDocumentTokens, documentContents, readTeacherDocument, type ImportInput } from '@/lib/teachers/import-ai'
import { IMPORT_FIELDS, mapTeacherImport, type ImportedAnswers } from '@/lib/teachers/import-map'
import { IMPORT_NOTICE_PARTS, TEACHER_IMPORT_NOTICE_VERSION, noticeBody } from '@/lib/teachers/import-notice'
import { EMPTY_TEACHER, normalizeTeacherInput } from '@/lib/teachers/profile'
import { LANGUAGE_CODES } from '@/lib/languages'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** Readings per account — a CV is read once or twice; anything more is a loop or a scraper. */
const PER_HOUR = 6
const PER_DAY = 20
/** The feature's own share of a day's Gemini spend — reached, the door says "not available right now", never "you". */
const FEATURE_PER_DAY = 400
/** Readings per connection a day — a school's shared network fits; a handful of throwaway accounts on one does not drain the day. */
const PER_IP_PER_DAY = 100
/**
 * ⛔ READINGS AT ONCE, ON THIS SERVER (gate review, 2026-10-16): the day caps bound totals, not simultaneous load — and each
 * reading holds an upload of up to 8 MB (copied a few times) and may decode an image. One Node process per edition
 * serves this route, so a plain counter is exact (no await between its check and its increment).
 */
const MAX_IN_FLIGHT = 6
let inFlight = 0
/** A CV is ~1-5k tokens; a PDF page ~560. Above this it is not a CV (or not only one). */
const MAX_INPUT_TOKENS = 40_000
/** Past this, a PDF whose tokens could not be counted waits for a count (see the route). */
const UNCOUNTED_PDF_MAX_BYTES = 2 * 1024 * 1024
const CONSENT_LOCK_TIMEOUT = '1000ms'
const NOTICE_SHA = createHash('sha256').update(noticeBody(IMPORT_NOTICE_PARTS)).digest('hex').slice(0, 16)
/** The page's language when the teacher agreed — any of the eleven (en, vi as authored; the others machine-translated). */
const LANGS: ReadonlySet<string> = new Set(LANGUAGE_CODES)

/** A body still arriving after this is refused — a slow upload never outlives the account's lock (see the route). */
const BODY_DEADLINE_MS = 60_000

/**
 * The request body, or 'too_big' the moment it passes `cap` bytes, or 'too_slow' past BODY_DEADLINE_MS (the stream is
 * cancelled either way). As teachers/me/cv, with the deadline.
 */
async function readCapped(req: Request, cap: number): Promise<Uint8Array | 'too_big' | 'too_slow'> {
  const reader = req.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  const deadline = Date.now() + BODY_DEADLINE_MS
  for (;;) {
    const left = deadline - Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    const next = await Promise.race([
      reader.read(),
      new Promise<'too_slow'>((resolve) => { timer = setTimeout(() => resolve('too_slow'), Math.max(0, left)) }),
    ]).finally(() => clearTimeout(timer))
    if (next === 'too_slow') { await reader.cancel().catch((e) => logError(e, { op: 'teachers.import.cancel' })); return 'too_slow' }
    const { done, value } = next
    if (done) break
    total += value.byteLength
    if (total > cap) { await reader.cancel().catch((e) => logError(e, { op: 'teachers.import.cancel' })); return 'too_big' }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.byteLength }
  return out
}

/**
 * The model's failure as the teacher's next step. ⛔ Logged as its NAME and STATUS only — never its message: a parse
 * error quotes the reply, and the reply is the CV (plan review, 2026-10-15).
 */
function modelFailure(e: unknown): ApiError {
  const status = aiErrorStatus(e)
  logWarn('[teacher-import] model failed', { name: (e as Error)?.name ?? typeof e, status })
  if (status === 413) return new ApiError('import_too_long', 413)
  return status === 400 || status === 422 ? new ApiError('import_unreadable', 422) : new ApiError('import_failed', 502)
}

async function audit(profileId: string, action: string, detail: Prisma.InputJsonObject) {
  await db.$transaction(async (tx) => {
    // A bounded wait on the log's advisory lock — the consent route's rule (src/app/api/consent/route.ts).
    await tx.$executeRaw`SELECT set_config('lock_timeout', ${CONSENT_LOCK_TIMEOUT}, true)`
    await appendAudit(tx, { actorType: 'user', actorId: profileId, action, subjectType: 'profile', subjectId: profileId, detail })
  }, { maxWait: 1_000 })
}

export const POST = route({ auth: 'profile' }, async ({ req, profile }) => {
  const ai = getGeminiVertex()
  if (!ai) throw new ApiError('import_unavailable', 503)

  // A published teacher edits their profile; the import fills a NEW one (the same refusal as the draft, draft.ts).
  if (await db.teacherProfile.findUnique({ where: { profileId: profile.id }, select: { id: true } })) throw new ApiError('teacher_exists', 409)

  // ⛔ ONE READING AT A TIME PER ACCOUNT — taken BEFORE the body is read (gate review, 2026-10-16): a second upload from
  // the same account is refused unread, so one account never holds several 8 MB bodies, or decodes several images, at
  // once — and a double tap never pays twice. It outlives any request (the body 60 s at most, the count 6 s, the two
  // model attempts 40 + 25 s), and it is OWNED: released only while it still holds this request's token, so a request
  // that somehow ran past it can never free a later request's lock.
  const busyKey = `teacher-import:busy:${profile.id}`
  const busyToken = randomUUID()
  if ((await kv.set(busyKey, busyToken, { nx: true, ex: 240 })) !== 'OK') throw new ApiError('import_busy', 429)
  let counted = false
  try {
    if (inFlight >= MAX_IN_FLIGHT) throw new ApiError('import_capacity', 503)
    inFlight++
    counted = true
    // ⛔ ONE AFTER ANOTHER, NEVER Promise.all — a denied attempt still counts (ratelimit.ts), so a capped account must
    // never reach the next counter. After the lock: a double tap is refused by it and spends none of these. The
    // account's own limits first; the shared ones only once the file is known to be one.
    if (!(await rateLimit('teacher-import', profile.id, PER_HOUR, '1 h', { strict: true })).success) throw new ApiError('import_rate_hour', 429)
    if (!(await rateLimit('teacher-import-day', profile.id, PER_DAY, '1 d', { strict: true })).success) throw new ApiError('import_rate_day', 429)
    // ⛔ A connection's own day cap, before the body is read (gate review, 2026-10-16): sign-in is passwordless, so a few
    // throwaway accounts on one connection could otherwise spend the whole feature's day — or the box's memory. Said as
    // "busy right now", never "your limit": a school's or a carrier's shared network can reach it first.
    if (!(await rateLimit('teacher-import-ip', clientIp(req), PER_IP_PER_DAY, '1 d', { strict: true })).success) throw new ApiError('import_capacity', 503)
    const cap = IMPORT_MAX_BYTES + 64 * 1024
    if (Number(req.headers.get('content-length') || 0) > cap) throw new ApiError('import_size', 413)
    const raw = await readCapped(req, cap)
    if (raw === 'too_big') throw new ApiError('import_size', 413)
    if (raw === 'too_slow') throw new ApiError('import_failed', 408)
    const form = await new Response(Buffer.from(raw), { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData().catch(() => null)
    if (!form) throw new ApiError('bad_request', 400)
    if (form.get('notice') !== TEACHER_IMPORT_NOTICE_VERSION) return Response.json({ error: 'notice_changed', notice: 'import' }, { status: 409, headers: { 'cache-control': 'private, no-store' } })
    const lang = LANGS.has(String(form.get('lang'))) ? String(form.get('lang')) : 'en'
    const shownSha = /^[0-9a-f]{64}$/.test(String(form.get('shown'))) ? String(form.get('shown')) : null

    let input: ImportInput
    const file = form.get('file')
    const text = form.get('text')
    if (file instanceof File) {
      if (file.size > IMPORT_MAX_BYTES) throw new ApiError('import_size', 413)
      const read = await readImportFile(new Uint8Array(await file.arrayBuffer()))
      if (typeof read === 'string') {
        if (read === 'import_locked') throw new ApiError('import_locked', 422)
        if (read === 'import_too_long') throw new ApiError('import_too_long', 413)
        throw new ApiError('import_type', 415)
      }
      input = read
    } else if (typeof text === 'string') {
      // Measured as the browser counted it: multipart encoding turns every LF into CRLF on the way (HTML spec), so the raw
      // length grows with the line count and a Word CV cut to the cap would be refused (review, 2026-10-16).
      const lf = text.replace(/\r\n/g, '\n')
      if (lf.length > IMPORT_MAX_TEXT_CHARS) throw new ApiError('import_too_long', 413)
      if (lf.replace(/\s+/g, '').length < 40) throw new ApiError('import_type', 415)
      input = { kind: 'text', text: lf }
    } else {
      throw new ApiError('bad_request', 400)
    }

    // The day's caps once the file is known to be one (type, size, pages, encryption) — never spent on junk, so nobody
    // can switch the feature off for everyone with bad files. A file the token count then refuses still counts.
    if (!(await rateLimit('teacher-import-global', 'all', FEATURE_PER_DAY, '1 d', { strict: true })).success) throw new ApiError('import_capacity', 503)
    // One unit per READING: the free token count and a fallback attempt after a failure ride on it (the feature's own
    // 400 a day is the bound that matters for this route).
    if (!(await rateLimit('ai-global', 'global', AI_GLOBAL_DAILY_LIMIT, '1 d', { strict: true })).success) throw new ApiError('import_capacity', 503)

    // ⛔ THE CONSENT RECORD BEFORE THE TRANSFER (Decree 356 Art 6.1–6.2: the controller proves the consent) — before ANY
    // call that carries the file: counting its tokens sends it to Google too (review, 2026-10-16: the count once ran
    // first, so a refused or failed consent write still let the CV leave). If this write fails, the file does not leave.
    const readId = randomUUID()
    const host = req.headers.get('host') ?? ''
    const native = NATIVE_UA_RE.test(req.headers.get('user-agent') || '')
    try {
      await audit(profile.id, 'teacher.import.consent', {
        // `translated`: the page was read in one of the nine machine-translated languages — `noticeSha` names the English
        // and Vietnamese words it was translated FROM; `shownSha` is the page's own hash of the words it SHOWED (sent by
        // the page, so as the page reports it — gate review, 2026-10-16).
        readId, notice: TEACHER_IMPORT_NOTICE_VERSION, noticeSha: NOTICE_SHA, shownSha, kind: input.kind, lang, translated: lang !== 'en' && lang !== 'vi', edition: EDITION, host, native,
        recipient: 'Google Cloud (Vertex AI, Gemini)', location: process.env.GEMINI_LOCATION || 'global',
      })
    } catch (e) {
      logWarn('[teacher-import] consent record failed', { name: (e as Error)?.name })
      throw new ApiError('import_failed', 503)
    }

    const contents = documentContents(input)
    const tokens = await countDocumentTokens(ai, contents)
    // ⛔ AN UNCOUNTED FILE IS NOT AN UNLIMITED ONE (gate review, 2026-10-16): the count fails open (a timeout, an outage),
    // and the rough page count cannot see pages inside compressed object streams — so a LARGE PDF nobody could count is
    // not read now; the teacher tries again (a CV PDF is rarely over 2 MB).
    if (tokens === null && input.kind === 'pdf' && input.data.length > UNCOUNTED_PDF_MAX_BYTES) {
      await audit(profile.id, 'teacher.import.result', { readId, outcome: 'uncounted' }).catch((e) => logError(e, { op: 'teachers.import.result' }))
      throw new ApiError('import_failed', 503)
    }
    if (tokens !== null && tokens > MAX_INPUT_TOKENS) {
      await audit(profile.id, 'teacher.import.result', { readId, outcome: 'too_long' }).catch((e) => logError(e, { op: 'teachers.import.result' }))
      throw new ApiError('import_too_long', 413)
    }

    let answer: Awaited<ReturnType<typeof readTeacherDocument>>
    try {
      answer = await readTeacherDocument(ai, contents)
    } catch (e) {
      // (A failed write here is logged by its own message — the detail holds the read id and the outcome, nothing of the file.)
      await audit(profile.id, 'teacher.import.result', { readId, outcome: 'failed' }).catch((e) => logError(e, { op: 'teachers.import.result' }))
      throw modelFailure(e)
    }

    const mapped = mapTeacherImport(answer.raw, { now: new Date() })
    // ⛔ Normalised as a FULL body — a partial has no teachAreas and would be read as the pre-redesign shape, dropping the
    // English level and the band (profile.ts isLegacyTeacherBody; plan review). Only the keys the import produced stay.
    let fields: ImportedAnswers = {}
    if (mapped) {
      const normal = normalizeTeacherInput({ ...EMPTY_TEACHER, ...mapped.fields })
      fields = Object.fromEntries(IMPORT_FIELDS.filter((k) => k in mapped.fields).map((k) => [k, normal[k]])) as ImportedAnswers
    }
    const filled = Object.keys(fields)
    const outcome = !mapped ? 'not_cv' : filled.length ? 'filled' : 'empty'
    // Best effort, on purpose: the file has been read by now, and a failed outcome row must not cost the teacher the
    // answers (the consent row — the one the law asks for — was written first, or nothing was read).
    await audit(profile.id, 'teacher.import.result', { readId, outcome, model: answer.model, filled }).catch((e) => {
      logWarn('[teacher-import] outcome record failed', { name: (e as Error)?.name })
    })

    const body = !mapped || !filled.length
      ? { import: null, reason: !mapped ? 'not_cv' : 'empty' }
      : { import: { source: mapped.source, fields, phone: mapped.phone, skippedJobs: mapped.skippedJobs } }
    return Response.json(body, { headers: { 'cache-control': 'private, no-store' } })
  } finally {
    if (counted) inFlight--
    // Still ours? (A check then a delete — the window between them is a few ms, against a lock held for minutes.)
    await kv.get<string>(busyKey)
      .then((held) => (held === busyToken ? kv.del(busyKey) : undefined))
      .catch((e) => logError(e, { op: 'teachers.import.unlock' }))
  }
})
