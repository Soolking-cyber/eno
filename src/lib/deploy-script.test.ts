import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * infra/vn-node/eno-deploy.sh runs under `set -uo pipefail`, and there `printf "$BIG" | grep -q` is a
 * trap: grep -q exits at its first match, printf (still writing) dies of SIGPIPE (141), and pipefail
 * fails the pipeline. The edition gate's `if ! printf "$FMAN" | grep -qE itinerary` therefore said
 * "NO /itinerary/page" exactly when the route was FOUND early in a large manifest — five recorded
 * false rejections of a good forum image before the cause was found (2026-09-24).
 */
const ROOT = join(__dirname, '..', '..')
const SCRIPTS = ['infra/vn-node/eno-deploy.sh', 'infra/vn-node/eno-build.sh']

describe('deploy scripts never pipe a variable into grep -q under pipefail', () => {
  for (const rel of SCRIPTS) {
    it(rel, () => {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      const offenders = src
        .split('\n')
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => !line.trim().startsWith('#') && /\b(printf|echo)\b[^|#]*\$[A-Za-z_{][^|#]*\|\s*grep\s+-[A-Za-z]*q/.test(line))
      expect(offenders, 'use grep -q … <<<"$VAR" instead').toEqual([])
    })
  }

  it('the trap is real: the pipe form rejects a manifest whose match comes early, the here-string does not', () => {
    const run = (check: string) =>
      execFileSync('bash', ['-c', `set -uo pipefail
F=$(printf '"/[lang]/itinerary/page" "app/x.js"\\n'; head -c 300000 /dev/zero | tr '\\0' x)
if ${check}; then echo REJECT; else echo PASS; fi`], { encoding: 'utf8' }).trim()
    expect(run(`! printf '%s' "$F" | grep -qE '"(/\\[lang\\])?/itinerary/page"'`)).toBe('REJECT')
    expect(run(`! grep -qE '"(/\\[lang\\])?/itinerary/page"' <<<"$F"`)).toBe('PASS')
  })

  it('the edition gate uses the here-string form', () => {
    const src = readFileSync(join(ROOT, 'infra/vn-node/eno-deploy.sh'), 'utf8')
    expect(src).toMatch(/if ! grep -qE '"\(\/\\\[lang\\\]\)\?\/itinerary\/page"' <<<"\$FMAN"; then/)
  })
})
