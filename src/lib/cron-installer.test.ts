import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * infra/vn-node/cron/install-cron-timers.sh — the teacher job-match emails get a SERVICE and NO TIMER (gate review,
 * 2026-10-08 — codex + Opus). They go out only when the owner's /teachers send starts the service after an approved plan;
 * the timer they used to have sat in EMAIL, installed and disabled, and the installer's own printed cutover line
 * (`for j in ${EMAIL[*]}; do systemctl enable --now …`) enabled it — a 10:30 ICT send with no approved plan behind it.
 *
 * ⚠️ The installer itself needs bash ≥ 4 (`declare -A`), and a Mac has 3.2, so it is not run whole here: the lists, the
 * helper and the printed cutover line ARE run (all bash-3.2-safe), and the loop's branch order is read from the text.
 */
const SCRIPT = readFileSync(join(__dirname, '..', '..', 'infra', 'vn-node', 'cron', 'install-cron-timers.sh'), 'utf8')

/** The one-line indexed array `NAME=(a b c)`, as the script writes it — its definition line and its words. */
function list(name: string): { line: string; words: string[] } {
  const m = new RegExp(`^${name}=\\(([^)]*)\\)$`, 'm').exec(SCRIPT)
  if (!m) throw new Error(`install-cron-timers.sh: no one-line ${name}=(…) array`)
  return { line: m[0], words: m[1].trim().split(/\s+/).filter(Boolean) }
}
const IN_LIST = /^in_list\(\)\{.*\}$/m.exec(SCRIPT)?.[0] ?? ''

/** Run a snippet under the local bash with the installer's own strictness. */
function bash(snippet: string): { status: number | null; out: string } {
  const r = spawnSync('bash', ['-c', `set -euo pipefail\n${snippet}`], { encoding: 'utf8' })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

describe('install-cron-timers.sh — the teacher job-match emails are never on a schedule', () => {
  it('teacher-match-emails is MANUAL, and in no list that gets or prints a timer (SAFE, EMAIL, POLICY)', () => {
    expect(list('MANUAL').words).toEqual(['teacher-match-emails'])
    for (const name of ['SAFE', 'EMAIL', 'POLICY']) {
      for (const job of list('MANUAL').words) expect(list(name).words, `${name} holds ${job}`).not.toContain(job)
    }
    // Still in SCHED, so its SERVICE is written (the /teachers send starts it; ENO_CRON_ONLY accepts it).
    expect(SCRIPT).toMatch(/^\s*\[teacher-match-emails\]=/m)
  })

  it('⛔ the printed cutover line enables the EMAIL timers — and never a MANUAL job', () => {
    const tail = SCRIPT.slice(SCRIPT.indexOf('echo "At cutover'))
    expect(tail.split('\n').filter((l) => l.startsWith('echo')).length).toBe(2)
    const r = bash(`${list('EMAIL').line}\n${list('MANUAL').line}\n${tail}`)
    expect(r.status).toBe(0)
    expect(r.out).toContain('for j in daily-reminders saved-search-alerts weekly-digest; do systemctl enable --now eno-cron-$j.timer; done')
    expect(r.out).not.toContain('teacher-match-emails')
  })

  it('⛔ affiliate-prices is POLICY since the AccessTrade removal (2026-10-13) — a SAFE job is re-enabled by every re-run', () => {
    expect(list('POLICY').words).toContain('affiliate-prices')
    for (const name of ['SAFE', 'EMAIL', 'MANUAL']) expect(list(name).words, `${name} holds it`).not.toContain('affiliate-prices')
  })

  it('⛔ teacher-message-emails is POLICY — never EMAIL, which every full re-run disables — every 30 min, on eno.vn only', () => {
    expect(list('POLICY').words).toContain('teacher-message-emails')
    for (const name of ['SAFE', 'EMAIL', 'MANUAL']) expect(list(name).words, `${name} holds it`).not.toContain('teacher-message-emails')
    expect(SCRIPT).toMatch(/^\s*\[teacher-message-emails\]="\*-\*-\* \*:07,37:00 UTC"$/m)
    expect(SCRIPT).toContain('[ "$job" = teacher-message-emails ] && TARGET="eno.vn 3001"')
  })

  it('⛔ licence-holds (2026-10-14) is SAFE — any full re-run enables it — at 00:00 ICT sharp, once, on eno.vn', () => {
    // Without the timer VietKite's grandfather never ends, so the job may not drift into a list a re-run leaves off.
    expect(list('SAFE').words).toContain('licence-holds')
    for (const name of ['EMAIL', 'MANUAL', 'POLICY']) expect(list(name).words, `${name} holds it`).not.toContain('licence-holds')
    // 17:00 UTC = 00:00 ICT: the instant the grandfather ends (src/lib/licence-stamp.ts) — and nothing delays it (gate).
    expect(SCRIPT).toMatch(/^\s*\[licence-holds\]="\*-\*-\* 17:00:00 UTC"$/m)
    expect(SCRIPT).toContain('[ "$job" = licence-holds ] && { DELAY=0; ACCURACY=1s; }')
    expect(SCRIPT).toMatch(/^RandomizedDelaySec=\$DELAY$/m)
    expect(SCRIPT).toMatch(/^AccuracySec=\$ACCURACY$/m)
    expect(SCRIPT).toContain('[ "$job" = licence-holds ] && TARGET="eno.vn 3001"')
  })

  it('⛔ identity-reconcile (2026-10-15) is SAFE — any full re-run enables it — at 09:05 ICT, never midnight, once, on eno.vn', () => {
    // The identity backstop: a lapse, a revocation or a failed decision effect is put right only while this timer runs,
    // so it may not drift into a list a re-run leaves off — nor into EMAIL, which every full re-run disables.
    expect(list('SAFE').words).toContain('identity-reconcile')
    for (const name of ['EMAIL', 'MANUAL', 'POLICY']) expect(list(name).words, `${name} holds it`).not.toContain('identity-reconcile')
    // 02:05 UTC = 09:05 ICT: losing the +10 can move the enforcement ladder, whose bell + push must not land at night.
    expect(SCRIPT).toMatch(/^\s*\[identity-reconcile\]="\*-\*-\* 02:05:00 UTC"$/m)
    expect(SCRIPT).toContain('[ "$job" = identity-reconcile ] && TARGET="eno.vn 3001"')
    // The default spread — only licence-holds fires to the second.
    expect(SCRIPT).not.toMatch(/\[ "\$job" = identity-reconcile \] && \{ DELAY=/)
    // Never replayed at boot: a missed 09:05 run must not fire at night (Persistent=false for this job only).
    expect(SCRIPT).toContain('[ "$job" = identity-reconcile ] && PERSIST=false')
    expect(SCRIPT).toContain('Persistent=$PERSIST')
  })

  it('⛔ identity-marks (2026-10-16) is SAFE — at 00:05 ICT, once, on eno.vn — and, sending nothing, IS replayed at boot', () => {
    // The card's "Identity verified" must go when a document lapses at 00:00 ICT; the reconcile runs at 09:05, so this run
    // is what clears it in the night. It may not drift into a list a re-run leaves off, nor into EMAIL.
    expect(list('SAFE').words).toContain('identity-marks')
    for (const name of ['EMAIL', 'MANUAL', 'POLICY']) expect(list(name).words, `${name} holds it`).not.toContain('identity-marks')
    expect(SCRIPT).toMatch(/^\s*\[identity-marks\]="\*-\*-\* 17:05:00 UTC"$/m)
    expect(SCRIPT).toContain('[ "$job" = identity-marks ] && TARGET="eno.vn 3001"')
    // The default spread AND the default Persistent=true: no override names this job.
    expect(SCRIPT).not.toMatch(/\[ "\$job" = identity-marks \] && (\{ )?(DELAY|ACCURACY|PERSIST)=/)
    expect(SCRIPT).toMatch(/^\s*DELAY=120; ACCURACY=1min; PERSIST=true$/m)
  })

  it('⛔ secondhand-showcase (2026-10-17) is SAFE — weekly, Monday 07:00 ICT, once, on eno.vn, a 30-minute curl, its answer kept', () => {
    // The owner's "have a 2nd hand run weekly to check": it may not drift into a list a re-run leaves off, nor into EMAIL.
    expect(list('SAFE').words).toContain('secondhand-showcase')
    for (const name of ['EMAIL', 'MANUAL', 'POLICY']) expect(list(name).words, `${name} holds it`).not.toContain('secondhand-showcase')
    expect(SCRIPT).toMatch(/^\s*\[secondhand-showcase\]="Mon \*-\*-\* 00:00:00 UTC"$/m)
    expect(SCRIPT).toContain(`[ "$job" = secondhand-showcase ] && { TARGET="eno.vn 3001 1800"; EXTRA=$'Environment=ENO_CRON_KEEP_DIR=/var/lib/eno/cron-journals\\nTimeoutStartSec=2400'; }`)
  })

  it('⛔ the keep directory reaches secondhand-showcase’s unit ONLY — EXTRA is reset for every job, and the unit writes it', () => {
    // The loop's own lines, run for this job and then another (bash-3.2-safe: no associative array between them).
    const loop = SCRIPT.indexOf('for job in "${!SCHED[@]}"; do')
    const cat = SCRIPT.indexOf('  cat > "/etc/systemd/system/eno-cron-$job.service" <<UNIT', loop)
    const setup = SCRIPT.slice(SCRIPT.indexOf('  EXTRA=""', loop), cat)
    const unit = SCRIPT.slice(cat, SCRIPT.indexOf('\nUNIT\n', cat) + 6).replace('cat > "/etc/systemd/system/eno-cron-$job.service" <<UNIT', 'cat <<UNIT')
    expect(unit).toMatch(/^\$EXTRA$/m)
    const r = bash(`HOST_HEADER=eno.vn; PORT=3001\nfor job in secondhand-showcase visa-retention; do\n${setup}${unit}echo ---\ndone`)
    expect(r.status).toBe(0)
    const [mine, next] = r.out.split('---\n')
    expect(mine).toContain('ExecStart=/opt/eno/bin/eno-cron.sh secondhand-showcase eno.vn 3001 1800')
    expect(mine).toMatch(/^Environment=ENO_CRON_KEEP_DIR=\/var\/lib\/eno\/cron-journals$/m)
    expect(mine).toMatch(/^TimeoutStartSec=2400$/m) // its own line: nothing cuts the 1800 s curl
    expect(next).toContain('ExecStart=/opt/eno/bin/eno-cron.sh visa-retention eno.vn 3001')
    expect(next).not.toContain('ENO_CRON_KEEP_DIR') // the job after it inherits nothing
  })

  it('⛔ partner-stock is POLICY while the five-per-shop showcase stands — its restock of sold rows would break the cap', () => {
    expect(list('POLICY').words).toContain('partner-stock')
    for (const name of ['SAFE', 'EMAIL', 'MANUAL']) expect(list(name).words, `${name} holds it`).not.toContain('partner-stock')
  })

  it('eno-cron.sh takes a per-job curl limit (4th argument, 900 s by default) and keeps an answer only where a unit asks', () => {
    const run = SCRIPT.slice(SCRIPT.indexOf("cat > /opt/eno/bin/eno-cron.sh <<'RUN'"), SCRIPT.indexOf('\nRUN\n'))
    expect(run).toContain('MAXT="${4:-900}"')
    expect(run).toContain('--max-time "$MAXT"')
    expect(run).not.toContain('--max-time 900')
    expect(run).toMatch(/if \[ -n "\$\{ENO_CRON_KEEP_DIR:-\}" \]; then/)
    // Run the keep block with the installer's strictness: it copies the answer, named by job, time and status.
    const keep = run.slice(run.indexOf('if [ -n "${ENO_CRON_KEEP_DIR:-}" ]; then'), run.indexOf('\nfi', run.indexOf('if [ -n "${ENO_CRON_KEEP_DIR:-}" ]; then')) + 3)
    const dir = `/tmp/eno-cron-keep-test-${process.pid}`
    const r = bash(`JOB=secondhand-showcase; code=200; echo '{"ok":true}' > /tmp/eno-cron-$JOB.out; ENO_CRON_KEEP_DIR=${dir}\n${keep}\nls ${dir}; rm -rf ${dir}`)
    expect(r.status).toBe(0)
    expect(r.out).toMatch(/^secondhand-showcase-\d{8}T\d{6}Z-200\.json$/m)
  })

  it('⛔ a curl that gives up (exit 28) still reaches the echo and the keep, keeps no stale answer, and fails the unit', () => {
    const run = SCRIPT.slice(SCRIPT.indexOf("cat > /opt/eno/bin/eno-cron.sh <<'RUN'"), SCRIPT.indexOf('\nRUN\n'))
    const body = run.slice(run.indexOf('\n') + 1)
    const job = `keep-test-${process.pid}`
    const dir = `/tmp/eno-cron-keep-test-${process.pid}-b`
    // docker and curl stubbed: curl writes what it got (or nothing), prints its status and exits as told — 28 at --max-time.
    const go = (partial: boolean, status = '000', exit = 28) => spawnSync('bash', ['-c',
      `docker() { echo s3cret; }\ncurl() { local o=''; while [ $# -gt 0 ]; do [ "$1" = -o ] && o=$2; shift; done; ${partial ? `printf '{"ok":tr' > "$o";` : ''} printf ${status}; return ${exit}; }\n${body}`,
      'eno-cron.sh', job, 'eno.vn', '3001', '1800'], { encoding: 'utf8', env: { ...process.env, ENO_CRON_KEEP_DIR: dir } })
    try {
      writeFileSync(`/tmp/eno-cron-${job}.out`, '{"stale":"last week"}')
      const cut = go(false)
      expect(cut.status).toBe(1)
      expect(cut.stdout).toContain(`${job} -> 000`)
      expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]) // last week's answer removed — never kept as this one's
      const part = go(true)
      expect(part.status).toBe(1)
      expect(readdirSync(dir)).toEqual([expect.stringMatching(new RegExp(`^${job}-\\d{8}T\\d{6}Z-000\\.json$`))])
      // ⛔ A 200 whose body was cut off (curl 56, connection reset) fails the unit too — never green on a truncated answer.
      const reset = go(true, '200', 56)
      expect(reset.status).toBe(1)
      expect(reset.stdout).toContain(`${job} -> 200 (curl 56)`)
    } finally {
      rmSync(dir, { recursive: true, force: true }); rmSync(`/tmp/eno-cron-${job}.out`, { force: true })
    }
  })

  it('in_list (the loop the branches use) answers yes and no under set -euo pipefail', () => {
    expect(IN_LIST).not.toBe('')
    const r = bash(`${list('MANUAL').line}\n${IN_LIST}\nin_list teacher-match-emails "\${MANUAL[@]}" && echo yes\nin_list weekly-digest "\${MANUAL[@]}" || echo no`)
    expect(r).toEqual({ status: 0, out: 'yes\nno\n' })
  })

  it('⛔ the unit loop writes a MANUAL job’s service, then removes its timer and skips the timer heredoc', () => {
    const start = SCRIPT.indexOf('for job in "${!SCHED[@]}"; do')
    const loop = SCRIPT.slice(start, SCRIPT.indexOf('\ndone\n', start))
    const service = loop.indexOf('cat > "/etc/systemd/system/eno-cron-$job.service"')
    const branch = loop.indexOf('if in_list "$job" "${MANUAL[@]}"; then')
    const timer = loop.indexOf('cat > "/etc/systemd/system/eno-cron-$job.timer"')
    expect(start).toBeGreaterThan(-1)
    expect(service).toBeGreaterThan(-1)
    expect(branch).toBeGreaterThan(service)
    expect(timer).toBeGreaterThan(branch)
    const body = loop.slice(branch, loop.indexOf('\n  fi\n', branch))
    expect(body).toContain('systemctl disable --now "eno-cron-$job.timer"')
    expect(body).toContain('rm -f "/etc/systemd/system/eno-cron-$job.timer"')
    expect(body.trim().split('\n').at(-1)?.trim()).toBe('continue')
  })

  it('a one-job install of a MANUAL job says so and never reaches the enable', () => {
    const only = SCRIPT.slice(SCRIPT.indexOf('if [ -n "$ONLY" ]; then\n  if in_list'))
    const manual = only.indexOf('if in_list "$ONLY" "${MANUAL[@]}"; then')
    const enable = only.indexOf('systemctl enable --now "eno-cron-$ONLY.timer"')
    expect(manual).toBeGreaterThan(-1)
    expect(enable).toBeGreaterThan(manual)
    expect(only.slice(manual, enable)).toMatch(/NO timer[^\n]*\n\s*exit 0/)
  })
})
