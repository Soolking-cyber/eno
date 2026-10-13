import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { IDENTITY_VERIFY_PATH } from '@/lib/identity-block-copy'
import { TEACHER_DM_LIMITS, TEACHER_UNANSWERED_MAX, type TeacherDmNext, type TeacherDmTier } from './constants'
// Type-only: dm-quota.ts is server-only, and nothing of it runs here.
import type { TeacherDmReason } from './dm-quota'
import { teacherAwaitingReplyMessage, teacherDmLimitMessage, teacherDmStep } from './dm-limit-copy'

// ── What the app says when the teacher DM ladder refuses (owner, 2026-10-13) ───────────────────────────────────────────
//
// The server sends facts (dm-quota.ts teacherDmRefusal: tier, next, reason); dm-limit-copy.ts turns them into the
// sentence and the one step that lifts the limit. Two ways that goes wrong without failing anything else: a refusal the
// server CAN send that has no sentence (the pending page then falls back to its plain "try again tomorrow" line — no
// step, and wrong for a revoked account), and a sentence that names a number the ladder no longer has.

const EN = (en: string, _vi: string) => en
const VI = (_en: string, vi: string) => vi

/** Every step the server can name. A Record, so a new TeacherDmNext fails tsc here until it is listed — and worded. */
const NEXTS: Record<TeacherDmNext, true> = {
  verify_identity: true, identity_pending: true, renew_identity: true, add_phone: true,
  switch_to_business: true, verify_business: true, business_pending: true, renew_business: true,
  tomorrow: true, none: true,
}
const REASONS: Record<TeacherDmReason, true> = { limit: true, pool: true, phone: true, revoked: true }

type Facts = { tier: TeacherDmTier; next: TeacherDmNext; reason: TeacherDmReason }

/**
 * EVERY REFUSAL dm-quota.ts CAN PRODUCE — teacherDmTier's (tier, next) pairs, crossed with the reasons shape() can give
 * that rung:
 *   · revoked    — next 'none', reason 'revoked' (limit 0, nothing else applies);
 *   · unverified — PHONE_OTP_ENABLED with no phone: 'add_phone' / 'phone'; otherwise the identity check's step, refused
 *                  on the account's own 3 ('limit') or on the connection's shared pool ('pool');
 *   · identity   — the business step; never pooled, so only 'limit';
 *   · business   — 'tomorrow' / 'limit'.
 */
const PRODUCIBLE: Facts[] = [
  { tier: 'revoked', next: 'none', reason: 'revoked' },
  { tier: 'unverified', next: 'add_phone', reason: 'phone' },
  ...(['verify_identity', 'identity_pending', 'renew_identity'] as const).flatMap((next) =>
    (['limit', 'pool'] as const).map((reason) => ({ tier: 'unverified' as const, next, reason }))),
  ...(['switch_to_business', 'verify_business', 'business_pending', 'renew_business'] as const).map((next) =>
    ({ tier: 'identity' as const, next, reason: 'limit' as const })),
  { tier: 'business', next: 'tomorrow', reason: 'limit' },
]

const label = (f: Facts) => `${f.tier}/${f.next}/${f.reason}`
const numbers = (s: string | null) => (s?.match(/\d+/g) ?? []).map(Number).sort((a, b) => a - b)

/** The numbers a sentence may carry: the rung's own limit and the one above it — nothing for the reasons with no count. */
const expectedNumbers = (f: Facts): number[] => {
  if (f.reason === 'revoked' || f.reason === 'phone' || f.reason === 'pool') return []
  if (f.tier === 'business') return [TEACHER_DM_LIMITS.business]
  if (f.tier === 'identity') return [TEACHER_DM_LIMITS.identity, TEACHER_DM_LIMITS.business]
  return [TEACHER_DM_LIMITS.unverified, TEACHER_DM_LIMITS.identity]
}

describe('the table this file tests against', () => {
  it('names every rung, every step and every reason the server has', () => {
    expect(new Set(PRODUCIBLE.map((f) => f.tier))).toEqual(new Set(Object.keys(TEACHER_DM_LIMITS)))
    expect(new Set(PRODUCIBLE.map((f) => f.next))).toEqual(new Set(Object.keys(NEXTS)))
    expect(new Set(PRODUCIBLE.map((f) => f.reason))).toEqual(new Set(Object.keys(REASONS)))
  })
})

describe('teacherDmLimitMessage', () => {
  it('⛔ every refusal the server can send has a sentence, in English and in Vietnamese', () => {
    for (const f of PRODUCIBLE) {
      const en = teacherDmLimitMessage(f, EN)
      const vi = teacherDmLimitMessage(f, VI)
      expect(en, label(f)).toEqual(expect.any(String))
      expect(en!.length, label(f)).toBeGreaterThan(20)
      expect(vi, label(f)).toEqual(expect.any(String))
      // A real translation, not the English handed through.
      expect(vi, label(f)).not.toBe(en)
    }
  })

  it('⛔ the numbers in every sentence are the ladder\'s — 3, 10, 30 — in both languages', () => {
    // The sentences type the numbers in (the harvester reads literals only), so this is what keeps them true: change a
    // limit in constants.ts and this fails until the copy says the new number.
    expect([TEACHER_DM_LIMITS.unverified, TEACHER_DM_LIMITS.identity, TEACHER_DM_LIMITS.business]).toEqual([3, 10, 30])
    for (const f of PRODUCIBLE) {
      expect(numbers(teacherDmLimitMessage(f, EN)), `${label(f)} en`).toEqual(expectedNumbers(f))
      expect(numbers(teacherDmLimitMessage(f, VI)), `${label(f)} vi`).toEqual(expectedNumbers(f))
    }
  })

  it('each step on a rung gets its own sentence, and the pool is not worded as the account\'s own limit', () => {
    for (const tier of ['unverified', 'identity'] as const) {
      const limitOnes = PRODUCIBLE.filter((f) => f.tier === tier && f.reason === 'limit')
      const sentences = limitOnes.map((f) => teacherDmLimitMessage(f, EN))
      expect(new Set(sentences).size, tier).toBe(limitOnes.length)
    }
    const pool = teacherDmLimitMessage({ tier: 'unverified', next: 'verify_identity', reason: 'pool' }, EN)
    expect(pool).not.toBe(teacherDmLimitMessage({ tier: 'unverified', next: 'verify_identity', reason: 'limit' }, EN))
    expect(pool).toMatch(/internet connection/)
    expect(teacherDmLimitMessage({ tier: 'unverified', next: 'add_phone', reason: 'phone' }, EN)).toMatch(/phone number/)
  })

  it('a revoked account is not promised tomorrow — waiting changes nothing (the 403 has no Retry-After)', () => {
    const s = teacherDmLimitMessage({ tier: 'revoked', next: 'none', reason: 'revoked' }, EN)!
    expect(s).not.toMatch(/midnight|tomorrow|try again/i)
  })

  it('is null for facts that are not a ladder refusal — an older server\'s bare code', () => {
    expect(teacherDmLimitMessage({}, EN)).toBeNull()
    expect(teacherDmLimitMessage({ tier: 'mystery', next: 'verify_identity', reason: 'limit' }, EN)).toBeNull()
    expect(teacherDmLimitMessage({ reason: null }, EN)).toBeNull()
  })
})

describe('teacherDmStep — the one step that lifts the limit', () => {
  it('the identity steps go to the identity check, flagged as KYC', () => {
    for (const next of ['verify_identity', 'renew_identity'] as const) {
      expect(teacherDmStep(next, 'individual', EN)).toEqual({ label: 'Verify your identity', href: IDENTITY_VERIFY_PATH, kyc: 'identity' })
    }
    expect(teacherDmStep('identity_pending', 'individual', EN)).toEqual({ label: 'See your verification', href: IDENTITY_VERIFY_PATH, kyc: 'identity' })
  })

  it('the business steps go to the business verification, flagged as KYC', () => {
    for (const next of ['verify_business', 'renew_business'] as const) {
      expect(teacherDmStep(next, 'business', EN)).toEqual({ label: 'Verify your business', href: '/dashboard/verification', kyc: 'business' })
    }
    expect(teacherDmStep('business_pending', 'business', EN)).toEqual({ label: 'See your verification', href: '/dashboard/verification', kyc: 'business' })
  })

  it('switching to business: the account settings for an account that has a type, /onboard for one that never chose', () => {
    expect(teacherDmStep('switch_to_business', 'individual', EN)).toEqual({ label: 'Switch to a business account', href: '/dashboard/settings?tab=account', kyc: null })
    for (const none of [null, undefined, ''] as const) {
      expect(teacherDmStep('switch_to_business', none, EN), String(none)).toEqual({ label: 'Set up a business account', href: '/onboard', kyc: null })
    }
  })

  it('adding a phone is a settings step, not a KYC one', () => {
    expect(teacherDmStep('add_phone', 'individual', EN)).toEqual({ label: 'Add your phone number', href: '/dashboard/settings?tab=account', kyc: null })
  })

  it('the top rung waits for tomorrow and revoked has no way up: no step', () => {
    expect(teacherDmStep('tomorrow', 'business', EN)).toBeNull()
    expect(teacherDmStep('none', 'individual', EN)).toBeNull()
    expect(teacherDmStep(undefined, 'individual', EN)).toBeNull()
    expect(teacherDmStep('something_new', 'individual', EN)).toBeNull()
  })

  it('every step is a same-site path with a Vietnamese label', () => {
    for (const next of Object.keys(NEXTS) as TeacherDmNext[]) {
      for (const accountType of ['individual', 'business', null]) {
        const en = teacherDmStep(next, accountType, EN)
        const vi = teacherDmStep(next, accountType, VI)
        if (!en) { expect(vi).toBeNull(); continue }
        expect(en.href, next).toMatch(/^\/(?!\/)/)
        expect(vi?.href).toBe(en.href)
        expect(vi?.label, next).not.toBe(en.label)
      }
    }
  })
})

describe('teacherAwaitingReplyMessage', () => {
  it('names TEACHER_UNANSWERED_MAX (2), in both languages', () => {
    expect(TEACHER_UNANSWERED_MAX).toBe(2)
    expect(numbers(teacherAwaitingReplyMessage(EN))).toEqual([TEACHER_UNANSWERED_MAX])
    expect(numbers(teacherAwaitingReplyMessage(VI))).toEqual([TEACHER_UNANSWERED_MAX])
    expect(teacherAwaitingReplyMessage(VI)).not.toBe(teacherAwaitingReplyMessage(EN))
  })
})

/**
 * ⚠️ THE FILE HEADER'S RULE, HELD BY READING THE FILE: `tr(en, vi)` with LITERAL arguments and no ASCII apostrophe in the
 * English, because scripts/gen-ui-strings.mjs harvests single-quoted `tr('…'` literals into the translation warm batch.
 * A sentence built at runtime, or quoted another way, never reaches that batch.
 */
describe('dm-limit-copy.ts source — what the ui-strings harvester can read', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/teachers/dm-limit-copy.ts'), 'utf8')
  // Comments mention `tr(en, vi)` in prose; only code counts.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const LIT = String.raw`'((?:[^'\\]|\\.)*)'`
  const calls = [...code.matchAll(/\btr\(/g)].length
  const pairs = [...code.matchAll(new RegExp(String.raw`\btr\(\s*${LIT}\s*,\s*${LIT}\s*\)`, 'g'))]
  const english = new Set(pairs.map((m) => m[1].replace(/\\(.)/g, '$1')))

  it('every tr() call takes two single-quoted literals', () => {
    expect(calls).toBeGreaterThan(0)
    expect(pairs).toHaveLength(calls)
  })

  it('⛔ no English literal holds an ASCII apostrophe', () => {
    expect(pairs.map((m) => m[1]).filter((en) => en.includes("'"))).toEqual([])
  })

  it('every sentence and label the functions return is one of those literals — none is assembled at runtime', () => {
    const returned = [
      ...PRODUCIBLE.map((f) => teacherDmLimitMessage(f, EN)),
      ...(Object.keys(NEXTS) as TeacherDmNext[]).flatMap((next) => [teacherDmStep(next, 'individual', EN)?.label, teacherDmStep(next, null, EN)?.label]),
      teacherAwaitingReplyMessage(EN),
    ].filter((s): s is string => typeof s === 'string')
    expect(returned.length).toBeGreaterThan(PRODUCIBLE.length)
    for (const s of returned) expect(english.has(s), s).toBe(true)
  })
})
