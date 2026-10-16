// ── THE "IDENTITY VERIFIED" SWITCH, THE FORM'S HALF (owner, 2026-10-15; plan review R2) ─────────────────────────────────
// The switch on Photo & publish saves ON TOGGLE through its OWN endpoint (PUT /api/teachers/me/identity-mark → publish.ts
// saveTeacherIdentityMark), never with the profile: ⛔ it is not in TeacherInput, a draft or the profile save's body. These
// are the pure rules the form keeps it by (teacher-form.tsx holds the state, steps/finish-step.tsx draws it), pinned in
// identity-mark-switch.test.ts. What the mark is, and every reason: src/lib/teachers/identity-mark.ts.
import type { IdentityMarkReason } from '@/lib/teachers/identity-mark'
import { IDENTITY_MARK_NOTICE_VERSION } from '@/lib/teachers/constants'

/** The mark's state as the server judged it — `reason` only ever reaches the teacher's own form. */
export type MarkState = { shown: boolean; reason: IdentityMarkReason | null }
/** The two consent stamps as stored (ISO, or null) — what a switch-on sends back as its compare-and-set `base`. */
export type MarkStamps = { at: string | null; withdrawnAt: string | null }
export type MarkSwitch = {
  /** The switch as the SERVER last said: on under today's notice. ⛔ Never ahead of an answer — no optimistic ON. */
  on: boolean
  /** It was switched on under OLDER words: it loads OFF (a consent counts only under the notice in force), and a line
   *  asks for a fresh switch-on. A full save never touches it — only the switch's own save does. */
  noticeChanged: boolean
  /** For the teacher's own state lines; null = not known (a failed read) — then no line is shown, nothing is guessed. */
  state: MarkState | null
  /** The next switch-on's base; null = none loaded. */
  base: MarkStamps | null
}

export const NO_MARK: MarkSwitch = { on: false, noticeChanged: false, state: null, base: null }
const NO_STAMPS: MarkStamps = { at: null, withdrawnAt: null }

const REASONS: readonly IdentityMarkReason[] = ['unverified', 'pending', 'expired', 'revoked', 'no_name', 'name_mismatch', 'off', 'notice_changed']
/** The reasons about the IDENTITY or the NAME — what a switch-off's answer cannot speak to (it reads neither). */
const IDENTITY_SIDE: ReadonlySet<IdentityMarkReason> = new Set<IdentityMarkReason>(['unverified', 'pending', 'expired', 'revoked', 'no_name', 'name_mismatch'])
/** The identity check is LIVE: shown, or held back only by the name or the switch. */
const LIVE: ReadonlySet<IdentityMarkReason | null> = new Set<IdentityMarkReason | null>([null, 'off', 'notice_changed', 'no_name', 'name_mismatch'])

const isoOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

function stateOf(v: unknown): MarkState | null {
  if (!v || typeof v !== 'object') return null
  const s = v as { shown?: unknown; reason?: unknown }
  if (s.shown === true && s.reason === null) return { shown: true, reason: null }
  if (s.shown === false && (REASONS as readonly unknown[]).includes(s.reason)) return { shown: false, reason: s.reason as IdentityMarkReason }
  return null
}

function stampsOf(v: unknown): MarkStamps | null {
  if (!v || typeof v !== 'object') return null
  const s = v as { at?: unknown; withdrawnAt?: unknown }
  if (!('at' in s) || !('withdrawnAt' in s)) return null
  return { at: isoOrNull(s.at), withdrawnAt: isoOrNull(s.withdrawnAt) }
}

/**
 * The switch as GET /api/teachers/me answers it: ON only under today's IDENTITY_MARK_NOTICE_VERSION (an older grant
 * loads OFF, with `noticeChanged`); the state line from `identityMark` (null when the server could not read it); the
 * base from `identityMarkStamps` — or, failing that, the row's own two stamps (no profile: both null).
 */
export function markFromMe(d: unknown): MarkSwitch {
  const body = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>
  const tp = (body.teacher && typeof body.teacher === 'object' ? body.teacher : null) as Record<string, unknown> | null
  const storedOn = tp?.identityMarkOn === true
  const current = storedOn && tp?.identityMarkNoticeVersion === IDENTITY_MARK_NOTICE_VERSION
  return {
    on: current,
    noticeChanged: storedOn && !current,
    state: stateOf(body.identityMark),
    base: stampsOf(body.identityMarkStamps) ?? (tp ? { at: isoOrNull(tp.identityMarkAt), withdrawnAt: isoOrNull(tp.identityMarkWithdrawnAt) } : NO_STAMPS),
  }
}

/**
 * What a switch-on sends: today's notice (the words on screen beside it — 409 notice_changed otherwise) and the stamps the
 * form loaded (409 identity_mark_changed when another window moved them: a stale tab never re-grants a withdrawal).
 * A switch-off sends nothing else: a withdrawal needs no notice and no base, and is never refused.
 */
export function markRequest(on: boolean, base: MarkStamps | null): { on: true; notice: string; base: MarkStamps } | { on: false } {
  return on ? { on: true, notice: IDENTITY_MARK_NOTICE_VERSION, base: base ?? NO_STAMPS } : { on: false }
}

/**
 * The switch after a SAVED toggle — or null when the answer is not the endpoint's shape (the caller treats it as a
 * failure and shows nothing it did not hear). The answer's stamps are the next base.
 *   · ON: the server judged the LIVE identity in the save's own transaction — its state is fresh, the reason included.
 *   · OFF: the server read nothing about the identity (a withdrawal must never wait on, or fail with, an identity read —
 *     publish.ts), so its `off` cannot speak for it: a line about the identity or the name that was on screen stays
 *     (still true — "verify first" does not stop being true because the switch went off), and only a state that was
 *     about the switch becomes `off`. Nothing known before (null) stays unknown.
 */
export function markAfterSave(prev: MarkSwitch, on: boolean, answer: unknown): MarkSwitch | null {
  const a = (answer && typeof answer === 'object' ? answer : {}) as { identityMark?: unknown; stamps?: unknown }
  const state = stateOf(a.identityMark)
  const base = stampsOf(a.stamps)
  if (!state || !base) return null
  const next: MarkState | null = on
    ? state
    : prev.state === null ? null
      : prev.state.reason !== null && IDENTITY_SIDE.has(prev.state.reason) ? { shown: false, reason: prev.state.reason }
        : { shown: false, reason: 'off' }
  return { on, noticeChanged: false, state: next, base }
}

/**
 * The state line's reason — the identity's or the name's, which no switch can fix; null for none (shown, off, or the
 * switch's own notice line instead).
 */
export function markLineReason(m: MarkSwitch): IdentityMarkReason | null {
  return m.state && m.state.reason !== null && IDENTITY_SIDE.has(m.state.reason) ? m.state.reason : null
}

/**
 * "What this switch does has changed…": an older grant loaded OFF, and nothing about the identity or the name stands in
 * the way (that line is the one to read first — switching on again would not show it).
 */
export function markNoticeLine(m: MarkSwitch): boolean {
  return m.noticeChanged && !m.on && markLineReason(m) === null
}

/** The trust line ("…adds 10 points…, whether or not you show it") — only while the identity check is LIVE. */
export function markTrustLine(m: MarkSwitch): boolean {
  return !!m.state && LIVE.has(m.state.reason)
}
