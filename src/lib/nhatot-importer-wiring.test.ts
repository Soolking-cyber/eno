import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * scripts/import-nhatot-com.ts runs `main()` on import and opens the network and a database, so the
 * places where it CALLS the pure guards in src/lib/nhatot-listing.ts are pinned here at the source
 * level; the guards themselves are tested there. Each assertion fails if the call is removed.
 */
const src = readFileSync('scripts/import-nhatot-com.ts', 'utf8')

describe('scripts/import-nhatot-com.ts wiring', () => {
  it('reads the publisher’s robots.txt on every run that touches the network (nhatotRunReadsNetwork)', () => {
    expect(src).toMatch(/if \(nhatotRunReadsNetwork\(\{ src: !!SRC, apply: APPLY, probePhotos: PROBE_PHOTOS \}\)\) policy = await sitePolicy\(\)/)
  })

  it('checks a halted host before every request, robots.txt included, and halts it on a 429 or challenge (nhatotHostHalt)', () => {
    const spaced = src.slice(src.indexOf('async function spaced('), src.indexOf('const drain ='))
    expect(spaced).toMatch(/const why = halted\.get\(host\)\n\s+if \(why\) throw new StopRead/)
    expect(spaced).toMatch(/const halt = nhatotHostHalt\(res\.status, res\.headers\.get\('cf-mitigated'\)\)\n\s+if \(halt\) halted\.set\(host, halt\)/)
  })

  it('refuses a --cap run that leaves a read city uncapped (nhatotCapsProblem), before any request', () => {
    const main = src.slice(src.indexOf('async function importMain('))
    const check = main.indexOf('const capsProblem = nhatotCapsProblem(CITIES, CAPS)')
    expect(check).toBeGreaterThan(0)
    expect(check).toBeLessThan(main.indexOf('await sitePolicy()'))
  })

  it('ends a slice read with nhatotSliceEnd (a missing total is not zero), and exits by nhatotApplyExitCode', () => {
    expect(src).toMatch(/if \(nhatotSliceEnd\(o, rep\.total\)\) break/)
    expect(src).toMatch(/process\.exitCode = nhatotApplyExitCode\(stat, stopped\)/)
  })
})
