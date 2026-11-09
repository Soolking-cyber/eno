import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: {} }))

const { progressOf } = await import('./seats')

// Owner, 2026-11-09: teachers "manage" each student's tutor — Praktika's business view, from the seat's own rows.
// Wednesday 2026-11-11 10:00 ICT = 03:00Z: the third day of the ICT week (Monday 2026-11-09).
const WED = new Date('2026-11-11T03:00:00Z')
const seat = (o: Partial<Parameters<typeof progressOf>[0]> = {}) => ({ status: 'active', lastSpokeAt: new Date('2026-11-10T03:00:00Z'), sessionsThisWeek: 1, sessionsPerWeek: 3, ...o })

describe('where a student stands this week', () => {
  it('an invite not yet taken, or a student who never spoke in a session, has not started', () => {
    expect(progressOf(seat({ status: 'invited', lastSpokeAt: null }), WED)).toBe('not_started')
    expect(progressOf(seat({ lastSpokeAt: null, sessionsThisWeek: 0 }), WED)).toBe('not_started')
  })
  it('a paused seat says so, whatever its sessions', () => {
    expect(progressOf(seat({ status: 'paused' }), WED)).toBe('paused')
  })
  it('two weeks or more since they last spoke = inactive', () => {
    expect(progressOf(seat({ lastSpokeAt: new Date(WED.getTime() - 14 * 86_400_000), sessionsThisWeek: 0 }), WED)).toBe('inactive')
    expect(progressOf(seat({ lastSpokeAt: new Date(WED.getTime() - 13 * 86_400_000), sessionsThisWeek: 0 }), WED)).not.toBe('inactive')
  })
  it('behind = fewer sessions than the week\'s target prorated to the days gone (3 a week: 1 due by Wednesday)', () => {
    expect(progressOf(seat({ sessionsThisWeek: 0 }), WED)).toBe('behind')
    expect(progressOf(seat({ sessionsThisWeek: 1 }), WED)).toBe('on_track')
  })
  it('Monday morning never reads as behind for a 3-a-week student', () => {
    const MON = new Date('2026-11-09T01:00:00Z')
    expect(progressOf(seat({ sessionsThisWeek: 0, lastSpokeAt: new Date('2026-11-06T03:00:00Z') }), MON)).toBe('on_track')
  })
  it('by Sunday the whole target is due', () => {
    const SUN = new Date('2026-11-15T10:00:00Z')
    expect(progressOf(seat({ sessionsThisWeek: 2 }), SUN)).toBe('behind')
    expect(progressOf(seat({ sessionsThisWeek: 3 }), SUN)).toBe('on_track')
  })
})
