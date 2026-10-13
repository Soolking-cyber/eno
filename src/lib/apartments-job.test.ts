import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { FRESH_DAYS } from './apartment-freshness'
import { SWEEP_DAYS } from './rental-sweep'

/**
 * scripts/apartments-weekly.sh — the property-rentals job (daily trigger, 66 h gate per source, the sweep every run),
 * RUN END TO END in a sandbox: every `npx tsx …` step, the tunnel, psql and the Batdongsan scraper are stubs that
 * record their command line, so the job's own control flow is what is under test — the gate, the stamps, the order of
 * steps, what each source is asked to read, and that the sweep runs on every run. Nothing touches a network or a DB.
 */
const REPO = process.cwd()
const JOB = join(REPO, 'scripts/apartments-weekly.sh')
const sh = readFileSync(JOB, 'utf8')
const code = sh.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
const root = mkdtempSync(join(tmpdir(), 'apt-job-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const STUB_NPX = `#!/bin/bash
echo "npx $*" >> "$SANDBOX/calls.log"
if [ -f "$SANDBOX/hang-on" ]; then h="$(cat "$SANDBOX/hang-on")"; case "$*" in *"$h"*) sleep 60 ;; esac; fi
args=("$@")
for ((i=0; i<\${#args[@]}; i++)); do
  case "\${args[$i]}" in --save|--fresh-out|--stage) touch "\${args[$((i+1))]}" ;; esac
done
case "$*" in *"expire-rentals.ts --sweep"*)
  if [ -f "$SANDBOX/sweep-writes-journal" ]; then for ((i=0; i<\${#args[@]}; i++)); do [ "\${args[$i]}" = --journal-dir ] && mkdir -p "\${args[$((i+1))]}" && touch "\${args[$((i+1))]}/rental-expiry-places-test.json"; done; fi ;;
esac
while IFS='=' read -r pat rc; do
  [ -n "$pat" ] || continue
  case "$*" in *"$pat"*) echo "stub exit $rc for $pat"; exit "$rc" ;; esac
done < "$SANDBOX/exits"
case "$*" in
  *windowDaysFor*) echo 30 ;;
  *"expire-rentals.ts --sweep"*) echo "SWEEP stub $*" ;;
  *"import-nhatot-com.ts --src"*) echo "APPLY COMPLETED" ;;
esac
exit 0
`
const STUB_TUNNEL = `#!/bin/bash
echo "tunnel $*" >> "$SANDBOX/calls.log"
[ -f "$SANDBOX/tunnel-fails" ] && exit 1
touch "$SANDBOX/tunnel-up"
`
const STUB_NC = `#!/bin/bash
[ -f "$SANDBOX/tunnel-up" ]
`
const STUB_PSQL = `#!/bin/bash
echo "psql $*" >> "$SANDBOX/calls.log"
`
const STUB_BDS_PY = `#!/bin/bash
echo "bds-python $*" >> "$SANDBOX/calls.log"
case "$1" in scraper.py) echo '[]' > all_rentals.json; echo '{}' > all_rentals.crawl.json ;; esac
`

type Run = { code: number; out: string; calls: string[]; sandbox: string }
let boxes = 0
/** A fresh sandbox: a stub repo (the real gate library), stub binaries, a Batdongsan dir with a 10-day-old archive. */
function sandbox(): string {
  const box = join(root, `box${boxes++}`)
  for (const d of ['repo/scripts', 'bin', 'journal', 'bds/.venv/bin']) mkdirSync(join(box, d), { recursive: true })
  copyFileSync(join(REPO, 'scripts/apartments-gate.sh'), join(box, 'repo/scripts/apartments-gate.sh'))
  const exe = (p: string, body: string) => { writeFileSync(p, body); chmodSync(p, 0o755) }
  exe(join(box, 'repo/scripts/db-tunnel.sh'), STUB_TUNNEL)
  exe(join(box, 'bin/npx'), STUB_NPX)
  exe(join(box, 'bin/nc'), STUB_NC)
  exe(join(box, 'bin/psql'), STUB_PSQL)
  exe(join(box, 'bds/.venv/bin/python'), STUB_BDS_PY)
  const archive = join(box, 'bds/all_rentals.2026-10-01-123808.json')
  writeFileSync(archive, '[]')
  const old = Date.now() / 1000 - 10 * 86_400
  utimesSync(archive, old, old)
  writeFileSync(join(box, 'env'), 'DIRECT_URL=postgresql://stub@127.0.0.1:5433/x\n')
  writeFileSync(join(box, 'exits'), '')
  writeFileSync(join(box, 'tunnel-up'), '')
  return box
}
/** The job's environment in `box`. */
const jobEnv = (box: string, env: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  ...env, NODE_ENV: 'test', PATH: `${join(box, 'bin')}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: box, SANDBOX: box,
  ENO_REPO: join(box, 'repo'), APT_ENV_FILE: join(box, 'env'), APT_JOURNAL: join(box, 'journal'),
  BDS_DIR: join(box, 'bds'), APT_NOTIFY: '0',
})
/** Runs the REAL job in `box`. `exits`: "<substring of the npx command line>=<exit code>" lines. */
function run(box: string, args: string[], o: { exits?: string[]; env?: Record<string, string> } = {}): Run {
  writeFileSync(join(box, 'exits'), (o.exits ?? []).join('\n') + '\n')
  rmSync(join(box, 'calls.log'), { force: true })
  const r = spawnSync('/bin/bash', [JOB, ...args], { encoding: 'utf8', env: jobEnv(box, o.env) })
  const calls = existsSync(join(box, 'calls.log')) ? readFileSync(join(box, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean) : []
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}`, calls, sandbox: box }
}
const stamps = (box: string) => readdirSync(join(box, 'journal/state')).filter((f) => f.startsWith('last-success-')).sort()
const stampOf = (box: string, src: string) => readFileSync(join(box, 'journal/state', `last-success-${src}`), 'utf8')
const idx = (calls: string[], needle: string) => calls.findIndex((c) => c.includes(needle))
/** The gate units run by default (APT_PLACES=0: apartments only), sorted — each its own success stamp. */
const SOURCES = ['batdongsan', 'honeycomb', 'muaban', 'nhatot', 'rever']
/** …and with APT_PLACES=1: Nhà Tốt's and Muaban's houses, rooms and offices as their own units. */
const ALL_SOURCES = ['batdongsan', 'honeycomb', 'muaban', 'muaban-places', 'nhatot', 'nhatot-places', 'rever']
/** A live process whose command line names the job — what a running refresh looks like to `ps` (a reused pid does not). */
const holder = () => spawn('bash', ['-c', 'exec -a apartments-weekly-holder sleep 120'], { stdio: 'ignore' })

/** Each run spawns some forty stub processes — seconds on a loaded machine, so these get a minute, not vitest's 5 s. */
const SLOW = { timeout: 60_000 }

describe('the job, run end to end on stubs — a first --apply run (every source due)', SLOW, () => {
  const box = sandbox()
  const first = run(box, ['--apply'])

  it('runs every apartment source, classify, then the sweep — and exits 0', () => {
    expect(first.code, first.out).toBe(0)
    for (const step of ['import-nhatot-com.ts --cg 1010', 'import-muaban-net.ts --types apartment', 'import-honeycomb-com-vn.ts --since-days', 'retire-rever-rentals.ts --save', 'scraper.py', 'import-batdongsan-rentals.ts', 'classify-apartment-rentals.ts']) {
      expect(idx(first.calls, step), step).toBeGreaterThan(-1)
    }
    const sweep = idx(first.calls, 'expire-rentals.ts --sweep')
    expect(sweep).toBe(first.calls.length - 1)                                   // the sweep is the LAST step
    expect(idx(first.calls, 'classify-apartment-rentals.ts')).toBeLessThan(sweep)
  })

  it('⛔ APT_PLACES unset = APARTMENTS ONLY: no houses/rooms/offices unit runs, Batdongsan reads its two apartment lists', () => {
    expect(first.out).toMatch(/houses, rooms and offices are not imported \(APT_PLACES=0/)
    expect(idx(first.calls, '--cg 1020,1030,1050')).toBe(-1)
    expect(idx(first.calls, '--types house,room,office')).toBe(-1)
    expect(first.calls.find((x) => x.includes('bds-python scraper.py'))).toBe('bds-python scraper.py --apartments --to-end --new')
    expect(first.calls.find((x) => x.includes('import-batdongsan-rentals.ts'))).toContain('--max-age-days 7 --subcat apartment-rental --fresh-out ')
  })

  it('⛔ writes a success stamp per gate unit holding the run START, and points the sweep at them', () => {
    expect(stamps(box)).toEqual(SOURCES.map((s) => `last-success-${s}`))
    const [epoch] = stampOf(box, 'nhatot').trim().split(' ')
    expect(new Set(SOURCES.map((s) => stampOf(box, s)))).toEqual(new Set([stampOf(box, 'nhatot')]))   // one START for all
    expect(Math.abs(Number(epoch) * 1000 - Date.now())).toBeLessThan(10 * 60_000)
    expect(first.calls.at(-1)).toContain(`expire-rentals.ts --sweep --stamps-dir ${join(box, 'journal/state')} --journal-dir `)
    expect(first.calls.at(-1)).toMatch(/ --apply$/)
  })

  it('asks each source for its apartments, at 7 days — and Nhà Tốt for its SET in a second read, after the apply, right before the expiry', () => {
    const c = (needle: string) => first.calls.find((x) => x.includes(needle)) ?? ''
    expect(c('import-nhatot-com.ts --cg 1010 --max-age-days 7 --save')).toMatch(/--save \S+nhatot-stage\.json --fresh-crawl$/)
    expect(c('import-nhatot-com.ts --src')).toContain('--max-age-days 7 --journal-dir ')
    expect(c('import-nhatot-com.ts --cg 1010 --max-age-days 7 --fresh-out')).toMatch(/--fresh-out \S+nhatot-fresh\.json --no-probe$/)
    const stage = idx(first.calls, 'nhatot-stage.json --fresh-crawl'), apply = idx(first.calls, 'import-nhatot-com.ts --src')
    const set = idx(first.calls, 'nhatot-fresh.json --no-probe'), expire = idx(first.calls, 'expire-apartment-rentals.ts --seller nhatot-import-seller-0001 --fresh')
    expect(stage).toBeLessThan(apply)
    expect(apply).toBeLessThan(set)
    expect(set).toBe(expire - 1)                                                                                   // read, then at once the expiry
    expect(c('import-muaban-net.ts --types apartment')).toMatch(/--fresh-out \S+muaban-fresh\.json$/)
    expect(first.calls.filter((x) => x.includes('import-muaban-net.ts --src')).length).toBe(1)
    expect(c('import-honeycomb-com-vn.ts --since-days')).toMatch(/--since-days 30 --save \S+ --fresh-out \S+$/)      // the set: its 30-day window
    expect(c('import-honeycomb-com-vn.ts --src')).toContain('--since-days 7 --journal-dir ')                          // the apply: 7 days
    expect(c('import-batdongsan-rentals.ts')).toContain('--max-age-days 7 ')
    expect(first.calls.filter((x) => x.includes('expire-apartment-rentals.ts --seller') && x.includes('--backstop')).length).toBe(5)   // per seller, not per unit
  })

  it('⛔ the next morning nothing is due: the imports are skipped and ONLY the sweep runs', () => {
    const next = run(box, ['--apply'])
    expect(next.code, next.out).toBe(0)
    expect(next.calls.filter((c) => c.startsWith('npx'))).toEqual([expect.stringContaining('expire-rentals.ts --sweep --stamps-dir ')])
    expect(next.out).toMatch(/── nhatot: last success .* — under 66 h ago, not due/)
    expect(next.out).toMatch(/no source due — the imports are skipped today; the sweep still runs/)
  })

  it('--force-imports runs them anyway', () => {
    const forced = run(box, ['--apply', '--force-imports'], { env: { APT_SOURCES: 'rever' } })
    expect(forced.code, forced.out).toBe(0)
    expect(idx(forced.calls, 'retire-rever-rentals.ts --save')).toBeGreaterThan(-1)
  })
})

describe('the job with APT_PLACES=1 — houses, rooms and offices too (the owner\'s call on photo storage)', SLOW, () => {
  const box = sandbox()
  const r = run(box, ['--apply'], { env: { APT_PLACES: '1' } })

  it('runs the places units LAST, after every apartment source, each with its time-bounded set-less read', () => {
    expect(r.code, r.out).toBe(0)
    expect(r.out).not.toMatch(/are not imported/)
    const places = [idx(r.calls, 'import-nhatot-com.ts --cg 1020,1030,1050'), idx(r.calls, 'import-muaban-net.ts --types house,room,office')]
    for (const at of places) expect(at).toBeGreaterThan(idx(r.calls, 'import-batdongsan-rentals.ts'))
    const c = (needle: string) => r.calls.find((x) => x.includes(needle)) ?? ''
    expect(c('import-nhatot-com.ts --cg 1020,1030,1050')).toMatch(/--cg 1020,1030,1050 --max-age-days 7 --save \S+nhatot-places-stage\.json --fresh-crawl$/)
    expect(r.calls.filter((x) => x.includes('import-nhatot-com.ts --src')).map((x) => /--src (\S+)/.exec(x)![1].split('/').pop())).toEqual(['nhatot-stage.json', 'nhatot-places-stage.json'])
    expect(c('import-muaban-net.ts --types house,room,office')).toMatch(/--stage \S+muaban-places-stage\.jsonl --fresh-crawl$/)
    expect(r.calls.filter((x) => x.includes('import-muaban-net.ts --src')).length).toBe(2)
    expect(c('bds-python scraper.py')).toBe('bds-python scraper.py --to-end --new')                    // the whole list
    expect(c('import-batdongsan-rentals.ts')).not.toContain('--subcat')
    // no set, no expiry and no second backstop for a places unit
    expect(r.calls.filter((x) => x.includes('expire-apartment-rentals.ts --seller') && x.includes('--fresh ')).length).toBe(5)
    expect(r.calls.filter((x) => x.includes('expire-apartment-rentals.ts --seller') && x.includes('--backstop')).length).toBe(5)
  })
  it('stamps every unit, the places units included', () => {
    expect(stamps(box)).toEqual(ALL_SOURCES.map((s) => `last-success-${s}`))
  })
})

describe('the job — failures, the gate and the tunnel', SLOW, () => {
  it('⛔ a failed source gets NO stamp (it retries the next morning); the others do; the sweep still runs; exit 1', () => {
    const box = sandbox()
    const env = { APT_SOURCES: 'nhatot muaban rever' }
    const r = run(box, ['--apply'], { env, exits: ['import-muaban-net.ts --types apartment=1'] })
    expect(r.code).toBe(1)
    expect(stamps(box)).toEqual(['nhatot', 'rever'].map((s) => `last-success-${s}`))
    expect(r.out).toMatch(/✗ muaban FAILED at: stage/)
    expect(r.out).toMatch(/── property-rentals: FAILED muaban/)
    expect(r.calls.at(-1)).toContain('expire-rentals.ts --sweep')
    // and the next morning only muaban is due
    const again = run(box, ['--apply'], { env })
    expect(again.code, again.out).toBe(0)
    expect(again.calls.filter((c) => c.startsWith('npx') && !c.includes('--sweep') && !c.includes('classify')).every((c) => /muaban|--seller muaban-net-import-seller-0001/.test(c))).toBe(true)
    expect(stamps(box)).toContain('last-success-muaban')
  })

  it('a coverage refusal (exit 3) imports, skips that expiry, and fails the unit; a partial places crawl is applied and retried — without re-crawling the apartments', () => {
    const box = sandbox()
    const r = run(box, ['--apply'], { env: { APT_PLACES: '1', APT_SOURCES: 'muaban muaban-places' }, exits: ['--types house,room,office=3'] })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/✗ muaban-places-incomplete FAILED at: a house\/room\/office list was not read whole — what was read is imported, the rest retried tomorrow/)
    expect(idx(r.calls, 'muaban-places-stage.jsonl --journal')).toBeGreaterThan(-1)                            // what was read is applied
    expect(stamps(box)).toEqual(['last-success-muaban'])                                                       // the apartments unit is done
    const again = run(box, ['--apply'], { env: { APT_PLACES: '1', APT_SOURCES: 'muaban muaban-places' } })
    expect(idx(again.calls, '--types house,room,office')).toBeGreaterThan(-1)                                  // the places retry the next morning…
    expect(idx(again.calls, '--types apartment')).toBe(-1)                                                     // …the apartments wait their 66 h
    const refused = run(sandbox(), ['--apply'], { env: { APT_SOURCES: 'nhatot' }, exits: ['nhatot-stage.json --fresh-crawl=3'] })
    expect(refused.out).toMatch(/✗ nhatot FAILED at: a list was not read whole — imported, expiry skipped/)
    expect(idx(refused.calls, 'import-nhatot-com.ts --src')).toBeGreaterThan(-1)
    expect(idx(refused.calls, '--fresh-out')).toBe(-1)                                                       // no set read either
    expect(idx(refused.calls, 'expire-apartment-rentals.ts --seller nhatot-import-seller-0001 --fresh')).toBe(-1)
    expect(stamps(refused.sandbox)).toEqual([])
  })

  it('⛔ Nhà Tốt\'s SET read not proven whole (exit 3): the apply stands, the expiry is skipped, no stamp', () => {
    const r = run(sandbox(), ['--apply'], { env: { APT_SOURCES: 'nhatot' }, exits: ['nhatot-fresh.json --no-probe=3'] })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/✗ nhatot FAILED at: the set's read did not prove the window covered \(exit 3\) — expiry skipped/)
    expect(idx(r.calls, 'import-nhatot-com.ts --src')).toBeGreaterThan(-1)
    expect(idx(r.calls, 'expire-apartment-rentals.ts --seller nhatot-import-seller-0001 --fresh')).toBe(-1)
    expect(stamps(r.sandbox)).toEqual([])
  })

  it('⛔ a Nhà Tốt houses/offices/rooms read cut short (exit 3) is applied and retried tomorrow — without re-reading the apartments', () => {
    const box = sandbox()
    const env = { APT_PLACES: '1', APT_SOURCES: 'nhatot nhatot-places' }
    const r = run(box, ['--apply'], { env, exits: ['nhatot-places-stage.json --fresh-crawl=3'] })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/✗ nhatot-places-incomplete FAILED at: a house\/office\/room list was not read whole — what was read is imported, the rest retried tomorrow/)
    expect(idx(r.calls, 'nhatot-places-stage.json --max-age-days 7 --journal-dir')).toBeGreaterThan(-1)    // what was read is applied
    expect(stamps(box)).toEqual(['last-success-nhatot'])                                                       // the apartments unit is done
    const again = run(box, ['--apply'], { env })
    expect(idx(again.calls, '--cg 1020,1030,1050')).toBeGreaterThan(-1)                                        // the places retry the next morning…
    expect(idx(again.calls, 'import-nhatot-com.ts --cg 1010')).toBe(-1)                                        // …the apartments wait their 66 h
    expect(stamps(box)).toEqual(['last-success-nhatot', 'last-success-nhatot-places'])
  })

  it('⛔ an apply that finished with row errors still expires, but gets no stamp (the rows are retried tomorrow)', () => {
    const box = sandbox()
    const r = run(box, ['--apply'], { env: { APT_SOURCES: 'nhatot' }, exits: ['import-nhatot-com.ts --src=1'] })
    // the stub prints APPLY COMPLETED only on exit 0, so make it look like "finished with row errors" by its log:
    expect(r.out).toMatch(/✗ nhatot FAILED at: apply/)
    const box2 = sandbox()
    writeFileSync(join(box2, 'bin/npx'), readFileSync(join(box2, 'bin/npx'), 'utf8').replace('*"import-nhatot-com.ts --src"*) echo "APPLY COMPLETED" ;;', '*"import-nhatot-com.ts --src"*) echo "APPLY COMPLETED"; exit 1 ;;'))
    const e = run(box2, ['--apply'], { env: { APT_SOURCES: 'nhatot' } })
    expect(e.out).toMatch(/✗ nhatot-apply-row-errors FAILED at: the apply finished with row errors — retried tomorrow/)
    expect(idx(e.calls, 'expire-apartment-rentals.ts --seller nhatot-import-seller-0001 --fresh')).toBeGreaterThan(-1)
    expect(stamps(box2)).toEqual([])
  })

  it('⛔ a run KILLED between its imports and classify leaves classify owed: the next morning runs it with nothing due', async () => {
    const box = sandbox()
    writeFileSync(join(box, 'hang-on'), 'classify-apartment-rentals.ts')                         // the stub hangs there
    const child = spawn('/bin/bash', [JOB, '--apply'], { env: jobEnv(box, { APT_SOURCES: 'rever' }), detached: true, stdio: 'ignore' })
    const calls = join(box, 'calls.log')
    for (let i = 0; i < 600 && !(existsSync(calls) && readFileSync(calls, 'utf8').includes('classify-apartment-rentals.ts')); i++) await new Promise((r) => setTimeout(r, 100))
    process.kill(-child.pid!, 'SIGKILL')                                                           // a shutdown: no trap runs
    expect(stamps(box)).toEqual(['last-success-rever'])                                           // the import had succeeded…
    expect(existsSync(join(box, 'journal/state/classify-pending'))).toBe(true)                    // …and classify is owed
    rmSync(join(box, 'hang-on'))
    const next = run(box, ['--apply'], { env: { APT_SOURCES: 'rever' } })
    expect(next.code, next.out).toBe(0)
    expect(idx(next.calls, 'retire-rever-rentals.ts')).toBe(-1)                                    // nothing due…
    expect(idx(next.calls, 'classify-apartment-rentals.ts')).toBeGreaterThan(-1)                  // …classify runs
    expect(existsSync(join(box, 'journal/state/classify-pending'))).toBe(false)
  })

  it('⛔ the sweep agent (--sweep-only) only LOOKS at the refresh lock: a refresh stuck over 36 h is alerted, a running one is not', () => {
    const box = sandbox()
    const lock = join(box, 'journal/.weekly.lock')
    mkdirSync(lock, { recursive: true })
    const h = holder()
    try {
      writeFileSync(join(lock, 'pid'), String(h.pid))
      const ok = run(box, ['--apply', '--sweep-only'])
      expect(ok.code, ok.out).toBe(0)                                                              // a refresh under way: nothing to say
      expect(ok.calls.filter((c) => c.startsWith('npx'))).toEqual([expect.stringContaining('expire-rentals.ts --sweep')])
      const old = Date.now() / 1000 - 40 * 3600
      utimesSync(join(lock, 'pid'), old, old)
      const stuck = run(box, ['--apply', '--sweep-only'])
      expect(stuck.code).toBe(1)
      expect(stuck.out).toMatch(/that run has held the lock for over 36 h/)
      expect(stuck.calls.filter((c) => c.startsWith('npx'))).toEqual([expect.stringContaining('expire-rentals.ts --sweep')])   // and the sweep still ran
      expect(readFileSync(join(lock, 'pid'), 'utf8')).toBe(String(h.pid))                          // never taken over
    } finally { h.kill() }
  })

  it('a --sweep-only run never touches the refresh lock (it must not hold a morning\'s refresh off)', () => {
    const box = sandbox()
    const lock = join(box, 'journal/.weekly.lock')
    mkdirSync(lock, { recursive: true })
    writeFileSync(join(lock, 'pid'), '999999')                                                    // dead: a refresh run would clear it
    const r = run(box, ['--apply', '--sweep-only'])
    expect(r.code, r.out).toBe(0)
    expect(r.calls.filter((c) => c.startsWith('npx'))).toEqual([expect.stringContaining('expire-rentals.ts --sweep')])
    expect(readFileSync(join(lock, 'pid'), 'utf8')).toBe('999999')                                // left exactly as it was
  })

  it('⛔ a failed classify runs again the next morning even when no import is due', () => {
    const box = sandbox()
    const r = run(box, ['--apply'], { env: { APT_SOURCES: 'rever' }, exits: ['classify-apartment-rentals.ts=1'] })
    expect(r.code).toBe(1)
    expect(existsSync(join(box, 'journal/state/classify-pending'))).toBe(true)
    const next = run(box, ['--apply'], { env: { APT_SOURCES: 'rever' } })                                // rever not due: no import
    expect(next.code, next.out).toBe(0)
    expect(idx(next.calls, 'retire-rever-rentals.ts')).toBe(-1)
    expect(idx(next.calls, 'classify-apartment-rentals.ts')).toBeGreaterThan(-1)
    expect(next.out).toMatch(/classify \(pending from an earlier run\)/)
    expect(existsSync(join(box, 'journal/state/classify-pending'))).toBe(false)
    const third = run(box, ['--apply'], { env: { APT_SOURCES: 'rever' } })
    expect(idx(third.calls, 'classify-apartment-rentals.ts')).toBe(-1)                                       // done: not again
  })

  it('⛔ the tunnel is re-checked before every database step: a dropped tunnel is restarted, a dead one fails the step (not the run)', () => {
    const box = sandbox()
    rmSync(join(box, 'tunnel-up'))
    const r = run(box, ['--apply'], { env: { APT_SOURCES: 'rever' } })
    expect(r.code, r.out).toBe(0)
    expect(r.calls[0]).toBe('tunnel start')                                                                  // restarted, then the steps
    expect(idx(r.calls, 'retire-rever-rentals.ts --save')).toBeGreaterThan(0)

    const dead = sandbox()
    rmSync(join(dead, 'tunnel-up'))
    writeFileSync(join(dead, 'tunnel-fails'), '')
    const d = run(dead, ['--apply'], { env: { APT_SOURCES: 'rever' } })
    expect(d.code).toBe(1)
    expect(d.calls.filter((c) => c.startsWith('npx'))).toEqual([])                                             // no DB step ran blind
    expect(d.out).toMatch(/✗ rever FAILED at: check/)
    expect(d.out).toMatch(/sweep FAILED/)
    expect(readFileSync(join(dead, 'journal', readdirSync(join(dead, 'journal')).find((f) => /^20/.test(f))!, 'rever-check.log'), 'utf8')).toMatch(/DB tunnel to the box is down/)
    expect(stamps(dead)).toEqual([])
  })

  it('⛔ APT_PLACES is the ONE switch: an APT_SOURCES naming a places unit without APT_PLACES=1 is refused before anything runs', () => {
    for (const unit of ['nhatot-places', 'muaban-places']) {
      const r = run(sandbox(), ['--apply'], { env: { APT_SOURCES: `nhatot ${unit}` } })
      expect(r.code, unit).toBe(1)
      expect(r.out).toMatch(new RegExp(`${unit} imports houses, rooms and offices — that is APT_PLACES=1, the owner's call \\(the header\\); this run did nothing`))
      expect(r.calls).toEqual([])
    }
    const ok = run(sandbox(), ['--apply'], { env: { APT_PLACES: '1', APT_SOURCES: 'nhatot-places' } })
    expect(ok.code, ok.out).toBe(0)
    expect(idx(ok.calls, '--cg 1020,1030,1050')).toBeGreaterThan(-1)
  })

  it('⛔ a refresh that finds the lock held only sweeps — so a bad APT_PLACES does not stop it either', () => {
    const box = sandbox()
    const lock = join(box, 'journal/.weekly.lock')
    mkdirSync(lock, { recursive: true })
    const h = holder()
    try {
      writeFileSync(join(lock, 'pid'), String(h.pid))
      const r = run(box, ['--apply'], { env: { APT_PLACES: 'yes' } })
      expect(r.code, r.out).toBe(0)
      expect(r.calls.filter((c) => c.startsWith('npx'))).toEqual([expect.stringContaining('expire-rentals.ts --sweep --stamps-dir ')])
      expect(readFileSync(join(lock, 'pid'), 'utf8')).toBe(String(h.pid))
    } finally { h.kill() }
  })

  it('⛔ the places units run LAST whatever order APT_SOURCES gives', () => {
    const r = run(sandbox(), ['--apply'], { env: { APT_PLACES: '1', APT_SOURCES: 'nhatot-places rever nhatot' } })
    expect(r.code, r.out).toBe(0)
    const order = ['retire-rever-rentals.ts --save', 'import-nhatot-com.ts --cg 1010', 'import-nhatot-com.ts --cg 1020,1030,1050'].map((n) => idx(r.calls, n))
    expect(order.every((at) => at > -1)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('⛔ a --sweep-only run imports nothing, so a bad APT_PLACES or a places APT_SOURCES never costs the day\'s sweep', () => {
    for (const env of [{ APT_PLACES: 'yes' }, { APT_SOURCES: 'nhatot nhatot-places' }] as Record<string, string>[]) {
      const r = run(sandbox(), ['--apply', '--sweep-only'], { env })
      expect(r.code, `${JSON.stringify(env)}\n${r.out}`).toBe(0)
      expect(r.calls.filter((c) => c.startsWith('npx'))).toEqual([expect.stringContaining('expire-rentals.ts --sweep --stamps-dir ')])
    }
  })

  it('a sweep that held a seller back (exit 3) is reported and alerts; --sweep-only runs nothing else', () => {
    const box = sandbox()
    const r = run(box, ['--apply', '--sweep-only'], { exits: ['expire-rentals.ts --sweep=3'] })
    expect(r.code).toBe(1)
    expect(r.calls.filter((c) => c.startsWith('npx'))).toEqual([expect.stringContaining('expire-rentals.ts --sweep --stamps-dir ')])
    expect(r.out).toMatch(/✗ sweep HELD BACK rows of a refresh that is dead/)
  })

  it('a dry run ignores the gate, writes no stamp, and passes neither --apply nor a journal dir', () => {
    const box = sandbox()
    writeFileSync(join(box, 'bds/all_rentals.json'), '[]')
    const r = run(box, [], { env: { APT_SOURCES: 'nhatot batdongsan' } })
    expect(r.code, r.out).toBe(0)
    expect(existsSync(join(box, 'journal/state')) ? stamps(box) : []).toEqual([])
    expect(r.calls.some((c) => / --apply\b/.test(c) || c.includes('--journal-dir'))).toBe(false)
    expect(idx(r.calls, 'scraper.py')).toBe(-1)                                                               // a dry run leaves the dataset alone
    expect(r.calls.at(-1)).toMatch(/expire-rentals\.ts --sweep --stamps-dir \S+$/)
  })

  it('refuses an unknown argument, and a malformed GATE_HOURS / LOCK_ALERT_HOURS before anything runs', () => {
    expect(run(sandbox(), ['--aply']).code).toBe(2)
    const g = run(sandbox(), ['--apply'], { env: { GATE_HOURS: '66h' } })
    expect(g.code).toBe(1)
    expect(g.out).toMatch(/GATE_HOURS must be a whole number of hours, not "66h"/)
    expect(g.calls).toEqual([])
    const l = run(sandbox(), ['--apply'], { env: { LOCK_ALERT_HOURS: 'x' } })
    expect(l.code).toBe(1)
    expect(l.out).toMatch(/LOCK_ALERT_HOURS must be a whole number/)
    const p = run(sandbox(), ['--apply'], { env: { APT_PLACES: 'yes' } })
    expect(p.code).toBe(1)
    expect(p.out).toMatch(/APT_PLACES must be 0 or 1, not "yes" — this run did nothing/)
    expect(p.calls).toEqual([])
  })


  it('⛔ a refresh still running from yesterday holds the lock: this run does the DAILY SWEEP alone, and leaves that lock be', () => {
    const box = sandbox()
    const lock = join(box, 'journal/.weekly.lock')
    mkdirSync(lock, { recursive: true })
    const h = holder()
    try {
      writeFileSync(join(lock, 'pid'), String(h.pid))
      const r = run(box, ['--apply'])
      expect(r.code, r.out).toBe(0)
      expect(r.out).toMatch(new RegExp(`another property-rentals run \\(pid ${h.pid}\\) holds the refresh lock — this run does the daily sweep only`))
      expect(r.calls.filter((c) => c.startsWith('npx'))).toEqual([expect.stringContaining('expire-rentals.ts --sweep --stamps-dir ')])
      expect(readFileSync(join(lock, 'pid'), 'utf8')).toBe(String(h.pid))   // not taken over, not removed
      // ⛔ held for over LOCK_ALERT_HOURS: still the sweep alone, but an alert every morning — never silence
      const old = Date.now() / 1000 - 40 * 3600
      utimesSync(join(lock, 'pid'), old, old)
      const stuck = run(box, ['--apply'])
      expect(stuck.code).toBe(1)
      expect(stuck.out).toMatch(/that run has held the lock for over 36 h — the imports are not refreshing/)
      expect(stuck.out).toMatch(/FAILED refresh-running-over-36h/)
    } finally { h.kill() }
  })

  it('⛔ a lock whose pid now belongs to another process (reused after a crash) is not a run: cleared, and the refresh runs', () => {
    const box = sandbox()
    const lock = join(box, 'journal/.weekly.lock')
    mkdirSync(lock, { recursive: true })
    writeFileSync(join(lock, 'pid'), String(process.pid))                      // alive, but this test runner — not the job
    const r = run(box, ['--apply'], { env: { APT_SOURCES: 'rever' } })
    expect(r.code, r.out).toBe(0)
    expect(idx(r.calls, 'retire-rever-rentals.ts --save')).toBeGreaterThan(-1)
    expect(existsSync(lock)).toBe(false)
  })

  it('a lock left by a dead run is cleared, and the refresh runs', () => {
    const box = sandbox()
    const lock = join(box, 'journal/.weekly.lock')
    mkdirSync(lock, { recursive: true })
    writeFileSync(join(lock, 'pid'), '999999')                                 // no such process
    const r = run(box, ['--apply'], { env: { APT_SOURCES: 'rever' } })
    expect(r.code, r.out).toBe(0)
    expect(idx(r.calls, 'retire-rever-rentals.ts --save')).toBeGreaterThan(-1)
    expect(existsSync(lock)).toBe(false)                                       // released at exit
  })

  it('one sweep at a time: a sweep already running elsewhere makes this one skip, not double up; a stale sweep lock is cleared', () => {
    const box = sandbox()
    const lock = join(box, 'journal/.sweep.lock')
    mkdirSync(lock, { recursive: true })
    const h = holder()
    try {
      writeFileSync(join(lock, 'pid'), String(h.pid))
      const r = run(box, ['--apply', '--sweep-only'])
      expect(r.code, r.out).toBe(0)
      expect(r.calls.filter((c) => c.startsWith('npx'))).toEqual([])
      expect(r.out).toMatch(/another sweep is running \(pid \d+\) — this one is skipped/)
    } finally { h.kill() }
    writeFileSync(join(lock, 'pid'), String(process.pid))                      // alive, but not this job
    const r2 = run(box, ['--apply', '--sweep-only'])
    expect(r2.calls.filter((c) => c.startsWith('npx'))).toEqual([expect.stringContaining('expire-rentals.ts --sweep')])
    expect(existsSync(lock)).toBe(false)
  })
})

describe('the job script — wiring', () => {
  it('its 7 days are the lib\'s: AGE_DAYS = FRESH_DAYS = SWEEP_DAYS', () => {
    expect(Number(/^AGE_DAYS=(\d+)$/m.exec(code)?.[1])).toBe(FRESH_DAYS)
    expect(SWEEP_DAYS).toBe(FRESH_DAYS)
  })
  it('⛔ no bare ssh tunnel; the supervised one, re-checked before every database step', () => {
    expect(code).not.toMatch(/\bssh\b.*-fN/)
    expect(code).toMatch(/bash "\$ENO\/scripts\/db-tunnel\.sh" start/)
    // every `npx tsx scripts/…` database step goes through dbrun — but the backstop, whose function checks the tunnel first
    const steps = code.split('\n').filter((l) => /npx tsx scripts\//.test(l))
    expect(steps.length).toBeGreaterThan(15)
    for (const l of steps) expect(/\bdbrun\b/.test(l) || /expire-apartment-rentals\.ts --seller "\$seller" --backstop/.test(l), l.trim()).toBe(true)
    expect(code).toMatch(/backstop\(\) \{\n[^\n]*\n\s*ensure_db \|\| \{ fail/)
  })
  it('⛔ Batdongsan: its .venv python, never /usr/bin/python3', () => {
    expect(code).toMatch(/BDS_PY="\$\{BDS_PY:-\$BDS\/\.venv\/bin\/python\}"/)
    expect(code).not.toMatch(/\/usr\/bin\/python3/)
  })
  it('the gate only holds --apply runs back, and the stamp is written only on success', () => {
    expect(code).toMatch(/if \[ -n "\$APPLY" \] && \[ -z "\$FORCE" \] && ! source_due "\$STATE\/last-success-\$src" "\$START_EPOCH"; then/)
    expect(code).toMatch(/if \[ -n "\$APPLY" \] && \[ "\$SRC_OK" = 1 \]; then\n\s*stamp_write "\$STATE\/last-success-\$src" "\$START_EPOCH"/)
  })
  it('⛔ the sweep agent\'s plist: its own label, DAILY 05:30, --apply --sweep-only, the same job worktree', () => {
    const body = readFileSync(join(REPO, 'scripts/vn.eno.rentals-sweep.plist'), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    expect(body).toMatch(/<string>vn\.eno\.rentals-sweep<\/string>/)
    expect(body).toMatch(/<key>StartCalendarInterval<\/key>\s*<dict><key>Hour<\/key><integer>5<\/integer><key>Minute<\/key><integer>30<\/integer><\/dict>/)
    expect(body).not.toMatch(/Weekday/)
    expect(body).toMatch(/<string>\/Users\/mk1e3\/eno-apartments-job\/scripts\/apartments-weekly\.sh<\/string>\s*<string>--apply<\/string>\s*<string>--sweep-only<\/string>/)
    expect(body).toMatch(/eno-import-journals\/apartments\/sweep\.log/)
  })

  it('⛔ the refresh plist ships APT_PLACES=0 (apartments only) until the owner says otherwise; the sweep agent, which imports nothing, carries none', () => {
    const places = (f: string) => /<key>APT_PLACES<\/key><string>([^<]*)<\/string>/.exec(readFileSync(join(REPO, f), 'utf8').replace(/<!--[\s\S]*?-->/g, ''))?.[1]
    expect(places('scripts/vn.eno.apartments-weekly.plist')).toBe('0')
    expect(places('scripts/vn.eno.rentals-sweep.plist')).toBeUndefined()
  })

  it('the plist: a DAILY 06:00 trigger (no Weekday), --apply, the same label and log', () => {
    const plist = readFileSync(join(REPO, 'scripts/vn.eno.apartments-weekly.plist'), 'utf8')
    const body = plist.replace(/<!--[\s\S]*?-->/g, '')
    expect(body).toMatch(/<key>StartCalendarInterval<\/key>\s*<dict><key>Hour<\/key><integer>6<\/integer><key>Minute<\/key><integer>0<\/integer><\/dict>/)
    expect(body).not.toMatch(/Weekday/)
    expect(body).toMatch(/<string>vn\.eno\.apartments-weekly<\/string>/)
    expect(body).toMatch(/<string>\/Users\/mk1e3\/eno-apartments-job\/scripts\/apartments-weekly\.sh<\/string>\s*<string>--apply<\/string>/)
    expect(body).toMatch(/eno-import-journals\/apartments\/weekly\.log/)
  })
})
