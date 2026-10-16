import { describe, expect, it } from 'vitest'
import type { IdentityMarkReason } from '@/lib/teachers/identity-mark'
import { NO_MARK, markAfterSave, markFromMe, markLineReason, markRequest, markTrustLine, type MarkSwitch } from './identity-mark-switch'

/**
 * THE "IDENTITY VERIFIED" SWITCH, THE FORM'S RULES (owner, 2026-10-15; AUTOMATIC since 2026-10-16; plan review R2 — its
 * own endpoint, saved on toggle):
 *   · ON = not hidden, the default — from the server's `identityMarkHidden`, never re-derived from the row's columns;
 *   · a show-again sends the stamps the form loaded (the CAS base) and no notice; a hide sends nothing else;
 *   · the switch moves only on the server's answer, whose stamps are the next base;
 *   · a hide's answer read nothing about the identity, so it never erases a line about the identity or the name;
 *   · the lines: the identity's or the name's reason; the trust line only while the identity check is LIVE.
 */
const STAMPS = { at: '2026-10-16T01:00:00.000Z', withdrawnAt: null }
const me = (teacher: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => ({ teacher, publishGate: { ok: true, code: null }, ...extra })

describe('markFromMe — the switch as GET /api/teachers/me answers it', () => {
  it('ON unless the server says the teacher hid it', () => {
    const on = markFromMe(me({ id: 'tp1' }, { identityMarkHidden: false, identityMark: { shown: true, reason: null }, identityMarkStamps: STAMPS }))
    expect(on).toEqual({ on: true, state: { shown: true, reason: null }, base: STAMPS })
    const hiddenStamps = { at: STAMPS.at, withdrawnAt: '2026-10-16T02:00:00.000Z' }
    const hidden = markFromMe(me({ id: 'tp1' }, { identityMarkHidden: true, identityMark: { shown: false, reason: 'hidden' }, identityMarkStamps: hiddenStamps }))
    expect(hidden).toEqual({ on: false, state: { shown: false, reason: 'hidden' }, base: hiddenStamps })
  })

  it('⛔ the server\'s flag decides — never the row\'s raw columns (the rule lives in identity-mark.ts alone)', () => {
    // A row that LOOKS hidden (switched off, a withdrawal stamp) but the server says it is not: ON.
    expect(markFromMe(me({ identityMarkOn: false, identityMarkWithdrawnAt: '2026-10-16T02:00:00.000Z' }, { identityMarkHidden: false })).on).toBe(true)
    // …and one that looks shown, but the server says hidden: OFF.
    expect(markFromMe(me({ identityMarkOn: true, identityMarkWithdrawnAt: null }, { identityMarkHidden: true })).on).toBe(false)
    // Only `true` hides: an absent or malformed flag is the default — never "hidden" on a guess.
    for (const v of [undefined, null, 'true', 1]) expect(markFromMe(me({ id: 'tp1' }, { identityMarkHidden: v })).on, String(v)).toBe(true)
  })

  it('no profile yet: ON (the default a first Publish creates), with the server\'s state — `no_profile` once the identity is live', () => {
    expect(markFromMe(me(null, { identityMarkHidden: false, identityMark: { shown: false, reason: 'no_profile' }, identityMarkStamps: { at: null, withdrawnAt: null } }))).toEqual({
      on: true, state: { shown: false, reason: 'no_profile' }, base: { at: null, withdrawnAt: null },
    })
  })

  it('a state the server could not read (null) or an unknown shape is "not known" — never guessed', () => {
    expect(markFromMe(me({ id: 'tp1' }, { identityMark: null, identityMarkStamps: STAMPS })).state).toBeNull()
    expect(markFromMe(me({ id: 'tp1' }, { identityMark: { shown: false, reason: 'made_up' }, identityMarkStamps: STAMPS })).state).toBeNull()
    expect(markFromMe(me({ id: 'tp1' }, { identityMark: { shown: true, reason: 'hidden' }, identityMarkStamps: STAMPS })).state).toBeNull()
    // The opt-in's retired reasons are unknown now (2026-10-16): no line from them.
    for (const reason of ['off', 'notice_changed']) expect(markFromMe(me({ id: 'tp1' }, { identityMark: { shown: false, reason } })).state, reason).toBeNull()
  })

  it('the base: the GET\'s stamps — else the row\'s own two — else none (no profile)', () => {
    expect(markFromMe(me({ identityMarkAt: '2026-10-10T00:00:00.000Z', identityMarkWithdrawnAt: null })).base).toEqual({ at: '2026-10-10T00:00:00.000Z', withdrawnAt: null })
    expect(markFromMe(null)).toEqual({ on: true, state: null, base: { at: null, withdrawnAt: null } })
  })
})

describe('markRequest — what the switch sends', () => {
  it('SHOW AGAIN: the loaded stamps as the base — and no notice (the mark is no consent of its own any more)', () => {
    expect(markRequest(true, STAMPS)).toEqual({ on: true, base: STAMPS })
  })
  it('SHOW with nothing loaded: an empty base — the server\'s compare-and-set decides (409 if it is not the stored one)', () => {
    expect(markRequest(true, null)).toEqual({ on: true, base: { at: null, withdrawnAt: null } })
  })
  it('HIDE: nothing else — it needs no base and no notice', () => {
    expect(markRequest(false, STAMPS)).toEqual({ on: false })
  })
})

describe('markAfterSave — the switch after the server answered', () => {
  const before: MarkSwitch = { on: false, state: { shown: false, reason: 'hidden' }, base: { at: null, withdrawnAt: '2026-10-16T00:30:00.000Z' } }
  it('SHOW: the answer\'s state and stamps — the stamps are the next base', () => {
    const next = markAfterSave(before, true, { identityMark: { shown: true, reason: null }, stamps: STAMPS })
    expect(next).toEqual({ on: true, state: { shown: true, reason: null }, base: STAMPS })
  })
  it('SHOW while the identity is still pending: on, and the server\'s reason says why it is not shown', () => {
    expect(markAfterSave(before, true, { identityMark: { shown: false, reason: 'pending' }, stamps: STAMPS })?.state).toEqual({ shown: false, reason: 'pending' })
  })
  it('⛔ HIDE read nothing about the identity: a line about the identity or the name stays; any other state becomes `hidden`', () => {
    const hideAnswer = { identityMark: { shown: false, reason: 'hidden' }, stamps: { at: STAMPS.at, withdrawnAt: '2026-10-16T03:00:00.000Z' } }
    for (const reason of ['unverified', 'pending', 'expired', 'revoked', 'no_name', 'name_mismatch'] as const) {
      const next = markAfterSave({ on: true, state: { shown: false, reason }, base: STAMPS }, false, hideAnswer)
      expect(next?.state, reason).toEqual({ shown: false, reason })
      expect(next?.on).toBe(false)
      expect(next?.base).toEqual(hideAnswer.stamps)
    }
    expect(markAfterSave({ on: true, state: { shown: true, reason: null }, base: STAMPS }, false, hideAnswer)?.state).toEqual({ shown: false, reason: 'hidden' })
    // Nothing known before stays unknown — the hide's answer is not an identity read.
    expect(markAfterSave(NO_MARK, false, hideAnswer)?.state).toBeNull()
  })
  it('an answer that is not the endpoint\'s shape: null (the caller says it failed and re-reads)', () => {
    expect(markAfterSave(before, true, {})).toBeNull()
    expect(markAfterSave(before, true, { identityMark: { shown: true, reason: null } })).toBeNull()
    expect(markAfterSave(before, true, { stamps: STAMPS })).toBeNull()
    expect(markAfterSave(before, true, null)).toBeNull()
  })
})

describe('the lines', () => {
  const m = (reason: IdentityMarkReason | null, extra: Partial<MarkSwitch> = {}): MarkSwitch => ({
    on: true, base: STAMPS,
    state: reason === null ? { shown: true, reason: null } : { shown: false, reason },
    ...extra,
  })

  it('the state line is the identity\'s or the name\'s reason — none for shown, no profile yet, or hidden', () => {
    for (const reason of ['unverified', 'pending', 'expired', 'revoked', 'no_name', 'name_mismatch'] as const) expect(markLineReason(m(reason))).toBe(reason)
    for (const reason of [null, 'no_profile', 'hidden'] as const) expect(markLineReason(m(reason))).toBeNull()
    expect(markLineReason(NO_MARK)).toBeNull()
  })

  it('the trust line only while the identity check is LIVE (shown, or held back by the name, no profile yet, or a hide)', () => {
    for (const reason of [null, 'no_name', 'name_mismatch', 'no_profile', 'hidden'] as const) expect(markTrustLine(m(reason)), String(reason)).toBe(true)
    for (const reason of ['unverified', 'pending', 'expired', 'revoked'] as const) expect(markTrustLine(m(reason)), reason).toBe(false)
    expect(markTrustLine(NO_MARK)).toBe(false)
  })
})
