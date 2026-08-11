import { describe, expect, it } from 'vitest'
import {
  ENFORCEMENT,
  ENFORCEMENT_REASON,
  ENFORCEMENT_SEVERITY,
  FLAG_REASONS,
  REPORTER_LADDER,
  VELOCITY,
  applyInsurance,
  blocksMessaging,
  blocksPosting,
  canSystemTransition,
  deriveState,
  holdForGrace,
  isFlagReason,
  isInsured,
  isProbation,
  normalizeEnforcementState,
  reporterStanding,
  velocitySpike,
  type EnforcementInputs,
  type VelocityInputs,
} from './enforcement-machine'
import { TRUST, conductPenalty } from './trust-math'

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const NOW = 1_750_000_000_000

const win = (count = 0, distinctReporters = 0, scams = 0) => ({ count, distinctReporters, scams })

// A clean, established seller — each test overrides the axis under test.
const clean: EnforcementInputs = {
  score: 100,
  hasScamHold: false,
  conductPenalty: 0,
  reports90: win(),
  transactions365: 100,
}

describe('deriveState (spec derivation order)', () => {
  it('clean record → good_standing', () => {
    expect(deriveState(clean, NOW)).toEqual({ state: 'good_standing', reason: 'good_standing', expiresAt: null })
  })

  it('active scam-hold → held (regardless of score), no expiry', () => {
    const d = deriveState({ ...clean, hasScamHold: true, score: 140 }, NOW)
    expect(d).toEqual({ state: 'held', reason: ENFORCEMENT_REASON.SCAM_HOLD, expiresAt: null })
  })

  it('restricted VIA CONDUCT (score <60 while reports bite) → throttled', () => {
    const d = deriveState({ ...clean, score: 55, conductPenalty: 20 }, NOW)
    expect(d.state).toBe('throttled')
    expect(d.reason).toBe(ENFORCEMENT_REASON.CONDUCT_RESTRICTED)
    expect(d.expiresAt).toBeNull()
  })

  it('score <60 WITHOUT conduct (manual adjustments alone) never throttles', () => {
    expect(deriveState({ ...clean, score: 55, conductPenalty: 0 }, NOW).state).toBe('good_standing')
  })

  it('dual-threshold demote signal in 90d → warned, expires in 30d', () => {
    // 3 reports from 2 distinct reporters over 100 tx = 3% > 2% AND corroborated.
    const d = deriveState({ ...clean, reports90: win(3, 2, 0) }, NOW)
    expect(d.state).toBe('warned')
    expect(d.reason).toBe(ENFORCEMENT_REASON.CONDUCT_WARNING)
    expect(d.expiresAt).toBe(NOW + ENFORCEMENT.WARN_EXPIRES_DAYS * DAY_MS)
  })

  it('one hostile reporter alone can never trigger a warning (needs ≥2 distinct)', () => {
    expect(deriveState({ ...clean, reports90: win(3, 1, 0) }, NOW).state).toBe('good_standing')
  })

  it('a low RATE does not warn even when corroborated', () => {
    // 2 reports over 1000 tx = 0.2% — under the 2% threshold.
    expect(deriveState({ ...clean, transactions365: 1000, reports90: win(2, 2, 0) }, NOW).state).toBe('good_standing')
  })

  it('a confirmed scam in-window (dues paid, no hold) still warns', () => {
    expect(deriveState({ ...clean, reports90: win(1, 1, 1) }, NOW).state).toBe('warned')
  })

  it('severity precedence: hold beats throttle beats warn', () => {
    const worst: EnforcementInputs = { score: 40, hasScamHold: true, conductPenalty: 50, reports90: win(5, 3, 1), transactions365: 10 }
    expect(deriveState(worst, NOW).state).toBe('held')
    expect(deriveState({ ...worst, hasScamHold: false }, NOW).state).toBe('throttled')
    expect(deriveState({ ...worst, hasScamHold: false, score: 70 }, NOW).state).toBe('warned')
  })
})

describe('canSystemTransition (admin-vs-system precedence)', () => {
  it('same state → false (idempotent no-op)', () => {
    expect(canSystemTransition({ state: 'warned', decidedBy: 'system' }, 'warned')).toBe(false)
  })

  it('escalation is always allowed — even over an admin action', () => {
    expect(canSystemTransition({ state: 'warned', decidedBy: 'admin@eno.vn' }, 'held')).toBe(true)
    expect(canSystemTransition({ state: 'good_standing', decidedBy: 'system' }, 'suspended')).toBe(true)
  })

  it('system auto-lifts its OWN actions when the derived state improves', () => {
    expect(canSystemTransition({ state: 'throttled', decidedBy: 'system' }, 'good_standing')).toBe(true)
    expect(canSystemTransition({ state: 'held', decidedBy: 'system' }, 'warned')).toBe(true)
  })

  it('system NEVER downgrades an active admin action (admin lifts manually)', () => {
    expect(canSystemTransition({ state: 'suspended', decidedBy: 'admin@eno.vn' }, 'good_standing')).toBe(false)
    expect(canSystemTransition({ state: 'held', decidedBy: 'admin@eno.vn' }, 'throttled')).toBe(false)
  })
})

describe('good-standing insurance (Amazon AHA)', () => {
  const graceCtx = { insured: true, currentState: 'good_standing' as const, graceUsedRecently: false }
  const throttleDerived = { state: 'throttled' as const, reason: ENFORCEMENT_REASON.CONDUCT_RESTRICTED, expiresAt: null }

  it('isInsured: needs an unbroken ≥180d streak', () => {
    expect(isInsured(null, NOW)).toBe(false)
    expect(isInsured(NOW - 179 * DAY_MS, NOW)).toBe(false)
    expect(isInsured(NOW - 180 * DAY_MS, NOW)).toBe(true)
  })

  it('insured + good_standing + non-critical derivation → 72h grace warning', () => {
    const g = applyInsurance(throttleDerived, graceCtx, NOW)
    expect(g.state).toBe('warned')
    expect(g.reason).toBe(ENFORCEMENT_REASON.INSURANCE_GRACE)
    expect(g.expiresAt).toBe(NOW + ENFORCEMENT.INSURANCE_GRACE_HOURS * HOUR_MS)
  })

  it('grace only fires FROM good standing (not mid-episode)', () => {
    expect(applyInsurance(throttleDerived, { ...graceCtx, currentState: 'warned' }, NOW)).toBe(throttleDerived)
  })

  it('grace never re-arms while a recent grace exists (no expire→re-grace loop)', () => {
    expect(applyInsurance(throttleDerived, { ...graceCtx, graceUsedRecently: true }, NOW)).toBe(throttleDerived)
  })

  it('never applies to critical states (held/suspended act immediately)', () => {
    const held = { state: 'held' as const, reason: ENFORCEMENT_REASON.SCAM_HOLD, expiresAt: null }
    expect(applyInsurance(held, graceCtx, NOW)).toBe(held)
  })

  it('uninsured sellers get the derived state directly', () => {
    expect(applyInsurance(throttleDerived, { ...graceCtx, insured: false }, NOW)).toBe(throttleDerived)
  })

  it('holdForGrace: an un-expired grace holds back warned/throttled, never critical', () => {
    const active = { reason: ENFORCEMENT_REASON.INSURANCE_GRACE, expiresAtMs: NOW + HOUR_MS }
    expect(holdForGrace(active, 'throttled', NOW)).toBe(true)
    expect(holdForGrace(active, 'warned', NOW)).toBe(true)
    expect(holdForGrace(active, 'held', NOW)).toBe(false) // a scam hold breaks through
    expect(holdForGrace({ ...active, expiresAtMs: NOW - 1 }, 'throttled', NOW)).toBe(false) // lapsed → escalate
    expect(holdForGrace({ reason: 'conduct_warning', expiresAtMs: NOW + HOUR_MS }, 'throttled', NOW)).toBe(false)
    expect(holdForGrace(null, 'throttled', NOW)).toBe(false)
  })
})

describe('probation (caps, not shame)', () => {
  it('young AND unproven → probation', () => {
    expect(isProbation(5, 0)).toBe(true)
    expect(isProbation(29.9, 2)).toBe(true)
  })

  it('age ≥30d OR ≥3 transactions ends it (whichever first)', () => {
    expect(isProbation(30, 0)).toBe(false)
    expect(isProbation(1, 3)).toBe(false)
  })

  it('cap constants match the spec', () => {
    // 8 → 30 (owner, 2026-08-11). The pin stays: this test's job is to make a change to a
    // user-facing limit deliberate rather than incidental, so it should fail when the number
    // moves — it just has to be updated with it, not deleted.
    expect(ENFORCEMENT.PROBATION.MAX_ACTIVE_LISTINGS).toBe(30)
    expect(ENFORCEMENT.PROBATION.MAX_NEW_CONVERSATIONS_PER_DAY).toBe(15)
  })
})

describe('capability blocks', () => {
  it('held + suspended block posting; only suspended blocks messaging', () => {
    expect(blocksPosting('held')).toBe(true)
    expect(blocksPosting('suspended')).toBe(true)
    expect(blocksPosting('throttled')).toBe(false)
    expect(blocksMessaging('suspended')).toBe(true)
    expect(blocksMessaging('held')).toBe(false)
    expect(blocksMessaging('warned')).toBe(false)
  })

  it('severity order is strictly increasing along the ladder', () => {
    expect(ENFORCEMENT_SEVERITY.good_standing).toBeLessThan(ENFORCEMENT_SEVERITY.warned)
    expect(ENFORCEMENT_SEVERITY.warned).toBeLessThan(ENFORCEMENT_SEVERITY.throttled)
    expect(ENFORCEMENT_SEVERITY.throttled).toBeLessThan(ENFORCEMENT_SEVERITY.held)
    expect(ENFORCEMENT_SEVERITY.held).toBeLessThan(ENFORCEMENT_SEVERITY.suspended)
  })

  it('normalizeEnforcementState: unknown/pre-migration values default safe', () => {
    expect(normalizeEnforcementState('suspended')).toBe('suspended')
    expect(normalizeEnforcementState('banned')).toBe('good_standing')
    expect(normalizeEnforcementState(undefined)).toBe('good_standing')
  })
})

describe('velocity spike detector (Phase 3 — silent review flags)', () => {
  const quiet: VelocityInputs = { reviews24h: 0, reviews30d: 0, tx24h: 0, tx30d: 0 }

  it('a quiet account never flags', () => {
    expect(velocitySpike(quiet)).toBe(false)
  })

  it('review burst from zero baseline flags at the absolute floor (5)', () => {
    expect(velocitySpike({ ...quiet, reviews24h: 4, reviews30d: 4 })).toBe(false) // under floor
    expect(velocitySpike({ ...quiet, reviews24h: 5, reviews30d: 5 })).toBe(true) // 5 > 3×(5/30)
  })

  it('transaction burst from zero baseline flags at the absolute floor (8)', () => {
    expect(velocitySpike({ ...quiet, tx24h: 7, tx30d: 7 })).toBe(false)
    expect(velocitySpike({ ...quiet, tx24h: 8, tx30d: 8 })).toBe(true)
  })

  it('a busy shop having a normal day never flags (relative gate)', () => {
    // 300 reviews / 30d → avg 10/day → threshold 30; a 12-review day is just Tuesday.
    expect(velocitySpike({ ...quiet, reviews24h: 12, reviews30d: 300 })).toBe(false)
    // 240 tx / 30d → avg 8/day → threshold 24.
    expect(velocitySpike({ ...quiet, tx24h: 20, tx30d: 240 })).toBe(false)
  })

  it('a busy shop 3×+ above its own baseline flags', () => {
    // avg 2/day (60/30) → threshold 6; a 10-review day is a spike.
    expect(velocitySpike({ ...quiet, reviews24h: 10, reviews30d: 60 })).toBe(true)
    expect(velocitySpike({ ...quiet, tx24h: 10, tx30d: 60 })).toBe(true)
  })

  it('boundary: exactly 3× the average does NOT flag (strictly greater)', () => {
    // avg = 90/30 = 3 → 3×avg = 9; 9 is not > 9.
    expect(velocitySpike({ ...quiet, reviews24h: 9, reviews30d: 90 })).toBe(false)
    expect(velocitySpike({ ...quiet, reviews24h: 10, reviews30d: 90 })).toBe(true)
  })

  it('either axis alone is enough (OR, not AND)', () => {
    expect(velocitySpike({ reviews24h: 0, reviews30d: 0, tx24h: 8, tx30d: 8 })).toBe(true)
    expect(velocitySpike({ reviews24h: 5, reviews30d: 5, tx24h: 0, tx30d: 0 })).toBe(true)
  })

  it('constants match the spec', () => {
    expect(VELOCITY.REVIEWS_24H_MIN).toBe(5)
    expect(VELOCITY.TX_24H_MIN).toBe(8)
    expect(VELOCITY.SPIKE_FACTOR).toBe(3)
    expect(VELOCITY.WINDOW_DAYS).toBe(30)
  })
})

describe('repeat-false-reporter ladder (Phase 3)', () => {
  it('0–1 strikes → normal reporting (the cooldown alone handles 1 strike)', () => {
    expect(reporterStanding(0)).toBe('ok')
    expect(reporterStanding(1)).toBe('ok')
  })

  it('2 strikes → pre-screened (reports land, triaged last)', () => {
    expect(reporterStanding(2)).toBe('prescreen')
  })

  it('≥3 strikes → blocked (403 reporting_blocked with calm copy)', () => {
    expect(reporterStanding(3)).toBe('blocked')
    expect(reporterStanding(10)).toBe('blocked')
  })

  it('thresholds match the spec', () => {
    expect(REPORTER_LADDER.PRESCREEN_STRIKES).toBe(2)
    expect(REPORTER_LADDER.BLOCKED_STRIKES).toBe(3)
  })
})

describe('flag-only reasons (silent review annotations)', () => {
  it('velocity + ban-evasion EMAIL are flags; ban-evasion PHONE review is a real held action', () => {
    expect(isFlagReason(ENFORCEMENT_REASON.VELOCITY_REVIEW)).toBe(true)
    expect(isFlagReason(ENFORCEMENT_REASON.BAN_EVASION_EMAIL)).toBe(true)
    expect(isFlagReason(ENFORCEMENT_REASON.BAN_EVASION_REVIEW)).toBe(false)
    expect(isFlagReason(ENFORCEMENT_REASON.ADMIN_MANUAL)).toBe(false)
  })

  it('every flag reason is a defined reason slug', () => {
    const all = Object.values(ENFORCEMENT_REASON) as string[]
    for (const r of FLAG_REASONS) expect(all).toContain(r)
  })
})

describe('purge + remediation math effects (conduct side)', () => {
  const fresh = (cred: number) => [{ severity: 'moderate' as const, credibility: cred, ageDays: 0 }]

  it('remediation halves the event weight (credibility × REMEDIATION_FACTOR)', () => {
    const full = conductPenalty(fresh(1))
    const remediated = conductPenalty(fresh(1 * TRUST.REMEDIATION_FACTOR))
    expect(TRUST.REMEDIATION_FACTOR).toBe(0.5)
    expect(remediated).toBeCloseTo(full / 2, 10)
  })

  it('purging (excluding) an overturned report removes its penalty entirely', () => {
    const withReport = conductPenalty(fresh(1))
    const purged = conductPenalty([]) // computeTrustV2 filters overturned reports out
    expect(withReport).toBeGreaterThan(0)
    expect(purged).toBe(0)
  })
})
