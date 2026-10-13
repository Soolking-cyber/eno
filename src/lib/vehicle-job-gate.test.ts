import { describe, expect, it } from 'vitest'
import { SUCCESS_GATE_HOURS, successGate } from './vehicle-job-gate'

const H = 3_600_000
const NOW = Date.parse('2026-10-19T04:30:00+07:00')
const ago = (hours: number) => new Date(NOW - hours * H).toISOString()

describe('successGate — every 3 days on a daily trigger', () => {
  it('runs when no successful run is recorded', () => {
    expect(successGate(null, NOW).due).toBe(true)
    expect(successGate('  \n', NOW).due).toBe(true)
  })

  it(`waits until the last success is ${SUCCESS_GATE_HOURS} h old`, () => {
    expect(successGate(ago(65.9), NOW)).toMatchObject({ due: false })
    expect(successGate(ago(66), NOW).due).toBe(true)
    expect(successGate(ago(200), NOW).due).toBe(true)
  })

  it('a run that finished at 08:00 is due again on the third morning’s 04:30 trigger, not the fourth', () => {
    const finished = Date.parse('2026-10-16T08:00:00+07:00')
    const stamp = new Date(finished).toISOString()
    expect(successGate(stamp, Date.parse('2026-10-17T04:30:00+07:00')).due).toBe(false)
    expect(successGate(stamp, Date.parse('2026-10-18T04:30:00+07:00')).due).toBe(false)
    expect(successGate(stamp, Date.parse('2026-10-19T04:30:00+07:00')).due).toBe(true)
  })

  it('says when the next run is due', () => {
    expect(successGate(ago(24), NOW).reason).toMatch(/next run in 42\.0 h/)
  })

  it('never lets an untrustworthy stamp block the refresh', () => {
    expect(successGate('yesterday', NOW).due).toBe(true)
    expect(successGate(new Date(NOW + 2 * H).toISOString(), NOW).due).toBe(true)
    // a few minutes of clock skew is still a recent run
    expect(successGate(new Date(NOW + 5 * 60_000).toISOString(), NOW).due).toBe(false)
  })

  it('reads the stamp the job writes (`date -u +%Y-%m-%dT%H:%M:%SZ` plus a newline)', () => {
    expect(successGate('2026-10-16T01:00:00Z\n', NOW).due).toBe(true)
    expect(successGate('2026-10-18T01:00:00Z\n', NOW).due).toBe(false)
  })
})
