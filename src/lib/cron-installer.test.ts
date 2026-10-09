import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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
