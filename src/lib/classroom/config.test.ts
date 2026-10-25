import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/user-blocks', () => ({ isStaffProfile: vi.fn() }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))

const { configFromRow, modeAdmitsTeacher, CLASSROOM_OFF } = await import('./config')

const row = (over: Partial<Parameters<typeof configFromRow>[0] & object> = {}) => ({
  mode: 'allowlist', cohort: ['t-1'], day_minutes: 300, month_minutes: 3000, teacher_month_minutes: 600, spatius_children_ok: false, swept_ok: true, ...over,
})

describe('configFromRow — fails closed', () => {
  it('no row, an unknown mode → off (but READ, so the sweep may act on it)', () => {
    expect(configFromRow(null)).toEqual({ ...CLASSROOM_OFF, readOk: true })
    expect(configFromRow(row({ mode: 'everyone' })).mode).toBe('off')
  })

  it('reads the budgets, dropping anything not a non-negative number to 0', () => {
    const c = configFromRow(row({ day_minutes: -5, month_minutes: Number.NaN }))
    expect([c.dayMinutes, c.monthMinutes, c.teacherMonthMinutes]).toEqual([0, 0, 600])
  })

  it('⛔ sweptOk only when the sweep stamped recently (a stopped sweep closes the classroom to starts and turns)', () => {
    expect(configFromRow(row()).sweptOk).toBe(true)
    expect(configFromRow(row({ swept_ok: null })).sweptOk).toBe(false)
    expect(configFromRow(row({ swept_ok: false })).sweptOk).toBe(false)
    expect(configFromRow(null).sweptOk).toBe(false)
  })

  it('spatiusChildrenOk only on a literal true', () => {
    expect(configFromRow(row({ spatius_children_ok: true })).spatiusChildrenOk).toBe(true)
    expect(configFromRow(row({ spatius_children_ok: 'yes' as unknown as boolean })).spatiusChildrenOk).toBe(false)
  })
})

describe('modeAdmitsTeacher — the decision table', () => {
  const c = (mode: string) => configFromRow(row({ mode }))
  it.each([
    ['off', false, false, false],
    ['off', true, true, false],
    ['staff', false, true, false],
    ['staff', true, false, true],
    ['allowlist', false, false, false],
    ['allowlist', false, true, true],
    ['allowlist', true, false, true],
    ['all', false, false, true],
  ])('%s · staff=%s · in cohort=%s → %s', (mode, staff, inCohort, want) => {
    expect(modeAdmitsTeacher(c(mode as string), inCohort ? 't-1' : 't-2', staff as boolean)).toBe(want)
  })
})
