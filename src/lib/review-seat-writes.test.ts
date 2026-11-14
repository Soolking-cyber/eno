import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * ⛔ EVERY ROUTE THAT ACTS IN A THREAD ASKS THE SEAT QUESTION, OR SAYS WHY IT NEED NOT (round 4, 2026-11-14 — codex + opus).
 *
 * "A review seat never reaches a teacher" (src/lib/review-seat-accounts.ts) held in the messages route while the call, the
 * deal line and the sale question still reached a teacher the seat SOLD to: each new door was found one review round at a
 * time. So the doors are listed here, by what they DO:
 *   · every API route that writes into a thread or rings its other side — it calls insertMessage, actOnOffer,
 *     writeCallRequest, notifySaleQuestion, sendToTeacherGuarded or callPermit;
 *   · every POST / PUT / PATCH under api/conversations or api/messages (a reaction is a touch on the other person's
 *     message — opus, round 3b), whatever it calls.
 * Each must ask review-seat-listings.ts reviewSeatMeetsTeacher (or callPermit, which does, or isReviewSeatEmail on a door
 * that only ever leads to a teacher), or be listed in EXEMPT with the reason a seat cannot reach a teacher through it.
 * EXACT both ways: a new door fails until it is decided, and an exemption for a file that no longer needs one fails too.
 * A source scan, so it pins the CALL — the behaviour is pinned by each route's own seat tests.
 */
const ROOT = process.cwd()
const API = join(ROOT, 'src', 'app', 'api')

const WRITES = /\b(?:insertMessage|actOnOffer|writeCallRequest|notifySaleQuestion|sendToTeacherGuarded|callPermit)\(/
const ASKS = /\b(?:reviewSeatMeetsTeacher|callPermit|isReviewSeatEmail)\(/
const MUTATES = /export\s+(?:const|async\s+function|function)\s+(?:POST|PUT|PATCH)\b/

/** Doors a seat cannot reach a teacher through — each with the reason. */
const EXEMPT: Record<string, string> = {
  'src/app/api/auth/send-sms/route.ts': 'the sign-in code copied into an ADMIN\'s own support thread — nobody on the other side',
  'src/app/api/rental-check/route.ts': 'the rental desk\'s availability card — the other side is eno\'s rental operator, never a teacher',
  'src/app/api/teachers/share/route.ts': 'the TEACHER sharing their own contact in a school\'s thread — the actor is the teacher, and a seat never has a teacher profile (teachers/publish.ts TeacherReviewSeatError)',
  'src/app/api/teachers/video-share/route.ts': 'the TEACHER sending their own intro video to a school — as teachers/share',
  'src/app/api/trips/help/route.svc.ts': 'the forum\'s trip desk thread — the other side is eno\'s desk',
  'src/app/api/visa/applications/[id]/help/route.svc.ts': 'the forum\'s visa desk thread — the other side is eno\'s desk',
  'src/app/api/visa/applications/[id]/submit/route.svc.ts': 'the forum\'s visa desk thread — the other side is eno\'s desk',
  'src/app/api/conversations/[id]/call-consent/route.ts': 'stores the giver\'s OWN consent row — no card, no bell, no push; any call it would allow is refused by callPermit, both ways',
  'src/app/api/conversations/[id]/typing/route.ts': 'an ephemeral typing dot, nothing stored, nothing rung — and the seat can send nothing after it (the messages route)',
  'src/app/api/messages/translate/route.ts': 'translates messages for the CALLER\'s own screen — nothing is written into the thread, nothing reaches the other side',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/^route(?:\.\w+)?\.ts$/.test(e) && !/\.test\.ts$/.test(e)) out.push(p)
  }
  return out
}
/** Comments out, so a file that only TALKS about a call is not one. Block comments, and `//` after code or a line start. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
const rel = (p: string) => relative(ROOT, p).split(sep).join('/')

const doors = new Map<string, boolean>() // file → asks the seat question
const THREAD_TREES = ['src/app/api/conversations/', 'src/app/api/messages/']
for (const p of walk(API)) {
  const src = code(readFileSync(p, 'utf8'))
  const f = rel(p)
  if (WRITES.test(src) || (THREAD_TREES.some((t) => f.startsWith(t)) && MUTATES.test(src))) doors.set(f, ASKS.test(src))
}

describe('⛔ every thread write asks whether a review seat would reach a teacher (review-seat-listings.ts reviewSeatMeetsTeacher)', () => {
  it('finds the doors it is meant to (the scan is not blind)', () => {
    for (const f of [
      'src/app/api/conversations/route.ts',
      'src/app/api/conversations/[id]/messages/route.ts',
      'src/app/api/conversations/[id]/offer/route.ts',
      'src/app/api/conversations/[id]/deal/route.ts',
      'src/app/api/messages/[id]/reactions/route.ts',
      'src/app/api/conversations/[id]/call-request/route.ts',
      'src/app/api/conversations/[id]/call/route.ts',
      'src/app/api/calls/[id]/accept/route.ts',
      'src/app/api/listings/[id]/sold/route.ts',
      'src/app/api/teachers/video-request/route.ts',
    ]) expect(doors.get(f), f).toBe(true)
  })

  it('⛔ every other door is EXEMPT with its reason — a new one fails here until it asks, or is decided', () => {
    const unasked = [...doors].filter(([f, asks]) => !asks && !EXEMPT[f]).map(([f]) => f)
    expect(unasked, `A route that writes into a thread (or rings it) without asking reviewSeatMeetsTeacher (src/lib/review-seat-listings.ts). Ask it before the write, or add the file to EXEMPT with the reason a seat cannot reach a teacher through it:\n  ${unasked.join('\n  ')}`).toEqual([])
  })

  it('…and every exemption is still a door that does not ask — none describes code that is gone or now guarded', () => {
    const stale = Object.keys(EXEMPT).filter((f) => doors.get(f) !== false)
    expect(stale).toEqual([])
  })
})
