import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * scripts/vehicle-job-lib.sh (sourced by scripts/vehicle-rentals-weekly.sh) under the local bash — macOS runs the job
 * on /bin/bash 3.2, so the helpers are bash-3.2-safe and are run here exactly as written. The main script is checked
 * for syntax and for the lines the review pinned (the lock's place, the start-time stamp, a checkpoint that must move).
 */
const SCRIPTS = join(__dirname, '..', '..', 'scripts')
const LIB = join(SCRIPTS, 'vehicle-job-lib.sh')
const MAIN = join(SCRIPTS, 'vehicle-rentals-weekly.sh')

let dir = ''
const children: ChildProcess[] = []
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'veh-shell-')) })
afterEach(() => {
  for (const c of children.splice(0)) c.kill('SIGKILL')
  rmSync(dir, { recursive: true, force: true })
})

/** Source the lib and run `snippet` with LOCKDIR in the temp dir; stdout + the exit status. */
function lib(snippet: string): { status: number | null; out: string } {
  const r = spawnSync('bash', ['-c', `set -uo pipefail\nLOCKDIR=${JSON.stringify(join(dir, 'lock'))}\n. ${JSON.stringify(LIB)}\n${snippet}`], { encoding: 'utf8', timeout: 20_000 })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}
/**
 * A process whose command line names the job, as launchd starts it: `/bin/bash …/vehicle-rentals-weekly.sh --apply` —
 * returned once ps shows that command line (a loaded machine can take a while to exec the child).
 */
async function fakeJob(): Promise<number> {
  const d = join(dir, 'job')
  mkdirSync(d, { recursive: true })
  const f = join(d, 'vehicle-rentals-weekly.sh')
  writeFileSync(f, 'sleep 60\n')
  const c = spawn('bash', [f, '--apply'], { stdio: 'ignore' })
  children.push(c)
  for (let i = 0; i < 200; i++) {
    if (spawnSync('ps', ['-p', String(c.pid), '-o', 'command='], { encoding: 'utf8' }).stdout.includes('vehicle-rentals-weekly.sh')) return c.pid!
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('the fake job never showed up in ps')
}

describe('take_lock — one refresh at a time, and a stale lock never sticks', () => {
  it('takes a free lock and writes its own pid', () => {
    const r = lib('take_lock && echo "TOOK $$ $(cat "$LOCKDIR/pid")"')
    expect(r.status).toBe(0)
    const [, a, b] = /TOOK (\d+) (\d+)/.exec(r.out)!
    expect(a).toBe(b)
  })

  it('records the holder\'s start time with its pid, and backs off from a lock its live holder still has', async () => {
    const r = lib('take_lock && echo "start=[$(cat "$LOCKDIR/start")] own=[$(proc_start $$)]"')
    const [, start, own] = /start=\[(.*)\] own=\[(.*)\]/.exec(r.out)!
    expect(start).toMatch(/\d{4}$/)
    expect(start).toBe(own)
    // a live holder started any way at all (its command line need not name the script): its start time matches
    const pid = await fakeJob()
    rmSync(join(dir, 'lock'), { recursive: true, force: true })
    mkdirSync(join(dir, 'lock'))
    writeFileSync(join(dir, 'lock', 'pid'), `${pid}\n`)
    writeFileSync(join(dir, 'lock', 'start'), `${lib(`proc_start ${pid}`).out.trim()}\n`)
    expect(lib('take_lock; echo "rc=$? why=$LOCK_WHY"').out).toContain('rc=1 why=alive')
  })

  it('⛔ breaks a lock whose pid is alive but started at another time (a pid reused after a crash and a reboot)', () => {
    mkdirSync(join(dir, 'lock'))
    writeFileSync(join(dir, 'lock', 'pid'), `${process.pid}\n`) // alive — but not the process that took the lock
    writeFileSync(join(dir, 'lock', 'start'), 'Mon Jan  3 04:30:00 2000\n')
    const r = lib('take_lock; echo "rc=$? why=$LOCK_WHY pid=$(cat "$LOCKDIR/pid")"')
    expect(r.out).toMatch(/clearing a lock left by pid \d+, which is not a running vehicle refresh/)
    expect(r.out).toMatch(/rc=0 why=lost pid=\d+/)
    expect(r.out).not.toContain(`pid=${process.pid}`)
  })

  it('a lock with no recorded start falls back to the command line: the job holds it, a reused pid does not', async () => {
    const pid = await fakeJob()
    mkdirSync(join(dir, 'lock'))
    writeFileSync(join(dir, 'lock', 'pid'), `${pid}\n`)
    expect(lib('take_lock; echo "rc=$? why=$LOCK_WHY"').out).toContain('rc=1 why=alive')
    writeFileSync(join(dir, 'lock', 'pid'), `${process.pid}\n`)
    expect(lib('take_lock; echo "rc=$? why=$LOCK_WHY"').out).toContain('rc=0 why=lost')
  })

  it('reads a start time the same whatever the caller\'s zone and locale (launchd vs a terminal)', () => {
    const a = spawnSync('bash', ['-c', `. ${JSON.stringify(LIB)}; proc_start ${process.pid}`], { encoding: 'utf8', env: { ...process.env, TZ: 'Asia/Tokyo', LC_ALL: 'fr_FR.UTF-8' } }).stdout
    const b = spawnSync('bash', ['-c', `. ${JSON.stringify(LIB)}; proc_start ${process.pid}`], { encoding: 'utf8', env: { ...process.env, TZ: 'America/Los_Angeles', LC_ALL: 'C' } }).stdout
    expect(a.trim()).toMatch(/\d{4}$/)
    expect(a).toBe(b)
  })

  it('breaks a dead holder\'s lock; leaves a just-created lock with no pid alone', () => {
    // a pid that just exited (not a guessed number: Linux pids go past 999999)
    const dead = spawnSync('true').pid
    mkdirSync(join(dir, 'lock'))
    writeFileSync(join(dir, 'lock', 'pid'), `${dead}\n`)
    expect(lib('take_lock; echo "rc=$?"').out).toContain('rc=0')
    rmSync(join(dir, 'lock'), { recursive: true })
    mkdirSync(join(dir, 'lock'))
    expect(lib('take_lock; echo "rc=$? why=$LOCK_WHY"').out).toContain('rc=1 why=young')
  })
})

describe('problems_new — which of this run\'s problems the last run did not have', () => {
  it('remembers this run\'s problems and reports only the NEW ones', () => {
    const file = join(dir, 'last-refused')
    expect(lib(`problems_new "scrape:bikes mioto" ${JSON.stringify(file)}`).out).toBe('mioto scrape:bikes ')
    expect(readFileSync(file, 'utf8')).toBe('mioto\nscrape:bikes\n')
    expect(lib(`problems_new "scrape:bikes  mioto" ${JSON.stringify(file)}`).out).toBe('') // all repeats
    expect(lib(`problems_new "scrape:bikes janmotorbike" ${JSON.stringify(file)}`).out).toBe('janmotorbike ')
    // no problem: the memory is cleared
    expect(lib(`problems_new "" ${JSON.stringify(file)}; [ -e ${JSON.stringify(file)} ] && echo kept || echo cleared`).out).toBe('cleared\n')
  })

  it('refused_sources reads the importer\'s REFUSED line', () => {
    const log = join(dir, 'import.log')
    writeFileSync(log, 'x\nSTATUS STEP REFUSED for: mioto: would create 400 rows against 761 live | janmotorbike: scrape not accepted (see its guard line) | mioto: would revive 3\n')
    expect(lib(`refused_sources ${JSON.stringify(log)}`).out).toBe('janmotorbike\nmioto\n')
    expect(lib(`refused_sources ${JSON.stringify(join(dir, 'none.log'))}`).out).toBe('')
  })
})

describe('is_conn_error — only a database failure earns the import its one retry', () => {
  const check = (text: string) => { const f = join(dir, 'import.log'); writeFileSync(f, text); return lib(`is_conn_error ${JSON.stringify(f)} && echo yes || echo no`).out.trim() }
  it('recognises a dropped tunnel / dead socket', () => {
    expect(check('Error: cached translations unreadable — refusing to stage descriptions without them: connect ECONNREFUSED 127.0.0.1:5433')).toBe('yes')
    expect(check("PrismaClientKnownRequestError: Can't reach database server at 127.0.0.1:5433")).toBe('yes')
    expect(check('Error: Connection terminated unexpectedly')).toBe('yes')
  })
  it('does not retry the importer\'s own refusals', () => {
    expect(check('Error: seller cmx has ownerId u1 — a real account owns it; refusing')).toBe('no')
    expect(check('Error: scrape too old for mioto (8.1d) — re-scrape before --apply')).toBe('no')
  })
})

describe('scripts/vehicle-rentals-weekly.sh — what the review pinned', () => {
  const text = readFileSync(MAIN, 'utf8')

  it('parses under bash', () => {
    expect(spawnSync('bash', ['-n', MAIN], { encoding: 'utf8' }).status).toBe(0)
    expect(spawnSync('bash', ['-n', LIB], { encoding: 'utf8' }).status).toBe(0)
  })

  it('⛔ the lock is one fixed path in $HOME, never under the journal root VEH_JOURNAL moves', () => {
    expect(text).toMatch(/^LOCKDIR="\$HOME\/\.eno-vehicle-refresh\.lock"$/m)
    expect(text).not.toMatch(/LOCKDIR="\$JROOT/)
  })

  it('⛔ a source whose CREATIONS were held keeps its gone baseline (a spike never becomes the reference) — other refusals do not', () => {
    const start = text.indexOf('  # ── 6. baseline for the gone helper')
    const block = text.slice(start, text.indexOf('\nfi\n', start))
    const base = join(dir, 'latest'), next = join(dir, 'run', 'next-baseline')
    mkdirSync(base, { recursive: true }); mkdirSync(next, { recursive: true })
    for (const f of ['mioto.json', 'bonbon.json', 'bikes.json']) { writeFileSync(join(base, f), 'old'); writeFileSync(join(next, f), 'new') }
    writeFileSync(join(dir, 'run', 'import.log'), 'STATUS STEP REFUSED for: mioto: would expire 400 of 761 live rows | tuanmotorbike: would create 30 rows against 9 live\n')
    const r = spawnSync('bash', ['-c', `set -uo pipefail
RUN=${JSON.stringify(join(dir, 'run'))}; BASE=${JSON.stringify(base)}; APPLY=--apply; PARTIAL=1
SHOPS="janmotorbike theextramile dungmotorbikes tuanmotorbike rentabikevn"
. ${JSON.stringify(LIB)}
die() { echo "DIE: $1"; exit 1; }
if true; then
${block}
fi`], { encoding: 'utf8' })
    expect(r.stdout).toContain("baseline bikes.json kept as it was (tuanmotorbike's creations were held this run)")
    expect(['mioto.json', 'bonbon.json', 'bikes.json'].map((f) => readFileSync(join(base, f), 'utf8'))).toEqual(['new', 'new', 'old'])
  })

  it('⛔ the success stamp is the run\'s START, taken once the lock is held', () => {
    expect(text).toMatch(/^stamp_success\(\) \{ printf '%s\\n' "\$RUN_START_UTC" > "\$SUCCESS\.tmp"/m)
    expect(text.indexOf('RUN_START_UTC="$(date -u')).toBeGreaterThan(text.indexOf('if ! take_lock; then'))
    expect(text.indexOf('RUN_START_UTC="$(date -u')).toBeLessThan(text.indexOf('# ── 1. scrape'))
  })

  it('⛔ a Mioto checkpoint that cannot move fails the Mioto group', () => {
    expect(text).toContain('if [ -e "state/$f" ]; then mv "state/$f" "state/prev-$STAMP/" || exit 1; fi')
  })

  it('a failed scrape group is left out of the gone helper and of both stages — never `die`', () => {
    expect(text).toMatch(/\) \|\| \{ FAILED="\$FAILED mioto";/)
    expect(text).toMatch(/\) \|\| \{ FAILED="\$FAILED bonboncar";/)
    expect(text).toMatch(/\) \|\| \{ FAILED="\$FAILED bikes";/)
    expect(text).toContain('has_failed mioto || SRC+=(--mioto "$MIOTO" --trips "$TRIPS_USE")')
    expect(text).toContain('has_failed bikes || GONE_SRC+=(--bikes "$BIKES")')
  })

  it('the dry run judges with a preview copy of the trips history, filed with this scrape', () => {
    expect(text).toContain('TRIPS_USE="$RUN/trips-preview"')
    expect(text).toContain('TRIPS_ARGS=(--out "$TRIPS_USE" --apply)')
  })

  it('⛔ retries the import ONCE, and only when the database was the cause', () => {
    // The script's own retry block, run with stubbed stages: from the first attempt to its `fi`.
    const start = text.indexOf('  run_import; rc=$?')
    const block = text.slice(start, text.indexOf('\n  fi\n', start) + 5)
    expect(block).toMatch(/is_conn_error "\$RUN\/import\.log"/)
    const run = (firstLog: string, firstRc: number, probe: number) => {
      const r = spawnSync('bash', ['-c', `set -uo pipefail
RUN=${JSON.stringify(dir)}; n=0
. ${JSON.stringify(LIB)}
run_import() { n=$((n+1)); if [ $n -eq 1 ]; then printf '%s\\n' ${JSON.stringify(firstLog)} > "$RUN/import.log"; return ${firstRc}; fi; echo fine > "$RUN/import.log"; return 0; }
db_up() { echo DB_UP; }
db_probe() { return ${probe}; }
npx() { echo "NPX $*"; }
${block}
echo "attempts=$n rc=$rc"`], { encoding: 'utf8' })
      return `${r.stdout}${r.stderr}`
    }
    expect(run('Error: Connection terminated unexpectedly', 1, 0)).toMatch(/DB_UP\nattempts=2 rc=0/)
    expect(existsSync(join(dir, 'import-attempt1.log'))).toBe(true)
    // the first attempt's status journals are re-tombstoned before the retry
    mkdirSync(join(dir, 'journal'))
    writeFileSync(join(dir, 'journal', 'vehicle-status-2026-10-16T22-00-00-000Z.json'), '{}')
    const withJournal = run('Error: Connection terminated unexpectedly', 1, 0)
    expect(withJournal).toMatch(/attempts=2 rc=0/)
    expect(readFileSync(join(dir, 'import-attempt1.log'), 'utf8')).toContain('NPX tsx scripts/vehicle-rentals-status.ts --tombstone')
    expect(run('Error: seller x has ownerId u — refusing', 1, 1)).toMatch(/attempts=2 rc=0/) // the database does not answer now
    expect(run('Error: seller x has ownerId u — refusing', 1, 0)).toMatch(/^attempts=1 rc=1$/m) // its own refusal: no retry
    expect(run('STATUS STEP REFUSED for: mioto: x', 3, 1)).toMatch(/^attempts=1 rc=3$/m)
  })

  it('⛔ step 7 stamps only a clean run, or one whose problems were ALL problems last run — never a run where every scrape failed', () => {
    const start = text.indexOf('# ── 7. success stamp')
    const block = text.slice(start, text.indexOf('echo "── $(date \'+%F %T\') done"', start))
    const step7 = (env: string) => {
      const r = spawnSync('bash', ['-c', `set -uo pipefail
RUN=${JSON.stringify(dir)}; SUCCESS=${JSON.stringify(join(dir, 'last-success'))}; REFUSED=${JSON.stringify(join(dir, 'last-refused'))}
RUN_START_UTC=2026-10-16T21:30:00Z; APPLY=--apply; FAILED=""; PARTIAL=""; ALL_FAILED=""; TOMB_FAILED=""
. ${JSON.stringify(LIB)}
die() { echo "DIE: $1"; exit 1; }
${env}
${block}
echo "OK"`], { encoding: 'utf8' })
      const stamp = existsSync(join(dir, 'last-success')) ? readFileSync(join(dir, 'last-success'), 'utf8').trim() : null
      rmSync(join(dir, 'last-success'), { force: true })
      return { out: `${r.stdout}${r.stderr}`, stamp }
    }
    const log = join(dir, 'import.log')
    expect(step7('')).toMatchObject({ stamp: '2026-10-16T21:30:00Z' }) // clean: the run's START
    expect(step7('FAILED=" bikes"')).toMatchObject({ stamp: null, out: expect.stringMatching(/DIE: problem for: scrape:bikes \(new: scrape:bikes\)/) })
    expect(step7('FAILED=" bikes"')).toMatchObject({ stamp: '2026-10-16T21:30:00Z', out: expect.stringMatching(/DIE: problem again for: scrape:bikes/) })
    // a repeat of A with a NEW B: no stamp — B keeps its next-day retry
    expect(step7('FAILED=" bikes mioto"')).toMatchObject({ stamp: null, out: expect.stringMatching(/\(new: scrape:mioto\)/) })
    // every scrape failed, twice running: never a stamp — and the memory is left as it was (it says nothing per group)
    const before = readFileSync(join(dir, 'last-refused'), 'utf8')
    expect(step7('FAILED=" mioto bonboncar bikes"; ALL_FAILED=1').stamp).toBeNull()
    expect(step7('FAILED=" mioto bonboncar bikes"; ALL_FAILED=1')).toMatchObject({ stamp: null, out: expect.stringMatching(/DIE: every scrape group FAILED/) })
    expect(readFileSync(join(dir, 'last-refused'), 'utf8')).toBe(before)
    // so a group's first real failure after an outage is NEW: no stamp
    expect(step7('FAILED=" bonboncar"')).toMatchObject({ stamp: null, out: expect.stringMatching(/\(new: scrape:bonboncar\)/) })
    // a failed re-tombstone before the import retry is a problem too
    expect(step7('TOMB_FAILED=1')).toMatchObject({ stamp: null, out: expect.stringMatching(/problem for: retombstone/) })
    // exit 3 whose REFUSED line cannot be read is still a problem
    writeFileSync(log, 'no such line\n')
    expect(step7('PARTIAL=1')).toMatchObject({ stamp: null, out: expect.stringMatching(/problem for: import:refused/) })
    writeFileSync(log, 'STATUS STEP REFUSED for: mioto: would revive 400 rows\n')
    expect(step7('PARTIAL=1').out).toMatch(/problem for: mioto \(new: mioto\)/)
    // a dry run never stamps and never touches the memory
    expect(step7('APPLY=""; FAILED=" bikes"')).toMatchObject({ stamp: null, out: expect.stringMatching(/\(dry run\) an --apply run WOULD stop on: scrape:bikes/) })
  })

  it('has_failed matches whole group names only', () => {
    const fn = /^has_failed\(\) \{.*\}$/m.exec(text)![0]
    const r = spawnSync('bash', ['-c', `FAILED=" bikes"\n${fn}\nhas_failed bikes && echo a; has_failed bike || echo b; has_failed mioto || echo c`], { encoding: 'utf8' })
    expect(r.stdout).toBe('a\nb\nc\n')
    expect(existsSync(LIB)).toBe(true)
  })
})
