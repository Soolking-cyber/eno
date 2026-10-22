import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { logError } from '@/lib/log'
import { TEACHER_DRAFT_MAX_BYTES, deleteTeacherDraft, parseDraftGen, readTeacherDraft, saveTeacherDraft } from '@/lib/teachers/draft'

/**
 * /api/teachers/me/draft — the signed-in teacher's UNFINISHED profile (owner, 2026-10-11: "every step they input should be
 * saved and able to resume when they want to"). The rules are src/lib/teachers/draft.ts: what a draft may hold (never a
 * consent, an upload, the cover switch or the phone), the revision every save compares and bumps, and the publish's lock.
 * Nothing here is public, and a save does nothing else — no moderation, translation, matcher, analytics or Meta event.
 *   GET    → { draft: { t, step, rev, gen, updatedAt } | null }   (gen: the draft's generation — see draft.ts)
 *   PUT    { t, step, rev, gen } → { rev, gen, updatedAt } | 409 draft_stale (another tab or device saved since `rev`) | 409 draft_gone
 *          (discarded, published or expired — a late save never brings it back) | 409 teacher_exists | 413 payload_too_large
 *   DELETE ?rev=&gen= → "Start over", of the revision (and generation) the tab saw — 409 draft_stale otherwise
 * Its own bucket, NOT strict: an autosave every few seconds is normal use, and a strict bucket counts refused attempts.
 */
const PRIVATE = { 'Cache-Control': 'private, no-store' }
/** A whole answer set is far smaller (draft.ts TEACHER_DRAFT_MAX_BYTES); a body past this is not a teacher typing. */
const MAX_BODY_BYTES = TEACHER_DRAFT_MAX_BYTES * 4

/**
 * The body, read only up to `max` bytes — ⛔ a chunked, unlabelled or mislabelled body never buffers past it (commit gate,
 * codex: the Content-Length check alone trusts the client). null: over the cap.
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
    if (total > max) { await reader.cancel().catch((e) => logError(e, { op: 'teachers.draft.bodyCancel' })); return null }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}
const LIMIT = { bucket: 'teacher-draft', limit: 600, window: '1 h' } as const

export const GET = route({ auth: 'profile' }, async ({ profile }) => {
  const d = await readTeacherDraft(profile.id)
  return NextResponse.json(
    { draft: d ? { t: d.t, ...(d.optInsOff?.length ? { optInsOff: d.optInsOff } : {}), step: d.step, rev: d.rev, gen: d.gen, updatedAt: d.updatedAt.toISOString() } : null },
    { headers: PRIVATE },
  )
})

export const PUT = route({ auth: 'profile', rateLimit: LIMIT }, async ({ req, profile }) => {
  // A body far past any answer set is refused before it is read — by its label, and again as it streams in.
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413, headers: PRIVATE })
  }
  const text = await readCapped(req, MAX_BODY_BYTES)
  if (text === null) return NextResponse.json({ error: 'payload_too_large' }, { status: 413, headers: PRIVATE })
  let body: unknown
  try { body = JSON.parse(text) } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400, headers: PRIVATE }) }
  const r = await saveTeacherDraft(profile.id, body)
  if (r.ok) return NextResponse.json({ rev: r.rev, gen: r.gen, updatedAt: r.updatedAt.toISOString() }, { headers: PRIVATE })
  // Each refusal spelled out (src/lib/api/errors.ts reads the codes off the routes).
  if (r.reason === 'bad_request') return NextResponse.json({ error: 'bad_request' }, { status: 400, headers: PRIVATE })
  if (r.reason === 'too_large') return NextResponse.json({ error: 'payload_too_large' }, { status: 413, headers: PRIVATE })
  if (r.reason === 'teacher_exists') return NextResponse.json({ error: 'teacher_exists' }, { status: 409, headers: PRIVATE })
  if (r.reason === 'gone') return NextResponse.json({ error: 'draft_gone' }, { status: 409, headers: PRIVATE })
  return NextResponse.json({ error: 'draft_stale' }, { status: 409, headers: PRIVATE })
})

export const DELETE = route({ auth: 'profile', rateLimit: LIMIT }, async ({ req, profile }) => {
  // `?rev=` — the revision the tab saw: a newer one saved elsewhere is not deleted unseen (409 draft_stale). ⛔ REQUIRED
  // and checked here (commit gate, codex + opus 2026-10-11): a missing or malformed one is a 400, never the internal
  // "whatever is there" delete — an older tab must not erase a newer draft.
  const q = new URL(req.url).searchParams
  const raw = q.get('rev')
  const rev = raw !== null && /^\d{1,9}$/.test(raw) ? Number(raw) : null
  const gen = parseDraftGen(q.get('gen'))
  if (rev === null || !gen) return NextResponse.json({ error: 'bad_request' }, { status: 400, headers: PRIVATE })
  if ((await deleteTeacherDraft(profile.id, { rev, gen })) === 'stale') {
    return NextResponse.json({ error: 'draft_stale' }, { status: 409, headers: PRIVATE })
  }
  return NextResponse.json({ ok: true }, { headers: PRIVATE })
})
