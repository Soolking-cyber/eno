import { describe, expect, it } from 'vitest'
import { IDENTITY_MARK_NOTICE_VERSION } from '@/lib/teachers/constants'
import type { IdentityMarkReason } from '@/lib/teachers/identity-mark'
import { NO_MARK, markAfterSave, markFromMe, markLineReason, markNoticeLine, markRequest, markTrustLine, type MarkSwitch } from './identity-mark-switch'

/**
 * THE "IDENTITY VERIFIED" SWITCH, THE FORM'S RULES (owner, 2026-10-15; plan review R2 — its own endpoint, saved on toggle):
 *   · it loads ON only under today's IDENTITY_MARK_NOTICE_VERSION (an older grant loads OFF and asks again);
 *   · ON sends today's notice and the stamps the form loaded (the CAS base); OFF sends nothing else;
 *   · the switch moves only on the server's answer, whose stamps are the next base;
 *   · an OFF answer read nothing about the identity, so it never erases a line about the identity or the name;
 *   · the lines: the identity's or the name's reason first; the notice line only when nothing else stands in the way;
 *     the trust line only while the identity check is LIVE.
 */
const STAMPS = { at: '2026-10-16T01:00:00.000Z', withdrawnAt: null }
const me = (teacher: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => ({ teacher, publishGate: { ok: true, code: null }, ...extra })

describe('markFromMe — the switch as GET /api/teachers/me answers it', () => {
  it('ON only under today\'s notice; an older grant loads OFF with noticeChanged', () => {
    const on = markFromMe(me({ identityMarkOn: true, identityMarkNoticeVersion: IDENTITY_MARK_NOTICE_VERSION }, { identityMark: { shown: true, reason: null }, identityMarkStamps: STAMPS }))
    expect(on).toEqual({ on: true, noticeChanged: false, state: { shown: true, reason: null }, base: STAMPS })
    const old = markFromMe(me({ identityMarkOn: true, identityMarkNoticeVersion: '2026-01-01' }, { identityMark: { shown: false, reason: 'notice_changed' }, identityMarkStamps: STAMPS }))
    expect(old).toEqual({ on: false, noticeChanged: true, state: { shown: false, reason: 'notice_changed' }, base: STAMPS })
    const off = markFromMe(me({ identityMarkOn: false, identityMarkNoticeVersion: IDENTITY_MARK_NOTICE_VERSION }, { identityMark: { shown: false, reason: 'off' }, identityMarkStamps: { at: STAMPS.at, withdrawnAt: '2026-10-16T02:00:00.000Z' } }))
    expect(off.on).toBe(false)
    expect(off.noticeChanged).toBe(false)
    expect(off.base).toEqual({ at: STAMPS.at, withdrawnAt: '2026-10-16T02:00:00.000Z' })
  })

  it('a state the server could not read (null) or an unknown shape is "not known" — never guessed', () => {
    expect(markFromMe(me({ identityMarkOn: false }, { identityMark: null, identityMarkStamps: STAMPS })).state).toBeNull()
    expect(markFromMe(me({ identityMarkOn: false }, { identityMark: { shown: false, reason: 'made_up' }, identityMarkStamps: STAMPS })).state).toBeNull()
    expect(markFromMe(me({ identityMarkOn: false }, { identityMark: { shown: true, reason: 'off' }, identityMarkStamps: STAMPS })).state).toBeNull()
  })

  it('the base: the GET\'s stamps — else the row\'s own two — else none (no profile)', () => {
    expect(markFromMe(me({ identityMarkAt: '2026-10-10T00:00:00.000Z', identityMarkWithdrawnAt: null })).base).toEqual({ at: '2026-10-10T00:00:00.000Z', withdrawnAt: null })
    expect(markFromMe(me(null, { identityMark: { shown: false, reason: 'unverified' }, identityMarkStamps: { at: null, withdrawnAt: null } }))).toEqual({
      on: false, noticeChanged: false, state: { shown: false, reason: 'unverified' }, base: { at: null, withdrawnAt: null },
    })
    expect(markFromMe(null)).toEqual({ on: false, noticeChanged: false, state: null, base: { at: null, withdrawnAt: null } })
  })
})

describe('markRequest — what the switch sends', () => {
  it('ON: today\'s notice and the loaded stamps as the base', () => {
    expect(markRequest(true, STAMPS)).toEqual({ on: true, notice: IDENTITY_MARK_NOTICE_VERSION, base: STAMPS })
  })
  it('ON with nothing loaded: an empty base — the server\'s compare-and-set decides (409 if it is not the stored one)', () => {
    expect(markRequest(true, null)).toEqual({ on: true, notice: IDENTITY_MARK_NOTICE_VERSION, base: { at: null, withdrawnAt: null } })
  })
  it('OFF: nothing else — a withdrawal needs no notice and no base', () => {
    expect(markRequest(false, STAMPS)).toEqual({ on: false })
  })
})

describe('markAfterSave — the switch after the server answered', () => {
  const before: MarkSwitch = { on: false, noticeChanged: true, state: { shown: false, reason: 'off' }, base: { at: null, withdrawnAt: null } }
  it('ON: the answer\'s state and stamps — the stamps are the next base; the old-notice line is gone', () => {
    const next = markAfterSave(before, true, { identityMark: { shown: true, reason: null }, stamps: STAMPS })
    expect(next).toEqual({ on: true, noticeChanged: false, state: { shown: true, reason: null }, base: STAMPS })
  })
  it('ON while the identity is still pending: on, and the server\'s reason says why it is not shown', () => {
    expect(markAfterSave(before, true, { identityMark: { shown: false, reason: 'pending' }, stamps: STAMPS })?.state).toEqual({ shown: false, reason: 'pending' })
  })
  it('⛔ OFF read nothing about the identity: a line about the identity or the name stays; a switch state becomes `off`', () => {
    const offAnswer = { identityMark: { shown: false, reason: 'off' }, stamps: { at: STAMPS.at, withdrawnAt: '2026-10-16T03:00:00.000Z' } }
    for (const reason of ['unverified', 'pending', 'expired', 'revoked', 'no_name', 'name_mismatch'] as const) {
      const next = markAfterSave({ on: true, noticeChanged: false, state: { shown: false, reason }, base: STAMPS }, false, offAnswer)
      expect(next?.state, reason).toEqual({ shown: false, reason })
      expect(next?.on).toBe(false)
      expect(next?.base).toEqual(offAnswer.stamps)
    }
    expect(markAfterSave({ on: true, noticeChanged: false, state: { shown: true, reason: null }, base: STAMPS }, false, offAnswer)?.state).toEqual({ shown: false, reason: 'off' })
    // Nothing known before stays unknown — the OFF answer is not an identity read.
    expect(markAfterSave({ ...NO_MARK, on: true }, false, offAnswer)?.state).toBeNull()
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
    on: false, noticeChanged: false, base: STAMPS,
    state: reason === null ? { shown: true, reason: null } : { shown: false, reason },
    ...extra,
  })

  it('the state line is the identity\'s or the name\'s reason — none for shown, off or notice_changed', () => {
    for (const reason of ['unverified', 'pending', 'expired', 'revoked', 'no_name', 'name_mismatch'] as const) expect(markLineReason(m(reason))).toBe(reason)
    for (const reason of [null, 'off', 'notice_changed'] as const) expect(markLineReason(m(reason))).toBeNull()
    expect(markLineReason(NO_MARK)).toBeNull()
  })

  it('the notice line: an older grant loaded OFF — unless the identity or the name stands in the way first', () => {
    expect(markNoticeLine(m('notice_changed', { noticeChanged: true }))).toBe(true)
    expect(markNoticeLine({ ...NO_MARK, noticeChanged: true })).toBe(true) // the state unknown: the row still says so
    expect(markNoticeLine(m('expired', { noticeChanged: true }))).toBe(false)
    expect(markNoticeLine(m('notice_changed', { noticeChanged: true, on: true }))).toBe(false)
    expect(markNoticeLine(m('off'))).toBe(false)
  })

  it('the trust line only while the identity check is LIVE (shown, or held back by the name or the switch)', () => {
    for (const reason of [null, 'off', 'notice_changed', 'no_name', 'name_mismatch'] as const) expect(markTrustLine(m(reason)), String(reason)).toBe(true)
    for (const reason of ['unverified', 'pending', 'expired', 'revoked'] as const) expect(markTrustLine(m(reason)), reason).toBe(false)
    expect(markTrustLine(NO_MARK)).toBe(false)
  })
})
