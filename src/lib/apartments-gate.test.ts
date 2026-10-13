import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * scripts/apartments-gate.sh — the 66-hour success gate of the property-rentals job (scripts/apartments-weekly.sh),
 * run here by the real bash, exactly as the job sources it.
 */
const GATE = join(process.cwd(), 'scripts/apartments-gate.sh')
const dir = mkdtempSync(join(tmpdir(), 'apt-gate-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** Runs `script` after sourcing the gate; returns stdout (trimmed) and the exit code. */
function sh(script: string, env: Record<string, string> = {}): { out: string; code: number } {
  const r = spawnSync('bash', ['-c', `. "${GATE}"; ${script}`], { encoding: 'utf8', env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '/usr/bin:/bin', ...env } })
  return { out: (r.stdout ?? '').trim(), code: r.status ?? -1 }
}
const H = 3600
const NOW = 1_791_871_200 // 2026-10-13T06:00:00Z
let n = 0
/** A stamp file holding `content` (or none when null). */
const stamp = (content: string | null) => {
  const f = join(dir, `last-success-s${n++}`)
  if (content !== null) writeFileSync(f, content)
  return f
}
const due = (f: string, now = NOW, hours?: number) => sh(`source_due "${f}" ${now}${hours === undefined ? '' : ` ${hours}`}`).code === 0

describe('scripts/apartments-gate.sh — the daily trigger runs a source only when its last SUCCESS is ≥ 66 h old', () => {
  it('sourcing it runs nothing, and the gate is 66 hours', () => {
    expect(sh('echo "$GATE_HOURS"')).toEqual({ out: '66', code: 0 })
    expect(sh('true').out).toBe('')
  })

  it('a source that never succeeded is due', () => {
    expect(due(stamp(null))).toBe(true)
  })

  it('due at 66 h and after, not before', () => {
    expect(due(stamp(`${NOW - 66 * H}`))).toBe(true)
    expect(due(stamp(`${NOW - 72 * H} 2026-10-10T06:00:00Z`))).toBe(true)
    expect(due(stamp(`${NOW - (66 * H - 1)}`))).toBe(false)
    expect(due(stamp(`${NOW - 20 * H}`))).toBe(false)
    expect(due(stamp(`${NOW - 44 * H}`))).toBe(false)
  })

  it('⛔ the 3-day cadence on a 06:00 daily trigger: a success stamped at a run\'s START comes due on the third morning, even a run started late', () => {
    const ranAt = NOW                       // a run that started at 06:00 (its import finished at 13:00 — the stamp is the start)
    const f = stamp(`${ranAt}`)
    expect([1, 2, 3].map((d) => due(f, ranAt + d * 24 * H))).toEqual([false, false, true])
    const late = stamp(`${ranAt + 5 * H}`)   // asleep at 06:00, fired on wake at 11:00
    expect([1, 2, 3].map((d) => due(late, ranAt + d * 24 * H))).toEqual([false, false, true])   // 67 h by day 3's 06:00
  })

  it('a failed run writes no stamp, so the next morning runs it again', () => {
    const f = stamp(`${NOW - 30 * H}`)        // the last success, before yesterday's failure
    expect(due(f, NOW)).toBe(false)
    expect(due(f, NOW + 36 * H)).toBe(true)   // 66 h after that success: the failure did not reset anything
  })

  it('⛔ an unreadable or future stamp never holds a source off', () => {
    for (const bad of ['', 'yesterday', '12345', '9999999999999', `-${NOW}`, `${NOW}abc`]) expect(due(stamp(bad)), JSON.stringify(bad)).toBe(true)
    expect(due(stamp(`${NOW + 3600}`))).toBe(true)    // the clock moved back
    expect(sh(`source_due "${stamp(`${NOW}`)}" ""`).code).toBe(0)   // no clock: run rather than skip silently
  })

  it('⛔ a leading zero is decimal, never octal: GATE_HOURS 08, a stamp 0999999999', () => {
    const f = stamp(`${NOW - 9 * H}`)
    expect(due(f, NOW, '08' as unknown as number)).toBe(true)                                   // "08" is 8 hours, not a bash error
    expect(due(f, NOW, '09' as unknown as number)).toBe(true)
    expect(due(f, NOW, '010' as unknown as number)).toBe(false)                                 // 10 h, not octal 8
    expect(sh(`source_due "${stamp('0999999999')}" ${NOW}`).code).toBe(0)                       // 2001: long due, never an error
    expect(sh(`source_due "${f}" ${NOW} 1x`).code).toBe(0)                                        // junk hours: run rather than skip
  })

  it('the gate hours can be passed (or set as GATE_HOURS)', () => {
    const f = stamp(`${NOW - 30 * H}`)
    expect(due(f, NOW, 24)).toBe(true)
    expect(due(f, NOW, 48)).toBe(false)
    expect(sh(`source_due "${f}" ${NOW}`, { GATE_HOURS: '24' }).code).toBe(0)
  })
})

describe('stamps — written atomically, read back (the sweep reads them per seller: src/lib/rental-sweep.ts)', () => {
  it('stamp_write then stamp_read round-trips, with a readable ISO beside the epoch', () => {
    const f = join(dir, 'last-success-rt')
    expect(sh(`stamp_write "${f}" ${NOW}`).code).toBe(0)
    expect(readFileSync(f, 'utf8')).toBe(`${NOW} 2026-10-13T06:00:00Z\n`)
    expect(sh(`stamp_read "${f}"`)).toEqual({ out: String(NOW), code: 0 })
    expect(sh(`stamp_write "${f}" not-a-time`).code).not.toBe(0)
    expect(readFileSync(f, 'utf8')).toBe(`${NOW} 2026-10-13T06:00:00Z\n`)   // a refused write leaves the old stamp
  })

  it('epoch_iso is UTC', () => {
    expect(sh(`epoch_iso ${NOW}`).out).toBe('2026-10-13T06:00:00Z')
  })

})
