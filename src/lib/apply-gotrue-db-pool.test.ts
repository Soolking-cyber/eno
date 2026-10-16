import { afterAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * infra/vn-node/apply-gotrue-db-pool.sh (speed plan item 6): what can be held here without the box — the override merge
 * (the four pool settings land in the ONE services.auth.environment mapping, every other byte kept, anything ambiguous
 * refused, a second run a no-op) and the script's own safety lines (syntax, --no-deps, backup before write, no secrets
 * file read).
 */
const ROOT = join(__dirname, '..', '..')
const SCRIPT = join(ROOT, 'infra/vn-node/apply-gotrue-db-pool.sh')
const SOURCE = readFileSync(SCRIPT, 'utf8')
/**
 * ⛔ NEVER THE REAL BOX FROM A TEST (gate review): the script's defaults ARE production (root@162.4.176.233 and a key
 * that exists on the owner's laptop), so every spawn gets an unreachable host — a guard that ever broke (DRY_RUN, the
 * argument check) would fail to connect instead of recreating auth.
 */
const ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ENO_|DRY_RUN|ROLLBACK)/.test(k))),
  ENO_HOST: 'nobody@127.0.0.1', ENO_SSH_PORT: '1', ENO_SSH_KEY: '/dev/null',
} as unknown as NodeJS.ProcessEnv

const requireHere = createRequire(import.meta.url)
const yamlLoad: ((s: string) => unknown) | null = (() => {
  try { return (requireHere('js-yaml') as { load: (s: string) => unknown }).load } catch { return null }
})()

const dirs: string[] = []
afterAll(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
function helper(mode: '_merge', text: string) {
  const d = mkdtempSync(join(tmpdir(), 'eno-gotrue-pool-'))
  dirs.push(d)
  const f = join(d, 'docker-compose.override.yml')
  writeFileSync(f, text)
  const r = spawnSync('bash', [SCRIPT, mode, f], { encoding: 'utf8', env: ENV, timeout: 30_000 })
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? ''), after: readFileSync(f, 'utf8') }
}
const merge = (text: string) => helper('_merge', text)

/** The override as the sign-in scripts leave it on the box: one services.auth.environment mapping. */
const OVERRIDE = [
  'services:',
  '  auth:',
  '    environment:',
  '      GOTRUE_EXTERNAL_GOOGLE_ENABLED: ${GOTRUE_EXTERNAL_GOOGLE_ENABLED}',
  '      GOTRUE_MAILER_OTP_EXP: "3600"',
  '  storage:',
  '    environment:',
  '      FILE_SIZE_LIMIT: "52428800"',
  '',
].join('\n')

const ADDED = [
  '      # GoTrue keeps NO idle DB connection without these (infra/vn-node/apply-gotrue-db-pool.sh)',
  '      GOTRUE_DB_MAX_IDLE_POOL_SIZE: "5"',
  '      GOTRUE_DB_CONN_MAX_IDLE_TIME: "10m"',
  '      GOTRUE_DB_CONN_MAX_LIFETIME: "1h"',
]

describe('the override merge', () => {
  it('adds the four settings at the end of services.auth.environment and changes nothing else', () => {
    const r = merge(OVERRIDE)
    expect(r.status).toBe(0)
    const lines = OVERRIDE.split('\n')
    expect(r.after).toBe([...lines.slice(0, 5), ...ADDED, ...lines.slice(5)].join('\n'))
  })

  it.skipIf(!yamlLoad)('parses as YAML with the values GoTrue reads', () => {
    const doc = yamlLoad!(merge(OVERRIDE).after) as { services: { auth: { environment: Record<string, string> }; storage: unknown } }
    expect(doc.services.auth.environment).toMatchObject({
      GOTRUE_DB_MAX_IDLE_POOL_SIZE: '5', GOTRUE_DB_CONN_MAX_IDLE_TIME: '10m', GOTRUE_DB_CONN_MAX_LIFETIME: '1h',
      GOTRUE_MAILER_OTP_EXP: '3600',
    })
    expect(doc.services.storage).toEqual({ environment: { FILE_SIZE_LIMIT: '52428800' } })
  })

  it('a second run changes nothing and says so (exit 10)', () => {
    const once = merge(OVERRIDE).after
    const twice = merge(once)
    expect(twice.status).toBe(10)
    expect(twice.after).toBe(once)
  })

  it.each([
    ['a setting already pinned to another value', OVERRIDE.replace('      GOTRUE_MAILER_OTP_EXP: "3600"\n', '      GOTRUE_MAILER_OTP_EXP: "3600"\n      GOTRUE_DB_MAX_IDLE_POOL_SIZE: "20"\n')],
    ['two auth blocks', OVERRIDE + '  auth:\n    image: x\n'],
    ['no environment under auth', 'services:\n  auth:\n    image: x\n'],
    ['a list-form environment', 'services:\n  auth:\n    environment:\n      - A=1\n'],
    ['tabs', OVERRIDE.replace('      GOTRUE_MAILER_OTP_EXP', '\tGOTRUE_MAILER_OTP_EXP')],
    ['two top-level services:', OVERRIDE + 'services:\n'],
    ['an auth: nested under another service, not services.auth', 'services:\n  storage:\n    auth:\n      environment:\n        X: "1"\n'],
    ['an environment: nested deeper under auth, not services.auth.environment', 'services:\n  auth:\n    x-extra:\n      environment:\n        X: "1"\n    image: y\n'],
    ['a key that appears twice', OVERRIDE.replace('      GOTRUE_MAILER_OTP_EXP: "3600"\n', '      GOTRUE_MAILER_OTP_EXP: "3600"\n      GOTRUE_MAILER_OTP_EXP: "60"\n')],
  ])('refuses %s and leaves the file untouched (exit 4)', (_name, text) => {
    const r = merge(text)
    expect(r.status).toBe(4)
    expect(r.after).toBe(text)
  })
})

describe('the script', () => {
  it('no remote command reads stdin — the script itself IS stdin (`ssh … bash -s`) and would be swallowed', () => {
    const remote = SOURCE.slice(SOURCE.indexOf("cat <<'REMOTE'"))
    expect(remote).not.toMatch(/docker exec -i/)
    // Commands only: a comment, or a docker command quoted inside an `echo "…"` message, runs nothing.
    const commands = remote.replace(/\\\n\s*/g, ' ').split('\n') // a command continued with \ is one command
      .filter((x) => !x.trim().startsWith('#'))
      .map((x) => x.replace(/echo "[^"]*"/g, ''))
      .filter((x) => /\b(docker (compose|exec|logs|inspect)|curl)\b/.test(x))
    expect(commands.length).toBeGreaterThan(5)
    for (const l of commands) expect(l).toMatch(/<\/dev\/null/)
  })

  it('parses', () => {
    expect(spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' }).status).toBe(0)
  })

  it('recreates auth with --no-deps only — never a bare `up -d auth` that would also recreate a drifted db', () => {
    const ups = SOURCE.split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .map((l) => l.replace(/echo "[^"]*"/g, '')) // a command quoted in a message runs nothing
      .filter((l) => /docker compose up\b/.test(l))
    expect(ups.length).toBeGreaterThan(0)
    for (const l of ups) expect(l).toMatch(/up -d --no-deps\b.* auth </)
  })

  it('backs the override up before writing it, and rolls back on any failure after', () => {
    const section = SOURCE.slice(SOURCE.indexOf('=== WRITE ==='))
    const backup = section.indexOf('cp "$SNAP" "$OV.bak-gotrue-pool-$STAMP"')
    const write = section.lastIndexOf('mv -f "$OV.tmp-gotrue-pool-$STAMP" "$OV"') // the write itself, after rollback()'s own
    const trap = section.indexOf("trap 'rollback' ERR")
    expect(backup).toBeGreaterThan(0)
    expect(trap).toBeGreaterThan(backup)
    expect(write).toBeGreaterThan(trap)
  })

  it('never reads the Supabase .env or any secrets file (code lines; the comments may name them)', () => {
    const code = SOURCE.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
    expect(code).not.toMatch(/\.env\b(?!ironment)/)
    expect(code).not.toMatch(/\/opt\/eno\/secrets/)
    expect(code).not.toMatch(/printenv/)
  })

  it('keeps up to 5 idle, adds NO cap on open connections, and leaves a deploy build its connections', () => {
    expect(SOURCE).toMatch(/^POOL_IDLE=5$/m)
    expect(SOURCE).not.toMatch(/GOTRUE_DB_MAX_POOL_SIZE=/)
    expect(SOURCE).toMatch(/WANT="0 \$GP_IDLE 10m0s 1h0m0s"/)
    expect(SOURCE).toMatch(/\[ "\$FREE" -ge \$\(\(GP_IDLE \+ 45\)\) \]/)
  })

  it('DRY_RUN must be 0 or 1 — `DRY_RUN=true` stops before anything, never a real change', () => {
    for (const v of ['true', 'yes', 'y', '2']) {
      const r = spawnSync('bash', [SCRIPT], { encoding: 'utf8', env: { ...ENV, DRY_RUN: v }, timeout: 30_000 })
      expect(r.status).toBe(2)
      expect(r.stdout).toMatch(/DRY_RUN must be 0 or 1/)
    }
  })

  it('removes its temporary copies of the override however the run ends', () => {
    expect(SOURCE).toMatch(/trap cleanup EXIT/)
  })

  it('runs detached on the box (setsid, a log it follows) — a dropped connection cannot stop it half-way', () => {
    expect(SOURCE).toMatch(/setsid bash "\$f" >> "\$log" 2>&1 <\/dev\/null &/)
    expect(SOURCE).toMatch(/tail --pid="\$pid"/)
  })

  it('refuses to recreate auth when its compose config already differs from the running container', () => {
    expect(SOURCE).toMatch(/docker compose config --hash auth/)
    expect(SOURCE).toMatch(/com\.docker\.compose\.config-hash/)
  })

  it('stops on any edit exit code but 0 and 10, and never force-recreates on its own', () => {
    expect(SOURCE).toMatch(/\[ "\$RC" = "0" \] \|\| \[ "\$RC" = "10" \] \|\| \{ rm -f "\$T" "\$SNAP"; echo "  ⛔ the override edit stopped/)
    // --force-recreate appears only in the advice printed when the log rotated, never as something the script runs.
    for (const l of SOURCE.split('\n').filter((x) => x.includes('--force-recreate'))) expect(l).toMatch(/^\s*(#|echo )/)
  })

  it('refuses any argument but the test helper — a typo like --dry-run must never run a real change', () => {
    for (const arg of ['--dry-run', '-n', '--help', 'rollback']) {
      const r = spawnSync('bash', [SCRIPT, arg], { encoding: 'utf8', env: ENV, timeout: 30_000 })
      expect(r.status).toBe(2)
      expect(r.stdout).toMatch(/usage:/)
    }
  })

  it('writes only if the override is still the file it read', () => {
    const section = SOURCE.slice(SOURCE.indexOf('=== WRITE ==='))
    expect(section.indexOf('cmp -s "$OV" "$SNAP"')).toBeGreaterThan(0)
    // …the snapshot the change was BUILT from, and the backup is that same snapshot (gate review: a later copy could
    // already hold another script's edit).
    expect(SOURCE.indexOf('SNAP=$(mktemp); cp "$OV" "$SNAP"')).toBeLessThan(SOURCE.indexOf('T=$(mktemp); cp "$SNAP" "$T"'))
    expect(section).toMatch(/cp "\$SNAP" "\$OV\.bak-gotrue-pool-\$STAMP"/)
    expect(section.indexOf('cmp -s "$OV" "$SNAP"')).toBeLessThan(section.lastIndexOf('mv -f "$OV.tmp-gotrue-pool-$STAMP" "$OV"'))
    // …and the write is a rename of a full copy, never an in-place overwrite.
    expect(section).not.toMatch(/cp "\$T" "\$OV"\s*$/m)
  })

  it("reads GoTrue's limits without dying on a missing log line (pipefail + set -e)", () => {
    expect(SOURCE).toMatch(/grep '"applying connection limits' \|\| true; \}/)
  })

  it('verifies a request that makes GoTrue query Postgres through the new pool', () => {
    const verify = SOURCE.slice(SOURCE.indexOf('=== VERIFY ==='))
    expect(verify).toMatch(/db_probe "\$NEW"/)
    expect(SOURCE).toMatch(/grant_type=pkce/)
  })

  it('a rollback restores only what this run wrote', () => {
    const fn = SOURCE.slice(SOURCE.indexOf('rollback() {'), SOURCE.indexOf('\n}', SOURCE.indexOf('rollback() {')))
    expect(fn).toMatch(/cmp -s "\$OV" "\$WROTE"/)
  })

  it('a failed `docker compose up` fails recreate() — the old container being healthy is not success', () => {
    expect(SOURCE).toMatch(/docker compose up -d --no-deps auth <\/dev\/null >\/dev\/null \|\| return 1/)
  })

  it('takes a lock, so two runs cannot race the override or undo each other', () => {
    expect(SOURCE).toMatch(/flock -n 9 \|\|/)
  })

  it('a rollback waits for a healthy GoTrue and says so either way', () => {
    const fn = SOURCE.slice(SOURCE.indexOf('rollback() {'), SOURCE.indexOf('\n}', SOURCE.indexOf('rollback() {')))
    expect(fn).toMatch(/\$\(recreate\) && gateway_ok/)
    expect(fn).toMatch(/NOT healthy after the rollback/)
  })
})
