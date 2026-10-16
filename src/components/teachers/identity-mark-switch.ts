// ── THE "IDENTITY VERIFIED" SWITCH, THE FORM'S HALF (owner, 2026-10-15; AUTOMATIC since 2026-10-16; plan review R2) ───
// The mark shows BY ITSELF while the identity check is live and the profile's name is within the ID's (owner, 2026-10-16:
// "if they verify it should be auto not need to ask"); the switch is the teacher's way to HIDE it, and to show it again —
// ON = not hidden, the default. With a profile it saves ON TOGGLE through its OWN endpoint (PUT
// /api/teachers/me/identity-mark → publish.ts saveTeacherIdentityMark), never with the profile; before there is one (the
// join form) it is held on the page, and a hide rides the FIRST Publish as the create-only `identityMarkHidden: true`
// (teacher-form.tsx publish). ⛔ It is never in TeacherInput or a draft, and an edit's profile save never carries it. These
// are the pure rules the form keeps it by (teacher-form.tsx holds the state, steps/finish-step.tsx draws it), pinned in
// identity-mark-switch.test.ts. What the mark is, and every reason: src/lib/teachers/identity-mark.ts.
import type { IdentityMarkReason } from '@/lib/teachers/identity-mark'

/** The mark's state as the server judged it — `reason` only ever reaches the teacher's own form. */
export type MarkState = { shown: boolean; reason: IdentityMarkReason | null }
/**
 * The switch's two stamps as stored (ISO, or null): `at` — the last show, `withdrawnAt` — the last hide. What a show-again
 * sends back as its compare-and-set `base`.
 */
export type MarkStamps = { at: string | null; withdrawnAt: string | null }
export type MarkSwitch = {
  /**
   * NOT HIDDEN, as the SERVER last said it — GET /api/teachers/me `identityMarkHidden`, or the last toggle's answer; on by
   * default. ⛔ Never ahead of an answer: no optimistic move either way.
   */
  on: boolean
  /** For the teacher's own state lines; null = not known (a failed read) — then no line is shown, nothing is guessed. */
  state: MarkState | null
  /** The next show-again's base; null = none loaded. */
  base: MarkStamps | null
}

/**
 * Nothing read yet: ON — the default, and what a first Publish creates unless the teacher hides it — with no state, so
 * no line claims the mark shows (or why it does not) before the server has said.
 */
export const NO_MARK: MarkSwitch = { on: true, state: null, base: null }
const NO_STAMPS: MarkStamps = { at: null, withdrawnAt: null }

const REASONS: readonly IdentityMarkReason[] = ['unverified', 'pending', 'expired', 'revoked', 'no_name', 'name_mismatch', 'no_profile', 'hidden']
/** The reasons about the IDENTITY or the NAME — what a hide's answer cannot speak to (it reads neither). */
const IDENTITY_SIDE: ReadonlySet<IdentityMarkReason> = new Set<IdentityMarkReason>(['unverified', 'pending', 'expired', 'revoked', 'no_name', 'name_mismatch'])
/** The identity check is LIVE: shown, or held back only by the name, no profile yet, or the teacher's hide. */
const LIVE: ReadonlySet<IdentityMarkReason | null> = new Set<IdentityMarkReason | null>([null, 'no_name', 'name_mismatch', 'no_profile', 'hidden'])

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
 * The switch as GET /api/teachers/me answers it: ON unless the server says the teacher HID it (`identityMarkHidden`,
 * judged there — identity-mark.ts identityMarkHidden; ⛔ never re-derived here from the row's raw columns, so the rule
 * lives in one place); the state line from `identityMark` (null when the server could not read it); the base from
 * `identityMarkStamps` — or, failing that, the row's own two stamps (no profile: both null).
 */
export function markFromMe(d: unknown): MarkSwitch {
  const body = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>
  const tp = (body.teacher && typeof body.teacher === 'object' ? body.teacher : null) as Record<string, unknown> | null
  return {
    on: body.identityMarkHidden !== true,
    state: stateOf(body.identityMark),
    base: stampsOf(body.identityMarkStamps) ?? (tp ? { at: isoOrNull(tp.identityMarkAt), withdrawnAt: isoOrNull(tp.identityMarkWithdrawnAt) } : NO_STAMPS),
  }
}

/**
 * What a toggle sends. SHOW AGAIN: the stamps the form loaded, as the compare-and-set base (409 identity_mark_changed when
 * another window moved them — a stale tab never undoes a hide it has not seen). HIDE: nothing else — it needs no base,
 * reads no identity and is never refused. No notice either way: the mark is no consent of its own any more (the server
 * records the words version itself when it is shown again).
 */
export function markRequest(on: boolean, base: MarkStamps | null): { on: true; base: MarkStamps } | { on: false } {
  return on ? { on: true, base: base ?? NO_STAMPS } : { on: false }
}

/**
 * The switch after a SAVED toggle — or null when the answer is not the endpoint's shape (the caller treats it as a
 * failure and shows nothing it did not hear). The answer's stamps are the next base.
 *   · SHOW: the server judged the LIVE identity in the save's own transaction — its state is fresh, the reason included.
 *   · HIDE: the server read nothing about the identity (a hide must never wait on, or fail with, an identity read —
 *     publish.ts), so its `hidden` cannot speak for it: a line about the identity or the name that was on screen stays
 *     (still true — "verify first" does not stop being true because the teacher hid the mark), and any other state
 *     becomes `hidden`. Nothing known before (null) stays unknown.
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
        : { shown: false, reason: 'hidden' }
  return { on, state: next, base }
}

/**
 * The state line's reason — the identity's or the name's, which no switch can fix; null for none (shown, no profile yet,
 * or hidden).
 */
export function markLineReason(m: MarkSwitch): IdentityMarkReason | null {
  return m.state && m.state.reason !== null && IDENTITY_SIDE.has(m.state.reason) ? m.state.reason : null
}

/** The trust line ("…adds 10 points…, whether or not you show it") — only while the identity check is LIVE. */
export function markTrustLine(m: MarkSwitch): boolean {
  return !!m.state && LIVE.has(m.state.reason)
}
