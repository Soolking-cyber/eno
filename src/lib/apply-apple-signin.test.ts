import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash, createVerify, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/log', () => ({ logWarn: () => {}, logError: () => {} }))

/**
 * The box half of Sign in with Apple (plan ~/eno-ios-prep/siwa/plan.md §6 I8/I10/I13/I14, §7.19, §8 "Box script"
 * and "nginx"): infra/vn-node/apply-apple-signin.sh, its daily check's units, and the guard on
 * sb.eno.vn/auth/v1/authorize in infra/vn-node/nginx/eno.conf (§10, A2/D21).
 *
 * What can be held here without the box:
 *   · the override merge — one services.auth.environment gains the Apple passthroughs, byte for byte, and a file
 *     with two auth: blocks (or anything else it cannot be sure of) is refused;
 *   · the env-file edits — in place, mode kept, nothing else touched, the rollout flag never switched back off;
 *   · the minter — the app's own token (src/lib/auth/apple-siwa.ts mintClientSecret), only longer-lived;
 *   · the nginx guard — what it lets through is always an https eno redirect with PKCE AS GoTrue WILL READ IT
 *     (a differential against Go's url.ParseQuery), and PCRE2 agrees with these regexes when pcre2grep exists;
 *   · the whole install / rotate / check / restore / install-timer flow, in a sandbox whose docker, curl, flock,
 *     shred and systemctl are stubs (the script refuses a sandbox run with real ones): backups before any write,
 *     every file put back on any failure, and no secret in any output or any argv.
 */
const ROOT = join(__dirname, '..', '..')
const SCRIPT = join(ROOT, 'infra/vn-node/apply-apple-signin.sh')
const SOURCE = readFileSync(SCRIPT, 'utf8')
const CONF = readFileSync(join(ROOT, 'infra/vn-node/nginx/eno.conf'), 'utf8')
const UNIT_SERVICE = readFileSync(join(ROOT, 'infra/vn-node/eno-apple-siwa-check.service'), 'utf8')
const UNIT_TIMER = readFileSync(join(ROOT, 'infra/vn-node/eno-apple-siwa-check.timer'), 'utf8')

/** The environment minus anything the script or git reads — a developer's shell must not steer a run. */
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ENO_|APPLE_|GIT_)/.test(k))) as NodeJS.ProcessEnv

type Run = { status: number | null; out: string; stdout: string }
function run(args: string[], o: { input?: string; env?: Record<string, string> } = {}): Run {
  const r = spawnSync('bash', [SCRIPT, ...args], { input: o.input ?? '', encoding: 'utf8', env: { ...ENV, ...o.env }, timeout: 90_000 })
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? ''), stdout: r.stdout ?? '' }
}
const helper = (args: string[], input?: string) => run(['_helper', ...args], { input })

const scratchDirs: string[] = []
afterAll(() => { for (const d of scratchDirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
function scratch(prefix = 'eno-siwa-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  scratchDirs.push(d)
  return d
}

const requireHere = createRequire(import.meta.url)
/** js-yaml arrives only through eslint, so it is optional here: the YAML-parse checks skip without it. */
const yamlLoad: ((s: string) => unknown) | null = (() => {
  try { return (requireHere('js-yaml') as { load: (s: string) => unknown }).load } catch { return null }
})()
const PCRE2GREP = spawnSync('pcre2grep', ['--version'], { encoding: 'utf8' }).status === 0

const fp = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12)
const b64json = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────
const PASSTHROUGH = [
  'GOTRUE_EXTERNAL_APPLE_ENABLED', 'GOTRUE_EXTERNAL_APPLE_CLIENT_ID', 'GOTRUE_EXTERNAL_APPLE_SECRET',
  'GOTRUE_EXTERNAL_APPLE_REDIRECT_URI', 'GOTRUE_EXTERNAL_FLOW_STATE_EXPIRY_DURATION',
]
const MARKER = '# Sign in with Apple: passthroughs from .env (infra/vn-node/apply-apple-signin.sh)'
const passthroughLines = (indent = 6) => [' '.repeat(indent) + MARKER, ...PASSTHROUGH.map((k) => ' '.repeat(indent) + k + ': ${' + k + '}')]

/** The override as I7 expects it on the box: Google (apply-google-signin.sh) + the 10-05 OTP lifetime. */
const GOOGLE_OTP = [
  'services:',
  '  auth:',
  '    environment:',
  '      GOTRUE_EXTERNAL_GOOGLE_ENABLED: ${GOTRUE_EXTERNAL_GOOGLE_ENABLED}',
  '      GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID: ${GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID}',
  '      GOTRUE_EXTERNAL_GOOGLE_SECRET: ${GOTRUE_EXTERNAL_GOOGLE_SECRET}',
  '      GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI: ${GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI}',
  '      GOTRUE_MAILER_OTP_EXP: "3600"',
].join('\n') + '\n'

/** The same block with neighbours, comments and blank lines — the merge must land inside auth's environment. */
const MULTI = [
  '# eno overrides: Supabase\'s own docker-compose.yml stays untouched',
  'services:',
  '  db:',
  '    ports:',
  '      - "127.0.0.1:5433:5432"',
  '',
  '  auth:',
  '    # Google (apply-google-signin.sh) and the OTP lifetime (owner, 10-05)',
  '    environment:',
  '      GOTRUE_EXTERNAL_GOOGLE_ENABLED: ${GOTRUE_EXTERNAL_GOOGLE_ENABLED}',
  '      "GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID": ${GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID}',
  '      GOTRUE_EXTERNAL_GOOGLE_SECRET: ${GOTRUE_EXTERNAL_GOOGLE_SECRET}',
  '      GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI: ${GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI}',
  '',
  '      GOTRUE_MAILER_OTP_EXP: "3600"   # 1 h, what the email says',
  '    # a trailing comment inside auth',
  '    restart: unless-stopped',
  '',
  '  kong:',
  '    environment:',
  '      KONG_LOG_LEVEL: warn',
].join('\n') + '\n'

const TWO_AUTH = [
  'services:',
  '  auth:',
  '    environment:',
  '      GOTRUE_EXTERNAL_GOOGLE_ENABLED: ${GOTRUE_EXTERNAL_GOOGLE_ENABLED}',
  '  auth:',
  '    environment:',
  '      GOTRUE_MAILER_OTP_EXP: "3600"',
].join('\n') + '\n'

/**
 * Fixture secrets — all fake — BUILT, so no key- or secret-shaped literal sits in this file: the commit gate
 * (scripts/second-opinion.mjs) refuses to send a diff carrying one to the reviewers, fake or not.
 */
const FAKE_GSECRET = ['GOCSPX', 'google-test-secret'].join('-')
const FAKE_P8 = ['-----BEGIN', 'PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n'].join(' ')
const FAKE_JWT = ['eyJhbGciOiJFUzI1NiJ9', 'e30', 'c2ln'].join('.')

const SUPABASE_ENV = [
  '# Supabase self-hosted (test fixture)',
  'POSTGRES_PASSWORD=pg.test-password-0001',
  'JWT_SECRET=jwt.test-secret-0123456789abcdef',
  'ANON_KEY=anon-public-test-key',
  'SITE_URL=https://eno.vn',
  'ADDITIONAL_REDIRECT_URLS=https://eno.vn/**,https://www.eno.vn/**,https://eno.forum/**,https://www.eno.forum/**,http://localhost:3000/**',
  'API_EXTERNAL_URL=https://sb.eno.vn',
  'GOTRUE_EXTERNAL_GOOGLE_ENABLED=true',
  'GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=71068369681-test.apps.googleusercontent.com',
  'GOTRUE_EXTERNAL_GOOGLE_SECRET=' + FAKE_GSECRET,
  'GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://sb.eno.vn/auth/v1/callback',
].join('\n') + '\n'
const VN_APP_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL=https://sb.eno.vn',
  'SUPABASE_SECRET_KEY=sb-secret-test',
  'GOOGLE_CLIENT_SECRET=' + FAKE_GSECRET,
  'NEXT_PUBLIC_APP_REVIEW_GATES=ios-hide-google',
  'CRON_SECRET=cron-test',
].join('\n') + '\n'
const FORUM_APP_ENV = VN_APP_ENV.replace('CRON_SECRET=cron-test', 'CRON_SECRET=cron-forum-test')

/** Every line of `before` survives, unchanged and in order; returns the lines `after` added. */
function inserted(before: string, after: string): string[] {
  const a = before.split('\n')
  const added: string[] = []
  let i = 0
  for (const line of after.split('\n')) {
    if (i < a.length && line === a[i]) i++
    else added.push(line)
  }
  expect(i, 'every original line survives, in order').toBe(a.length)
  return added
}

function merge(text: string, extra: string[] = ['--require', 'GOTRUE_EXTERNAL_GOOGLE_ENABLED']) {
  const f = join(scratch(), 'docker-compose.override.yml')
  writeFileSync(f, text, { mode: 0o644 })
  const r = helper(['merge-override', f, ...extra])
  return { ...r, after: readFileSync(f, 'utf8'), mode: statSync(f).mode & 0o777 }
}

// ── the script itself ────────────────────────────────────────────────────────────────────────────────────────
describe('apply-apple-signin.sh', { timeout: 30_000 }, () => {
  it('parses (bash -n), and refuses to run under xtrace, which would print secrets', () => {
    expect(spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' }).status).toBe(0)
    const r = spawnSync('bash', ['-x', SCRIPT, 'check'], { encoding: 'utf8', env: ENV })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/refusing to run under xtrace/)
  })

  it('never writes APPLE_TEAM_ID (it publishes the AASA, P7 — on hold); writes the app’s APPLE_SIWA_* names', () => {
    expect(SOURCE).not.toMatch(/APPLE_TEAM_ID=/)
    for (const k of ['APPLE_SIWA_TEAM_ID', 'APPLE_SIWA_KEY_ID', 'APPLE_SIWA_PRIVATE_KEY', 'APPLE_SIWA_SERVICES_ID', 'APPLE_SIWA_BUNDLE_ID', 'APPLE_TOKEN_ENC_KEY']) {
      expect(SOURCE).toMatch(new RegExp(`${k}=(%s|@)`))
    }
    expect(SOURCE).toContain("printf '?NEXT_PUBLIC_APPLE_SIGNIN=\\n'")
  })

  it('exits 2 on a usage error', () => {
    expect(run(['install', '--team', 'TEAM123456']).status).toBe(2)
    expect(run(['install', '--team']).status).toBe(2)
    expect(run(['rotate', 'now']).status).toBe(2)
  })

  it('mints in the app image with no network and no log driver, and probes Apple’s fixed endpoint', () => {
    const mint = /mint\(\) \{([\s\S]*?)\n\}/.exec(SOURCE)?.[1] ?? ''
    for (const flag of ['--network none', '--log-driver none', '--pull never', '--read-only', '--cap-drop ALL', '--entrypoint node "$IMAGE"', '-i']) expect(mint).toContain(flag)
    expect(SOURCE).toMatch(/^APPLE_TOKEN_URL=https:\/\/appleid\.apple\.com\/auth\/token$/m)
    expect(SOURCE).toMatch(/^IMAGE=eno-vn:local$/m)
    // the client secret reaches curl as the request body on stdin, never as an argument
    expect(SOURCE).toContain('--data-binary @- "$APPLE_TOKEN_URL"')
  })

  it('prints its usage from its own header', () => {
    const r = run(['--help'])
    expect(r.status).toBe(0)
    for (const sub of ['install --team', 'check [--calibrate] [--auto-rotate]', 'rotate', 'restore <ts> [--force]', 'install-timer [--auto-rotate]']) expect(r.stdout).toContain(sub)
    expect(run(['bogus']).status).toBe(2)
  })
})

// ── the override merge ───────────────────────────────────────────────────────────────────────────────────────
describe('merge-override — into the ONE services.auth.environment', { timeout: 30_000 }, () => {
  it('merges the Apple passthroughs into the Google + OTP block: only lines added, mode kept', () => {
    const r = merge(GOOGLE_OTP)
    expect(r.status, r.out).toBe(0)
    expect(r.stdout).toContain('add to services.auth.environment: ' + PASSTHROUGH.join(' '))
    expect(inserted(GOOGLE_OTP, r.after)).toEqual(passthroughLines())
    expect(r.mode).toBe(0o644)
    expect(r.after.match(/^ {2}auth:/gm)).toHaveLength(1)
  })

  it.skipIf(!yamlLoad)('…and the result is the YAML compose will read: one auth, Google, the OTP and the five passthroughs', () => {
    const doc = yamlLoad!(merge(GOOGLE_OTP).after) as { services: { auth: { environment: Record<string, unknown> } } }
    const env = doc.services.auth.environment
    expect(env.GOTRUE_EXTERNAL_GOOGLE_ENABLED).toBe('${GOTRUE_EXTERNAL_GOOGLE_ENABLED}')
    expect(env.GOTRUE_MAILER_OTP_EXP).toBe('3600')
    for (const k of PASSTHROUGH) expect(env[k]).toBe('${' + k + '}')
    // and the two-auth fixture is not a file compose would load at all (go-yaml refuses a duplicate key too)
    expect(() => yamlLoad!(TWO_AUTH)).toThrow()
  })

  it('refuses a file with two auth: blocks, and changes nothing', () => {
    const r = merge(TWO_AUTH)
    expect(r.status).toBe(3)
    expect(r.out).toMatch(/expected exactly one services\.auth block in the override, found 2/)
    expect(r.after).toBe(TWO_AUTH)
  })

  it('lands inside auth.environment among neighbours, comments and blank lines; other services untouched', () => {
    const r = merge(MULTI)
    expect(r.status, r.out).toBe(0)
    const added = inserted(MULTI, r.after)
    expect(added).toEqual(passthroughLines())
    const lines = r.after.split('\n')
    const at = lines.indexOf(passthroughLines()[0])
    expect(lines[at - 1]).toBe('      GOTRUE_MAILER_OTP_EXP: "3600"   # 1 h, what the email says')
    expect(lines.indexOf('    restart: unless-stopped')).toBeGreaterThan(at)
    if (yamlLoad) {
      const doc = yamlLoad(r.after) as { services: Record<string, { environment?: Record<string, unknown>; restart?: string }> }
      expect(Object.keys(doc.services)).toEqual(['db', 'auth', 'kong'])
      expect(doc.services.auth.restart).toBe('unless-stopped')
      expect(doc.services.kong.environment).toEqual({ KONG_LOG_LEVEL: 'warn' })
      for (const k of PASSTHROUGH) expect(doc.services.auth.environment?.[k]).toBe('${' + k + '}')
    }
  })

  it('is idempotent: a merged file is left byte-identical', () => {
    const once = merge(GOOGLE_OTP).after
    const twice = merge(once)
    expect(twice.status).toBe(0)
    expect(twice.stdout).toMatch(/^unchanged/)
    expect(twice.after).toBe(once)
  })

  it('--check reports and writes nothing', () => {
    const r = merge(GOOGLE_OTP, ['--check', '--require', 'GOTRUE_EXTERNAL_GOOGLE_ENABLED'])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/^would add to services\.auth\.environment: /)
    expect(r.after).toBe(GOOGLE_OTP)
  })

  it('replaces a stale Apple line with the passthrough, in place', () => {
    const stale = GOOGLE_OTP.replace('      GOTRUE_MAILER_OTP_EXP: "3600"\n', '      GOTRUE_MAILER_OTP_EXP: "3600"\n      GOTRUE_EXTERNAL_APPLE_ENABLED: "false"\n')
    const r = merge(stale)
    expect(r.status, r.out).toBe(0)
    expect(r.stdout).toContain('replace in services.auth.environment: GOTRUE_EXTERNAL_APPLE_ENABLED')
    expect(r.after).toContain('      GOTRUE_EXTERNAL_APPLE_ENABLED: ${GOTRUE_EXTERNAL_APPLE_ENABLED}\n')
    expect(r.after).not.toContain('"false"')
    expect(r.after.match(/GOTRUE_EXTERNAL_APPLE_ENABLED:/g)).toHaveLength(1)
  })

  const REFUSED: Array<[string, string, RegExp]> = [
    ['an environment given as a list', 'services:\n  auth:\n    environment:\n      - GOTRUE_EXTERNAL_GOOGLE_ENABLED=true\n', /is a list/],
    ['no environment under auth', 'services:\n  auth:\n    restart: unless-stopped\n', /exactly one services\.auth\.environment in the override, found 0/],
    ['a flow-style auth', 'services:\n  auth: {environment: {GOTRUE_EXTERNAL_GOOGLE_ENABLED: x}}\n', /not a plain block/],
    ['a merge key / alias inside auth', 'x-env: &gotrue\n  GOTRUE_EXTERNAL_GOOGLE_ENABLED: x\nservices:\n  auth:\n    environment:\n      <<: *gotrue\n      GOTRUE_MAILER_OTP_EXP: "3600"\n', /anchor, alias or merge key/],
    ['tab indentation', 'services:\n\tauth:\n\t\tenvironment:\n\t\t\tGOTRUE_EXTERNAL_GOOGLE_ENABLED: x\n', /tab in the indentation/],
    ['CRLF line endings', GOOGLE_OTP.replace(/\n/g, '\r\n'), /CRLF/],
    ['no Google passthrough (not the I7 file)', 'services:\n  auth:\n    environment:\n      GOTRUE_MAILER_OTP_EXP: "3600"\n', /GOTRUE_EXTERNAL_GOOGLE_ENABLED is not in services\.auth\.environment/],
    ['no services:', 'volumes:\n  db: {}\n', /exactly one top-level "services:"/],
    ['two services: keys', GOOGLE_OTP + 'services:\n  kong: {}\n', /exactly one top-level "services:" in the override, found 2/],
    ['a duplicate key in environment', GOOGLE_OTP + '      GOTRUE_MAILER_OTP_EXP: "60"\n', /appears twice/],
    ['a multi-document file', '---\n' + GOOGLE_OTP, /document marker/],
  ]
  for (const [what, text, why] of REFUSED) {
    it(`refuses ${what}, and changes nothing`, () => {
      const r = merge(text)
      expect(r.status, r.out).toBe(3)
      expect(r.out).toMatch(why)
      expect(r.after).toBe(text)
    })
  }
})

// ── env files ────────────────────────────────────────────────────────────────────────────────────────────────
describe('env files', { timeout: 30_000 }, () => {
  const envFile = (text: string, mode = 0o600) => {
    const f = join(scratch(), 'app.env')
    writeFileSync(f, text, { mode })
    return f
  }

  it('env-set replaces in place, appends what is missing, drops duplicates, keeps the mode', () => {
    const f = envFile('A=1\n# a comment\nAPPLE_SIWA_KEY_ID=OLD\nB=2\nAPPLE_SIWA_KEY_ID=OLDER\n')
    const r = helper(['env-set', f], 'APPLE_SIWA_KEY_ID=NEW1234567\nAPPLE_SIWA_TEAM_ID=TEAM123456\n')
    expect(r.status, r.out).toBe(0)
    expect(readFileSync(f, 'utf8')).toBe('A=1\n# a comment\nAPPLE_SIWA_KEY_ID=NEW1234567\nB=2\nAPPLE_SIWA_TEAM_ID=TEAM123456\n')
    expect(statSync(f).mode & 0o777).toBe(0o600)
    expect(r.stdout).toContain('app.env: set APPLE_SIWA_KEY_ID')
    expect(r.stdout).toContain('app.env: added APPLE_SIWA_TEAM_ID')
  })

  it('?KEY= adds only when absent — a flipped rollout flag is never switched back off', () => {
    const f = envFile('NEXT_PUBLIC_APPLE_SIGNIN=ios,web-test\n')
    expect(helper(['env-set', f], '?NEXT_PUBLIC_APPLE_SIGNIN=\n').status).toBe(0)
    expect(readFileSync(f, 'utf8')).toBe('NEXT_PUBLIC_APPLE_SIGNIN=ios,web-test\n')
    const g = envFile('A=1')
    expect(helper(['env-set', g], '?NEXT_PUBLIC_APPLE_SIGNIN=\n').status).toBe(0)
    expect(readFileSync(g, 'utf8')).toBe('A=1\nNEXT_PUBLIC_APPLE_SIGNIN=\n')
  })

  it('reads secret values from their own files (base64 for the .p8) — they never pass through the shell', () => {
    const d = scratch()
    writeFileSync(join(d, 'k.p8'), FAKE_P8)
    writeFileSync(join(d, 'tk'), 'c2VjcmV0LXRva2VuLWtleS0zMi1ieXRlcy1sb25nISE=\n')
    writeFileSync(join(d, 'other.env'), 'APPLE_TOKEN_ENC_KEY=from-other\n')
    const f = envFile('X=1\n')
    const r = helper(['env-set', f], `APPLE_SIWA_PRIVATE_KEY=@b64file:${join(d, 'k.p8')}\nAPPLE_TOKEN_ENC_KEY=@file:${join(d, 'tk')}\n`)
    expect(r.status, r.out).toBe(0)
    const text = readFileSync(f, 'utf8')
    expect(text).toContain('APPLE_SIWA_PRIVATE_KEY=' + Buffer.from(FAKE_P8).toString('base64') + '\n')
    expect(text).toContain('APPLE_TOKEN_ENC_KEY=c2VjcmV0LXRva2VuLWtleS0zMi1ieXRlcy1sb25nISE=\n')
    expect(r.out).not.toContain('c2VjcmV0')
    expect(helper(['env-set', f], `APPLE_TOKEN_ENC_KEY=@from-env:${join(d, 'other.env')}\n`).status).toBe(0)
    expect(readFileSync(f, 'utf8')).toContain('APPLE_TOKEN_ENC_KEY=from-other\n')
  })

  it('refuses a value with a line break', () => {
    const d = scratch()
    writeFileSync(join(d, 'two'), 'line1\nline2\n')
    const f = envFile('X=1\n')
    const r = helper(['env-set', f], `APPLE_TOKEN_ENC_KEY=@file:${join(d, 'two')}\n`)
    expect(r.status).toBe(3)
    expect(readFileSync(f, 'utf8')).toBe('X=1\n')
  })

  it('redirect-drop removes exactly http://localhost:3000/** and keeps every other entry and the quoting', () => {
    const f = envFile('A=1\nADDITIONAL_REDIRECT_URLS="https://eno.vn/**,http://localhost:3000/**,https://www.eno.forum/**"\n')
    expect(helper(['redirect-drop', f, 'http://localhost:3000/**']).stdout.trim()).toBe('removed')
    expect(readFileSync(f, 'utf8')).toBe('A=1\nADDITIONAL_REDIRECT_URLS="https://eno.vn/**,https://www.eno.forum/**"\n')
    expect(helper(['redirect-drop', f, 'http://localhost:3000/**']).stdout.trim()).toBe('absent')
    const twice = envFile('ADDITIONAL_REDIRECT_URLS=a\nADDITIONAL_REDIRECT_URLS=b\n')
    expect(helper(['redirect-drop', twice, 'http://localhost:3000/**']).status).toBe(3)
  })

  it('env-foreign names (never values) the keys a full restore would also revert', () => {
    const a = envFile('A=1\nAPPLE_SIWA_KEY_ID=X\nADDITIONAL_REDIRECT_URLS=https://eno.vn/**,http://localhost:3000/**\n')
    const b = envFile('A=2\nAPPLE_SIWA_KEY_ID=Y\nNEW_SECRET=s3cr3t\nADDITIONAL_REDIRECT_URLS=https://eno.vn/**\n')
    expect(helper(['env-foreign', a, b, 'app']).stdout.split('\n').filter(Boolean)).toEqual(['A', 'ADDITIONAL_REDIRECT_URLS', 'NEW_SECRET'])
    const out = helper(['env-foreign', a, b, 'supabase']).stdout.split('\n').filter(Boolean)
    expect(out).toEqual(['A', 'APPLE_SIWA_KEY_ID', 'NEW_SECRET'])   // the localhost entry is ours to drop
    expect(helper(['env-foreign', a, b, 'app']).out).not.toContain('s3cr3t')
  })

  it('accepts only a 32-byte token key, as the app reads it (64 hex or standard base64)', () => {
    const d = scratch()
    const check = (v: string) => { writeFileSync(join(d, 'k'), v); return helper(['token-key-check', `file:${join(d, 'k')}`]).status }
    expect(check(randomBytes(32).toString('base64') + '\n')).toBe(0)
    expect(check(randomBytes(32).toString('hex'))).toBe(0)
    expect(check(randomBytes(16).toString('base64'))).toBe(3)
    expect(check(randomBytes(32).toString('base64url').replace(/[A-Za-z0-9]/, '-') + '-')).toBe(3)
  })

  it('validates the ids it is given', () => {
    expect(helper(['validate', 'team', 'DTP9SKVFMQ']).status).toBe(0)
    expect(helper(['validate', 'team', 'dtp9skvfmq']).status).toBe(2)
    expect(helper(['validate', 'client', 'vn.eno.web']).status).toBe(0)
    expect(helper(['validate', 'client', 'vneno']).status).toBe(2)
    expect(helper(['validate', 'flow', '10m']).status).toBe(0)
    expect(helper(['validate', 'flow', '2m']).status).toBe(2)     // GoTrue raises anything under 300 s to 300 s
    expect(helper(['validate', 'flow', '45m']).status).toBe(2)
  })
})

// ── the minter ───────────────────────────────────────────────────────────────────────────────────────────────
describe('the client-secret minter — the app’s own token, longer-lived', { timeout: 30_000 }, () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const P8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const verify = (jwt: string, key: KeyObject) => {
    const [h, c, s] = jwt.split('.')
    return createVerify('SHA256').update(`${h}.${c}`).verify({ key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))
  }
  afterEach(() => { vi.unstubAllEnvs() })

  it('matches mintClientSecret: header, claim names IN ORDER, values and an IEEE-P1363 ES256 signature', async () => {
    const lib = await import('@/lib/auth/apple-siwa')
    vi.stubEnv('APPLE_SIWA_TEAM_ID', 'TEAM123456')
    vi.stubEnv('APPLE_SIWA_KEY_ID', 'KEY1234567')
    vi.stubEnv('APPLE_SIWA_PRIVATE_KEY', Buffer.from(P8).toString('base64'))
    const app = lib.mintClientSecret('vn.eno.web')
    expect(app).not.toBe('unconfigured')
    const box = run(['_mint-local', 'vn.eno.web', String(175 * 86400), 'TEAM123456', 'KEY1234567'], { input: P8 })
    expect(box.status, box.out).toBe(0)
    const [ah, ac] = app.split('.').slice(0, 2).map(b64json)
    const [bh, bc] = box.stdout.split('.').slice(0, 2).map(b64json)
    expect(bh).toEqual(ah)
    expect(Object.keys(bh)).toEqual(Object.keys(ah))
    expect(Object.keys(bc)).toEqual(Object.keys(ac))
    for (const k of ['iss', 'aud', 'sub']) expect(bc[k]).toBe(ac[k])
    expect(Number(ac.exp) - Number(ac.iat)).toBe(300)
    expect(Number(bc.exp) - Number(bc.iat)).toBe(175 * 86400)
    expect(verify(app, publicKey)).toBe(true)
    expect(verify(box.stdout, publicKey)).toBe(true)
  })

  it('reads the key the way the app does — base64 of the PEM (the env file’s form) or the PEM itself', () => {
    const b64 = run(['_mint-local', 'vn.eno.app', '300', 'TEAM123456', 'KEY1234567'], { input: Buffer.from(P8).toString('base64') })
    expect(b64.status, b64.out).toBe(0)
    expect(b64json(b64.stdout.split('.')[1]).sub).toBe('vn.eno.app')
    expect(verify(b64.stdout, publicKey)).toBe(true)
  })

  it('refuses a key that is not P-256, a bad team id, an out-of-range lifetime and an empty stdin', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    expect(run(['_mint-local', 'vn.eno.web', '300', 'TEAM123456', 'KEY1234567'], { input: rsa }).out).toMatch(/not a P-256 EC key/)
    expect(run(['_mint-local', 'vn.eno.web', '300', 'team', 'KEY1234567'], { input: P8 }).status).toBe(3)
    expect(run(['_mint-local', 'vn.eno.web', String(200 * 86400), 'TEAM123456', 'KEY1234567'], { input: P8 }).status).toBe(3)
    expect(run(['_mint-local', 'vn.eno.web', '300', 'TEAM123456', 'KEY1234567']).status).toBe(3)
  })

  it('jwt-info prints the key id, the expiry and a 12-character fingerprint — never the token', () => {
    const jwt = run(['_mint-local', 'vn.eno.web', String(175 * 86400), 'TEAM123456', 'KEY1234567'], { input: P8 }).stdout
    const r = helper(['jwt-info'], jwt)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('kid=KEY1234567\n')
    expect(r.stdout).toContain(`fp=${fp(jwt)}\n`)
    expect(r.stdout).toMatch(/^days_left=17[45]$/m)
    expect(r.stdout).not.toContain(jwt.split('.')[2])
  })

  it('break-jwt (calibration) changes one signature character, never the last', () => {
    const jwt = run(['_mint-local', 'vn.eno.web', '300', 'TEAM123456', 'KEY1234567'], { input: P8 }).stdout
    const broken = helper(['break-jwt'], jwt).stdout
    const [a, b] = [jwt.split('.')[2], broken.split('.')[2]]
    expect(broken.split('.').slice(0, 2)).toEqual(jwt.split('.').slice(0, 2))
    expect([...a].filter((ch, i) => ch !== b[i])).toHaveLength(1)
    expect(a.at(-1)).toBe(b.at(-1))
    expect(verify(broken, publicKey)).toBe(false)
  })
})

describe('answers', { timeout: 30_000 }, () => {
  it('reads Apple’s token endpoint as TN3107 does', () => {
    const answer = (status: string, body: string) => helper(['apple-answer', status], body).stdout.trim()
    expect(answer('400', '{"error":"invalid_grant"}')).toBe('ok')
    expect(answer('400', '{"error":"invalid_client"}')).toBe('invalid_client')
    expect(answer('401', '{"error":"invalid_client"}')).toBe('invalid_client')
    expect(answer('000', '')).toBe('unreachable')
    expect(answer('503', '')).toBe('unreachable')
    expect(answer('429', '')).toBe('unreachable')
    expect(answer('200', '{"access_token":"x"}')).toBe('unexpected:200:')
    expect(answer('400', '{"error":"invalid_request"}')).toBe('unexpected:400:invalid_request')
  })

  it('accepts only an authorize redirect to Apple, form_post, with our client id and return URL', () => {
    const loc = (q: Record<string, string>) => 'https://appleid.apple.com/auth/authorize?' + new URLSearchParams(q).toString()
    const good = { client_id: 'vn.eno.web', redirect_uri: 'https://sb.eno.vn/auth/v1/callback', response_mode: 'form_post', response_type: 'code', scope: 'email name', state: 's' }
    expect(helper(['authorize-check', 'vn.eno.web'], `302 ${loc(good)}`).status).toBe(0)
    expect(helper(['authorize-check', 'vn.eno.web'], `302 ${loc({ ...good, client_id: 'vn.eno.app' })}`).status).toBe(1)
    expect(helper(['authorize-check', 'vn.eno.web'], `302 ${loc({ ...good, response_mode: 'query' })}`).status).toBe(1)
    expect(helper(['authorize-check', 'vn.eno.web'], `302 ${loc({ ...good, redirect_uri: 'https://sb.eno.vn/callback' })}`).status).toBe(1)
    expect(helper(['authorize-check', 'vn.eno.web'], '302 https://evil.example/auth/authorize').status).toBe(1)
    expect(helper(['authorize-check', 'vn.eno.web'], '400 ').status).toBe(1)
  })

  it('shows a container’s secret only as a fingerprint', () => {
    const env = 'GOTRUE_MAILER_OTP_EXP=3600\nGOTRUE_EXTERNAL_APPLE_SECRET=' + FAKE_JWT + '\n'
    const r = helper(['container-env', 'show:GOTRUE_MAILER_OTP_EXP', 'fp:GOTRUE_EXTERNAL_APPLE_SECRET', 'show:GOTRUE_SITE_URL'], env)
    expect(r.stdout).toBe(`GOTRUE_MAILER_OTP_EXP=3600\nGOTRUE_EXTERNAL_APPLE_SECRET=fp:${fp(FAKE_JWT)}\nGOTRUE_SITE_URL=<absent>\n`)
    const refused = helper(['container-env', 'show:GOTRUE_EXTERNAL_APPLE_SECRET'], env)
    expect(refused.status).toBe(3)
    expect(refused.out).not.toContain('c2ln')
  })
})

// ── the nginx guard ──────────────────────────────────────────────────────────────────────────────────────────
type Pattern = { flag: string; source: string; re: RegExp }
function mapPatterns(variable: string): Pattern[] {
  const m = new RegExp('map \\$' + variable + ' \\$\\w+ \\{([\\s\\S]*?)\\n\\}').exec(CONF)
  if (!m) throw new Error(`no map on $${variable} in eno.conf`)
  return [...m[1].matchAll(/^\s*"(~\*?)([^"]+)"\s+1;/gm)].map(([, flag, source]) => ({ flag, source, re: new RegExp(source, flag === '~*' ? 'i' : '') }))
}
const REDIRECT_OK = mapPatterns('arg_redirect_to')
const AMBIGUOUS = mapPatterns('args')
const S256_OK = mapPatterns('arg_code_challenge_method')

/** ngx_http_arg: the FIRST `name=` that starts the query or follows '&', the name matched case-insensitively. */
function ngxArg(args: string, name: string): string {
  const low = args.toLowerCase()
  for (let i = 0; ;) {
    const p = low.indexOf(name, i)
    if (p < 0) return ''
    if ((p === 0 || args[p - 1] === '&') && args[p + name.length] === '=') {
      const e = args.indexOf('&', p)
      return args.slice(p + name.length + 1, e < 0 ? undefined : e)
    }
    i = p + 1
  }
}
const nginxPasses = (args: string) =>
  !AMBIGUOUS.some((p) => p.re.test(args)) && REDIRECT_OK.some((p) => p.re.test(ngxArg(args, 'redirect_to'))) && ngxArg(args, 'code_challenge') !== ''
  && S256_OK.some((p) => p.re.test(ngxArg(args, 'code_challenge_method')))

/** Go's url.ParseQuery (net/url, Go ≥ 1.17): '&' only; a pair with ';' or a bad escape is dropped AND errors. */
function goUnescape(s: string): string | null {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '%') {
      const h = s.slice(i + 1, i + 3)
      if (!/^[0-9A-Fa-f]{2}$/.test(h)) return null
      out += String.fromCharCode(parseInt(h, 16))
      i += 2
    } else out += s[i] === '+' ? ' ' : s[i]
  }
  return out
}
function goParseQuery(q: string): { values: Map<string, string[]>; err: boolean } {
  const values = new Map<string, string[]>()
  let err = false
  for (const part of q.split('&')) {
    if (part.includes(';')) { err = true; continue }
    if (part === '') continue
    const eq = part.indexOf('=')
    const k = goUnescape(eq < 0 ? part : part.slice(0, eq))
    const v = goUnescape(eq < 0 ? '' : part.slice(eq + 1))
    if (k === null || v === null) { err = true; continue }
    values.set(k, [...(values.get(k) ?? []), v])
  }
  return { values, err }
}
/**
 * What GoTrue v2.189.0 does with it: redirect_to from r.ParseForm() — IGNORED when the parse errored
 * (utilities.GetReferrer then falls back to Referer / SITE_URL) — and code_challenge from r.URL.Query().
 */
function gotrue(q: string) {
  const { values, err } = goParseQuery(q)
  return {
    err, redirect: err ? '' : values.get('redirect_to')?.[0] ?? '', challenge: values.get('code_challenge')?.[0] ?? '',
    method: values.get('code_challenge_method')?.[0] ?? '',
  }
}
const ENO_HTTPS = /^https:\/\/(www\.)?eno\.(vn|forum)\//i

const X43 = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
/** auth-js 2.111.0 _getUrlForProvider, verbatim in shape (node_modules/@supabase/auth-js/dist/main/GoTrueClient.js). */
function supabaseQuery(provider: string, redirectTo: string, o: { queryParams?: Record<string, string>; skip?: boolean } = {}) {
  const p = [`provider=${encodeURIComponent(provider)}`, `redirect_to=${encodeURIComponent(redirectTo)}`]
  p.push(new URLSearchParams({ code_challenge: encodeURIComponent(X43), code_challenge_method: encodeURIComponent('s256') }).toString())
  if (o.queryParams) p.push(new URLSearchParams(o.queryParams).toString())
  if (o.skip) p.push('skip_http_redirect=true')
  return p.join('&')
}
const ENO = encodeURIComponent('https://eno.vn/auth/callback?next=%2F')
const q = (redirect: string, challenge = X43) => `provider=google&redirect_to=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=s256`

const LEGIT = [
  supabaseQuery('google', 'https://eno.vn/auth/callback?next=%2Fsell'),
  supabaseQuery('apple', 'https://eno.vn/auth/callback?next=%2F&p=apple'),
  supabaseQuery('apple', 'https://eno.vn/auth/callback?next=%2F&native=1&p=apple', { skip: true }),
  supabaseQuery('google', 'https://www.eno.forum/auth/callback?next=%2F'),
  supabaseQuery('google', 'https://eno.vn/auth/callback?handoff=0123456789abcdef&via=fb'),
  supabaseQuery('google', 'https://eno.vn/auth/callback?next=%2F', { queryParams: {}, skip: true }),   // '&&' — harmless
  `provider=google&redirect_to=https://eno.vn/auth/callback&code_challenge=${X43}&code_challenge_method=S256`,
]
const ATTACKS: Array<[string, string]> = [
  ['evil://eno.vn/ (any scheme on SITE_URL’s host)', q('evil://eno.vn/')],
  ['a loopback IP', q('http://127.0.0.1:9/')],
  ['plain http', q('http://eno.vn/')],
  ['a look-alike host', q('https://eno.vn.evil.com/')],
  ['userinfo after the host', `redirect_to=https%3A%2F%2Feno.vn%40evil.com%2F&code_challenge=${X43}`],
  ['no redirect_to', `provider=google&code_challenge=${X43}`],
  ['no code_challenge (the implicit flow)', `provider=google&redirect_to=${ENO}`],
  ['an empty code_challenge', `provider=google&redirect_to=${ENO}&code_challenge=`],
  ['a case-variant decoy first', `Redirect_To=${ENO}&redirect_to=evil%3A%2F%2Feno.vn%2F&code_challenge=${X43}`],
  ['an escaped-name redirect first', `redirect%5Fto=evil%3A%2F%2Feno.vn%2F&redirect_to=${ENO}&code_challenge=${X43}`],
  ['a semicolon pair', `redirect_to=${ENO};x&redirect_to=evil%3A%2F%2Feno.vn%2F&code_challenge=${X43}`],
  ['a bare code_challenge first', `code_challenge&code_challenge=${X43}&redirect_to=${ENO}`],
  ['a malformed escape in the challenge', `redirect_to=${ENO}&code_challenge=${X43}%zz`],
  ['an upper-case Code_Challenge only', `Code_Challenge=${X43}&redirect_to=${ENO}`],
  ['a trailing lone %', `redirect_to=${ENO}&code_challenge=${X43}&x=%`],
  ['plain PKCE — the challenge IS the verifier (C1)', `provider=google&redirect_to=${ENO}&code_challenge=${X43}&code_challenge_method=plain`],
  ['no code_challenge_method', `provider=google&redirect_to=${ENO}&code_challenge=${X43}`],
  ['an escaped method value', `provider=google&redirect_to=${ENO}&code_challenge=${X43}&code_challenge_method=s%32%356`],
  ['plain first, s256 after', `provider=google&redirect_to=${ENO}&code_challenge=${X43}&code_challenge_method=plain&code_challenge_method=s256`],
]

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
/**
 * Three quarters: a legitimate query with 0-2 mutations (a decoy pair before or after, an upper-cased or
 * percent-encoded name, a bare name, a broken escape, a ';', reordered pairs). One quarter: random pairs.
 */
function fuzzCorpus(n: number): string[] {
  const rnd = mulberry32(20261008)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]
  const NAMES = ['redirect_to', 'Redirect_To', 'REDIRECT_TO', 'redirect%5Fto', 'redirect%5fto', 'redirect_t%6F', 'redirect+to',
    'code_challenge', 'Code_challenge', 'code%5Fchallenge', 'code_challenge_method', 'provider', 'x']
  const VALUES = [ENO, 'https://eno.vn/auth/callback', 'https://www.eno.forum/x', 'HTTPS://ENO.VN/', 'evil%3A%2F%2Feno.vn%2F',
    'evil://eno.vn/', 'http://127.0.0.1:9/', '', X43, X43 + '%zz', '%', '%4', 'a;b', ENO + ';x', 'https%3A%2F%2Feno.vn%2F%40evil.com',
    'https%3A%2F%2Feno.vn%252F%40evil.com', 'https%3A%2F%2Feno.vn%5C%40evil.com']
  const randomPair = () => { const name = pick(NAMES); return rnd() < 0.1 ? name : `${name}=${pick(VALUES)}` }
  const mutate = (query: string): string => {
    const parts = query.split('&').filter(Boolean)
    const i = Math.floor(rnd() * parts.length)
    const name = parts[i].split('=')[0]
    if (!name) return query
    const j = Math.floor(rnd() * name.length)
    switch (Math.floor(rnd() * 8)) {
      case 0: parts.unshift(randomPair()); break
      case 1: parts.push(randomPair()); break
      case 2: parts[i] = name.slice(0, j) + name[j].toUpperCase() + parts[i].slice(j + 1); break
      case 3: parts[i] = name.slice(0, j) + '%' + name.charCodeAt(j).toString(16).toUpperCase().padStart(2, '0') + parts[i].slice(j + 1); break
      case 4: parts[i] = name; break
      case 5: parts[i] += pick(['%', '%4', '%zz', ';x']); break
      case 6: parts.reverse(); break
      default: return parts.join('&').replace('&', ';')
    }
    return parts.join(pick(['&', '&', '&', '&&']))
  }
  const out: string[] = []
  for (let k = 0; k < n; k++) {
    if (rnd() < 0.75) {
      let query = pick(LEGIT)
      for (let m = Math.floor(rnd() * 3); m > 0; m--) query = mutate(query)
      out.push(query)
    } else {
      out.push(Array.from({ length: 1 + Math.floor(rnd() * 5) }, randomPair).reduce((acc, part) => acc + pick(['&', '&', '&', ';', '&&']) + part))
    }
  }
  return out
}
const FUZZ = fuzzCorpus(4000)

describe('nginx: the GoTrue authorize guard on sb.eno.vn (plan §10, A2/D21)', { timeout: 60_000 }, () => {
  const block = (() => {
    const start = CONF.indexOf('server_name sb.eno.vn;')
    return CONF.slice(start, CONF.indexOf('\n}', start))
  })()

  it('guards /auth/v1/authorize in the sb.eno.vn server, before it proxies, and closes identity linking', () => {
    const guard = /location ~\* \^\/\+auth\/\+v1\/\+authorize \{([\s\S]*?)\n {2}\}/.exec(block)?.[1] ?? ''
    expect(guard.split('\n').map((l) => l.trim()).filter(Boolean)).toEqual([
      'if ($eno_authz_args_ambiguous = 1) { return 400; }',
      'if ($eno_authz_redirect_ok = 0)    { return 400; }',
      'if ($arg_code_challenge = "")      { return 400; }',
      'if ($eno_authz_s256 = 0)           { return 400; }',
      'proxy_pass http://127.0.0.1:8000;',
      'include /etc/nginx/snippets/eno-proxy.conf;',
    ])
    expect(block).toContain('location ~* ^/+auth/+v1/+user/+identities/+authorize { return 403; }')
    // only the sb.eno.vn server uses the maps; the app servers never proxy GoTrue
    expect(CONF.split('if ($eno_authz_').length - 1).toBe(3)
    expect(block.split('if ($eno_authz_').length - 1).toBe(3)
  })

  it('its locations catch every spelling nginx normalises to (and nothing else of GoTrue’s)', () => {
    const locs = [...block.matchAll(/location ~\* (\S+) \{/g)].map(([, re]) => new RegExp(re, 'i'))
    const [guard, identities] = locs
    for (const p of ['/auth/v1/authorize', '/auth/v1/authorize/', '/AUTH/V1/AUTHORIZE', '//auth//v1/authorize', '/auth/v1/authorize;x', '/auth/v1/authorize-x']) expect(guard.test(p), p).toBe(true)
    for (const p of ['/auth/v1/callback', '/auth/v1/token', '/auth/v1/settings', '/auth/v1/user', '/auth/v1/verify', '/auth/v1/user/identities/authorize']) expect(guard.test(p), p).toBe(false)
    expect(identities.test('/auth/v1/user/identities/authorize')).toBe(true)
    expect(identities.test('/auth/v1/user/identities')).toBe(false)
  })

  it('lets through every authorize URL supabase-js builds for eno', () => {
    for (const args of LEGIT) expect(nginxPasses(args), args).toBe(true)
  })

  for (const [what, args] of ATTACKS) {
    it(`refuses ${what}`, () => {
      expect(nginxPasses(args)).toBe(false)
    })
  }

  it('whatever it lets through, GoTrue reads as an https eno redirect WITH an S256 code_challenge (4,000 fuzzed queries)', () => {
    let passed = 0
    for (const args of [...LEGIT, ...ATTACKS.map(([, a]) => a), ...FUZZ]) {
      if (!nginxPasses(args)) continue
      passed++
      const g = gotrue(args)
      expect(g.err, args).toBe(false)
      expect(ENO_HTTPS.test(g.redirect), args).toBe(true)
      expect(g.challenge, args).not.toBe('')
      expect(g.method.toLowerCase(), args).toBe('s256')
    }
    // not vacuous: the fuzz both passes and refuses plenty
    expect(passed).toBeGreaterThan(40)
    expect(FUZZ.filter((a) => !nginxPasses(a)).length).toBeGreaterThan(2000)
  })

  it('without the ambiguity map, the same fuzz finds the bypasses it exists for', () => {
    const naive = (args: string) => REDIRECT_OK.some((p) => p.re.test(ngxArg(args, 'redirect_to'))) && ngxArg(args, 'code_challenge') !== ''
    const bypass = [...ATTACKS.map(([, a]) => a), ...FUZZ].filter((a) => {
      if (!naive(a)) return false
      const g = gotrue(a)
      return !g.err && (!ENO_HTTPS.test(g.redirect) || g.challenge === '')
    })
    expect(bypass.length).toBeGreaterThan(0)
  })

  it.skipIf(!PCRE2GREP)('PCRE2 (the engine nginx links) agrees with these regexes on every query', () => {
    const lines = [...LEGIT, ...ATTACKS.map(([, a]) => a), ...FUZZ]
    const d = scratch()
    const pcre = (p: Pattern, file: string) => {
      const r = spawnSync('pcre2grep', ['-n', ...(p.flag === '~*' ? ['-i'] : []), '--', p.source, file], { encoding: 'utf8' })
      expect(r.status, r.stderr).not.toBe(2)
      return new Set(r.stdout.split('\n').filter(Boolean).map((l) => Number(l.split(':', 1)[0]) - 1))
    }
    writeFileSync(join(d, 'args.txt'), lines.join('\n') + '\n')
    for (const p of AMBIGUOUS) expect([...pcre(p, join(d, 'args.txt'))].sort((a, b) => a - b), p.source).toEqual(lines.flatMap((l, i) => (p.re.test(l) ? [i] : [])))
    const redirects = lines.map((l) => ngxArg(l, 'redirect_to'))
    writeFileSync(join(d, 'redirects.txt'), redirects.join('\n') + '\n')
    for (const p of REDIRECT_OK) expect([...pcre(p, join(d, 'redirects.txt'))].sort((a, b) => a - b), p.source).toEqual(redirects.flatMap((l, i) => (p.re.test(l) ? [i] : [])))
  })
})

// ── the daily check's units ──────────────────────────────────────────────────────────────────────────────────
describe('eno-apple-siwa-check units', () => {
  it('fires once a day inside the 19:00-22:00 UTC low-traffic window, catching up after a reboot', () => {
    const at = /^OnCalendar=\*-\*-\* (\d\d):(\d\d):00 UTC$/m.exec(UNIT_TIMER)
    expect(at).not.toBeNull()
    const start = Number(at![1]) * 60 + Number(at![2])
    const delay = Number(/^RandomizedDelaySec=(\d+)$/m.exec(UNIT_TIMER)?.[1] ?? 0) / 60
    expect(start).toBeGreaterThanOrEqual(19 * 60)
    expect(start + delay).toBeLessThan(22 * 60)
    expect(UNIT_TIMER).toMatch(/^Persistent=true$/m)
    expect(UNIT_TIMER).toMatch(/^WantedBy=timers\.target$/m)
  })

  it('runs the copy install-timer installs, with the switch it writes, as a oneshot that shows in systemctl --failed', () => {
    expect(UNIT_SERVICE).toMatch(/^Type=oneshot$/m)
    expect(UNIT_SERVICE).toMatch(/^ExecStart=\/opt\/eno\/bin\/apply-apple-signin\.sh check$/m)
    expect(UNIT_SERVICE).toMatch(/^EnvironmentFile=-\/etc\/default\/eno-apple-siwa-check$/m)
    expect(SOURCE).toMatch(/BIN_DIR=\/opt\/eno\/bin;/)
    expect(SOURCE).toMatch(/DEFAULTS=\/etc\/default\/eno-apple-siwa-check$/m)
    expect(SOURCE).toContain('auto=${APPLE_SIWA_AUTO_ROTATE:-0}')
  })
})

// ── the box flows, in a sandbox ──────────────────────────────────────────────────────────────────────────────
const TEAM = 'TEAM123456'
const KID = 'KEY1234567'
const INSTALL = ['install', '--team', TEAM, '--kid', KID, '--services-id', 'vn.eno.web', '--bundle', 'vn.eno.app', '--flow-state-expiry', '10m', '--drop-localhost-redirect']
const BOX_FILES = ['supabase/.env', 'supabase/docker-compose.override.yml', 'secrets/eno-vn.env', 'secrets/eno-forum.env']

// The stubs: no backticks and no "${" (they are written from template literals). State lives in <box>/state.
const STUBS: Record<string, string> = {
  docker: String.raw`#!/usr/bin/env node
'use strict'
const fs = require('fs'), path = require('path'), cp = require('child_process')
const S = process.env.ENO_APPLE_SIWA_SANDBOX
const st = (f) => path.join(S, 'state', f)
const has = (f) => fs.existsSync(st(f))
const argv = process.argv.slice(2)
fs.appendFileSync(st('argv.log'), JSON.stringify(['docker'].concat(argv)) + '\n')
const parseEnv = (file) => {
  const o = {}
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(l)
    if (m) o[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
  }
  return o
}
// What "docker compose up" hands the auth container: the base file's two mappings, then every key of the
// override's services.auth.environment interpolated from supabase/.env (naive on purpose: the fixtures are ours).
const containerEnv = () => {
  const env = parseEnv(path.join(S, 'supabase/.env'))
  const out = { GOTRUE_SITE_URL: env.SITE_URL || '', GOTRUE_URI_ALLOW_LIST: env.ADDITIONAL_REDIRECT_URLS || '', GOTRUE_JWT_SECRET: env.JWT_SECRET || '' }
  let auth = false, envBlock = false
  for (const l of fs.readFileSync(path.join(S, 'supabase/docker-compose.override.yml'), 'utf8').split('\n')) {
    if (/^ {2}\S/.test(l)) { auth = /^ {2}auth:/.test(l); envBlock = false; continue }
    if (auth && /^ {4}\S/.test(l)) { envBlock = /^ {4}environment:/.test(l); continue }
    const m = auth && envBlock && /^ {6}([A-Z0-9_]+): *(.*)$/.exec(l)
    if (m) {
      const v = m[2].replace(/ +#.*$/, '').trim().replace(/^"(.*)"$/, '$1')
      const ref = /^[$][{]([A-Z0-9_]+)[}]$/.exec(v)
      out[m[1]] = ref ? (env[ref[1]] || '') : v
    }
  }
  return out
}
const a0 = argv[0], a1 = argv[1]
if (a0 === 'image' && a1 === 'inspect') process.exit(has('no-image') ? 1 : 0)
if (a0 === 'compose') {
  const sub = argv.slice(1)
  if (sub[0] === 'config') {
    const merged = fs.readFileSync(path.join(S, 'supabase/docker-compose.override.yml'), 'utf8').includes('GOTRUE_EXTERNAL_APPLE')
    process.exit(has('compose-config-fails') || (merged && has('compose-config-fails-after-merge')) ? 1 : 0)
  }
  if (sub[0] === 'up') {
    fs.appendFileSync(st('recreates.log'), sub.join(' ') + '\n')
    const e = containerEnv()
    fs.writeFileSync(st('auth.env'), Object.keys(e).map((k) => k + '=' + e[k]).join('\n') + '\n')
    process.exit(0)
  }
  if (sub[0] === 'ps') { if (!has('auth-down')) process.stdout.write('authcid0001\n'); process.exit(0) }
  process.exit(0)
}
if (a0 === 'inspect') {
  // An app container's running state — state/missing-<container> (no such container) or state/stopped-<container>.
  if (argv.some((x) => x.indexOf('.State.Running') >= 0)) {
    const c = argv[argv.length - 1]
    if (has('missing-' + c)) process.exit(1)
    process.stdout.write((has('stopped-' + c) ? 'false' : 'true') + '\n')
    process.exit(0)
  }
  // An app container's image label (eno-build.sh: the flag its bundle inlined) — state/label-<container>, else none.
  if (argv.some((x) => x.indexOf('vn.eno.apple-signin') >= 0)) {
    const f = st('label-' + argv[argv.length - 1])
    process.stdout.write((fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '') + '\n')
    process.exit(0)
  }
  process.stdout.write(fs.readFileSync(st('auth.env'), 'utf8')); process.exit(0)
}
if (a0 === 'exec') {
  const f = st('flag-' + a1)
  if (fs.existsSync(f)) { process.stdout.write(fs.readFileSync(f, 'utf8')); process.exit(0) }
  process.exit(1)
}
if (a0 === 'run') {
  const env = Object.assign({}, process.env)
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--env') { const kv = argv[++i]; env[kv.slice(0, kv.indexOf('='))] = kv.slice(kv.indexOf('=') + 1) }
  const r = cp.spawnSync(process.execPath, ['--eval', argv[argv.indexOf('--eval') + 1]], { input: fs.readFileSync(0), env })
  process.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exit(r.status === null ? 1 : r.status)
}
process.stderr.write('docker stub: unhandled ' + argv.join(' ') + '\n'); process.exit(1)
`,
  curl: String.raw`#!/usr/bin/env node
'use strict'
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const S = process.env.ENO_APPLE_SIWA_SANDBOX
const st = (f) => path.join(S, 'state', f)
const has = (f) => fs.existsSync(st(f))
const argv = process.argv.slice(2)
fs.appendFileSync(st('argv.log'), JSON.stringify(['curl'].concat(argv)) + '\n')
let out = null, fmt = null, url = '', stdinBody = false
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '-o') out = argv[++i]
  else if (a === '-w') fmt = argv[++i]
  else if (a === '-H' || a === '-X' || a === '--max-time') i++
  else if (a === '--data-binary') stdinBody = argv[++i] === '@-'
  else if (/^https?:\/\//.test(a)) url = a
}
const authEnv = () => {
  const o = {}
  for (const l of fs.readFileSync(st('auth.env'), 'utf8').split('\n')) if (l.includes('=')) o[l.slice(0, l.indexOf('='))] = l.slice(l.indexOf('=') + 1)
  return o
}
let status = 200, body = '', location = ''
const done = () => {
  if (out) fs.writeFileSync(out, body); else process.stdout.write(body)
  if (fmt) process.stdout.write(fmt.replace('%{http_code}', String(status)).replace('%{redirect_url}', location))
  process.exit(0)
}
const unreachable = () => { if (fmt) process.stdout.write(fmt.replace('%{http_code}', '000').replace('%{redirect_url}', '')); process.exit(7) }
if (url.endsWith('/auth/v1/settings')) {
  if (has('auth-down')) unreachable()
  const e = authEnv()
  body = JSON.stringify({ external: { apple: e.GOTRUE_EXTERNAL_APPLE_ENABLED === 'true' && !has('apple-stays-off'), google: e.GOTRUE_EXTERNAL_GOOGLE_ENABLED === 'true', email: true }, disable_signup: false, mailer_autoconfirm: false })
  done()
}
if (url === 'https://appleid.apple.com/auth/token') {
  const form = new URLSearchParams(stdinBody ? fs.readFileSync(0, 'utf8') : '')
  const secret = form.get('client_secret') || ''
  fs.appendFileSync(st('apple-secrets.log'), secret + '\n')
  const perClient = 'apple-answer-' + (form.get('client_id') || '')
  const forced = has(perClient) ? fs.readFileSync(st(perClient), 'utf8').trim() : has('apple-answer') ? fs.readFileSync(st('apple-answer'), 'utf8').trim() : ''
  if (forced === 'unreachable') unreachable()
  // Apple, as far as a probe can tell: the key's signature, kid, team, client id, audience and expiry.
  const apple = JSON.parse(fs.readFileSync(st('apple.json'), 'utf8'))
  let good = false
  try {
    const parts = secret.split('.')
    const head = JSON.parse(Buffer.from(parts[0], 'base64url')), claims = JSON.parse(Buffer.from(parts[1], 'base64url'))
    const sig = crypto.createVerify('SHA256').update(parts[0] + '.' + parts[1]).verify({ key: fs.readFileSync(st('pub.pem')), dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url'))
    good = sig && head.alg === 'ES256' && head.kid === apple.kid && claims.iss === apple.team && claims.sub === form.get('client_id') &&
      claims.aud === 'https://appleid.apple.com' && claims.exp > Date.now() / 1000 && form.get('code') === 'probe' && form.get('grant_type') === 'authorization_code'
  } catch (e) { good = false }
  status = 400
  body = JSON.stringify({ error: forced === 'invalid_client' || !good ? 'invalid_client' : 'invalid_grant' })
  done()
}
if (url.includes('/auth/v1/authorize')) {
  const e = authEnv()
  if (e.GOTRUE_EXTERNAL_APPLE_ENABLED !== 'true' || has('apple-stays-off')) { status = 400; body = '{"msg":"Unsupported provider"}'; done() }
  status = 302
  location = 'https://appleid.apple.com/auth/authorize?' + new URLSearchParams({ client_id: e.GOTRUE_EXTERNAL_APPLE_CLIENT_ID.split(',')[0], redirect_uri: e.GOTRUE_EXTERNAL_APPLE_REDIRECT_URI, response_mode: 'form_post', response_type: 'code', scope: 'email name', state: 'flow' }).toString()
  done()
}
process.stderr.write('curl stub: unhandled ' + url + '\n'); process.exit(1)
`,
  flock: '#!/bin/sh\necho "flock $*" >> "$ENO_APPLE_SIWA_SANDBOX/state/argv.log"\n[ -f "$ENO_APPLE_SIWA_SANDBOX/state/flock-busy" ] && exit 1\nexit 0\n',
  shred: '#!/bin/sh\necho "shred $*" >> "$ENO_APPLE_SIWA_SANDBOX/state/argv.log"\nfor a in "$@"; do case "$a" in -*) ;; *) rm -f "$a" ;; esac; done\nexit 0\n',
  systemctl: '#!/bin/sh\necho "systemctl $*" >> "$ENO_APPLE_SIWA_SANDBOX/state/argv.log"\n[ "$1" = list-timers ] && echo "eno-apple-siwa-check.timer eno-apple-siwa-check.service"\nexit 0\n',
}

type Box = { dir: string; env: Record<string, string>; p8: string; p8b64: string; tokenKey: string; pub: KeyObject; originals: Record<string, string> }

function boxEnv(dir: string): Record<string, string> {
  return { PATH: `${join(dir, 'stubs')}:${process.env.PATH ?? ''}`, ENO_APPLE_SIWA_SANDBOX: dir, ENO_APPLE_SIWA_POLL_SECS: '0', ENO_APPLE_SIWA_POLL_TRIES: '3' }
}

function makeBox(o: { override?: string } = {}): Box {
  const dir = scratch('eno-siwa-box-')
  for (const d of ['supabase', 'secrets', 'stubs', 'state']) mkdirSync(join(dir, d))
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const p8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const tokenKey = randomBytes(32).toString('base64')
  const originals: Record<string, string> = {
    'supabase/.env': SUPABASE_ENV,
    'supabase/docker-compose.override.yml': o.override ?? GOOGLE_OTP,
    'secrets/eno-vn.env': VN_APP_ENV,
    'secrets/eno-forum.env': FORUM_APP_ENV,
  }
  for (const [rel, text] of Object.entries(originals)) writeFileSync(join(dir, rel), text, { mode: rel.startsWith('secrets/') ? 0o600 : 0o644 })
  writeFileSync(join(dir, 'secrets/apple-siwa.p8'), p8, { mode: 0o600 })
  writeFileSync(join(dir, 'secrets/apple-token-enc.key'), tokenKey + '\n', { mode: 0o600 })
  for (const [name, src] of Object.entries(STUBS)) {
    writeFileSync(join(dir, 'stubs', name), src)
    chmodSync(join(dir, 'stubs', name), 0o755)
  }
  writeFileSync(join(dir, 'state/pub.pem'), publicKey.export({ type: 'spki', format: 'pem' }).toString())
  writeFileSync(join(dir, 'state/apple.json'), JSON.stringify({ team: TEAM, kid: KID }))
  const env = boxEnv(dir)
  // the auth container as it runs before the change: what the original files give it
  spawnSync(join(dir, 'stubs/docker'), ['compose', 'up', '-d', '--no-deps', 'auth'], { env: { ...ENV, ...env } })
  for (const f of ['recreates.log', 'argv.log']) rmSync(join(dir, 'state', f), { force: true })
  return { dir, env, p8, p8b64: Buffer.from(p8).toString('base64'), tokenKey, pub: publicKey, originals }
}

function cloneBox(b: Box): Box {
  const dir = join(tmpdir(), `eno-siwa-box-${randomBytes(6).toString('hex')}`)
  cpSync(b.dir, dir, { recursive: true })
  scratchDirs.push(dir)
  for (const name of Object.keys(STUBS)) chmodSync(join(dir, 'stubs', name), 0o755)
  for (const f of ['recreates.log', 'argv.log']) rmSync(join(dir, 'state', f), { force: true })
  return { ...b, dir, env: boxEnv(dir) }
}

const at = (b: Box, rel: string) => join(b.dir, rel)
const read = (b: Box, rel: string) => readFileSync(at(b, rel), 'utf8')
const lines = (b: Box, rel: string) => (existsSync(at(b, rel)) ? read(b, rel).split('\n').filter(Boolean) : [])
const envOf = (b: Box, rel: string) => Object.fromEntries(read(b, rel).split('\n').filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const snapshot = (b: Box) => Object.fromEntries(BOX_FILES.map((f) => [f, read(b, f)]))
const backups = (b: Box) => (existsSync(at(b, 'backups')) ? readdirSync(at(b, 'backups')).sort() : [])
const meta = (b: Box, ts: string) => Object.fromEntries(read(b, `backups/${ts}/meta`).split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const run_ = (b: Box, args: string[], extra: Record<string, string> = {}) => run(args, { env: { ...b.env, ...extra } })
const setLine = (b: Box, rel: string, key: string, value: string) =>
  writeFileSync(at(b, rel), read(b, rel).replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`))

/** Every secret this box ever held: the .p8 (PEM body and base64), the token key, every client secret Apple saw. */
function secretsOf(b: Box): string[] {
  const s = [b.tokenKey, b.p8b64.slice(60, 120), ...b.p8.split('\n').filter((l) => l.length >= 40 && !l.startsWith('-----'))]
  for (const jwt of lines(b, 'state/apple-secrets.log')) s.push(jwt, jwt.split('.')[2] ?? jwt)
  const env = existsSync(at(b, 'supabase/.env')) ? envOf(b, 'supabase/.env').GOTRUE_EXTERNAL_APPLE_SECRET : undefined
  if (env) s.push(env, env.split('.')[2])
  return s.filter((x) => x && x.length >= 32)
}
function expectNoLeak(b: Box, ...outputs: string[]) {
  const argv = existsSync(at(b, 'state/argv.log')) ? read(b, 'state/argv.log') : ''
  const metas = backups(b).map((ts) => read(b, `backups/${ts}/meta`)).join('\n')
  for (const secret of secretsOf(b)) {
    for (const [where, text] of [...outputs.map((o, i) => [`output ${i}`, o] as const), ['argv', argv] as const, ['backup meta', metas] as const]) {
      expect(text.includes(secret), `a secret reached ${where}`).toBe(false)
    }
  }
}

describe('the box flows, in a sandbox (stub docker, curl, flock, shred, systemctl)', { timeout: 120_000 }, () => {
  let GOLD: Box
  let goldRun: Run
  beforeAll(() => {
    GOLD = makeBox()
    goldRun = run_(GOLD, INSTALL)
  }, 120_000)

  it('install: backs up first, writes both app env files, GoTrue env and the ONE auth block, recreates auth once, proves it, shreds the token key — and prints only key id, expiry and fingerprint', () => {
    expect(goldRun.status, goldRun.out).toBe(0)
    const b = GOLD
    // the backup holds the four files exactly as they were
    const [ts, ...more] = backups(b)
    expect(more).toEqual([])
    for (const [rel, name] of [['supabase/.env', 'supabase.env'], ['supabase/docker-compose.override.yml', 'docker-compose.override.yml'], ['secrets/eno-vn.env', 'eno-vn.env'], ['secrets/eno-forum.env', 'eno-forum.env']]) {
      expect(read(b, `backups/${ts}/${name}`), name).toBe(b.originals[rel])
    }
    expect(meta(b, ts)).toMatchObject({ command: 'install', result: 'ok', key_id: KID, services_id: 'vn.eno.web' })
    // both app env files: the app's names, the base64 .p8, the token key, an EMPTY flag — nothing else touched
    for (const rel of ['secrets/eno-vn.env', 'secrets/eno-forum.env']) {
      expect(inserted(b.originals[rel], read(b, rel))).toEqual([
        `APPLE_SIWA_TEAM_ID=${TEAM}`, `APPLE_SIWA_KEY_ID=${KID}`, `APPLE_SIWA_PRIVATE_KEY=${b.p8b64}`, 'APPLE_SIWA_SERVICES_ID=vn.eno.web',
        'APPLE_SIWA_BUNDLE_ID=vn.eno.app', `APPLE_TOKEN_ENC_KEY=${b.tokenKey}`, 'NEXT_PUBLIC_APPLE_SIGNIN=',
      ])
      expect(statSync(at(b, rel)).mode & 0o777).toBe(0o600)
      expect(read(b, rel)).not.toMatch(/^APPLE_TEAM_ID=/m)
    }
    // GoTrue's env: the four Apple values + the flow-state expiry; localhost:3000 gone, every other entry kept
    const sb = envOf(b, 'supabase/.env')
    expect(sb).toMatchObject({
      GOTRUE_EXTERNAL_APPLE_ENABLED: 'true', GOTRUE_EXTERNAL_APPLE_CLIENT_ID: 'vn.eno.web,vn.eno.app',
      GOTRUE_EXTERNAL_APPLE_REDIRECT_URI: 'https://sb.eno.vn/auth/v1/callback', GOTRUE_EXTERNAL_FLOW_STATE_EXPIRY_DURATION: '10m',
      ADDITIONAL_REDIRECT_URLS: 'https://eno.vn/**,https://www.eno.vn/**,https://eno.forum/**,https://www.eno.forum/**',
      GOTRUE_EXTERNAL_GOOGLE_SECRET: FAKE_GSECRET,
    })
    const jwt = sb.GOTRUE_EXTERNAL_APPLE_SECRET
    const [h, c, s] = jwt.split('.')
    expect(createVerify('SHA256').update(`${h}.${c}`).verify({ key: b.pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true)
    expect(b64json(h)).toEqual({ alg: 'ES256', kid: KID })
    const claims = b64json(c)
    expect(claims).toMatchObject({ iss: TEAM, sub: 'vn.eno.web', aud: 'https://appleid.apple.com' })
    expect(Number(claims.exp) - Number(claims.iat)).toBe(175 * 86400)
    // the override: one auth block, the passthroughs appended to its environment
    expect(inserted(GOOGLE_OTP, read(b, 'supabase/docker-compose.override.yml'))).toEqual(passthroughLines())
    // auth recreated exactly once, only auth; the token-key file shredded; the .p8 kept
    expect(lines(b, 'state/recreates.log')).toEqual(['up -d --no-deps auth'])
    expect(existsSync(at(b, 'secrets/apple-token-enc.key'))).toBe(false)
    expect(read(b, 'state/argv.log')).toContain(`shred -u ${at(b, 'secrets/apple-token-enc.key')}`)
    expect(existsSync(at(b, 'secrets/apple-siwa.p8'))).toBe(true)
    // the mint ran in the app image, sealed off
    const mintCall = lines(b, 'state/argv.log').find((l) => l.startsWith('["docker","run"'))!
    for (const flag of ['"--network","none"', '"--log-driver","none"', '"--pull","never"', '"--read-only"', '"eno-vn:local"']) expect(mintCall).toContain(flag)
    // what it printed: the key id, the expiry, the fingerprint, Apple's verdicts — no secret anywhere
    expect(goldRun.out).toContain(`key id       ${KID}`)
    expect(goldRun.out).toContain(`fingerprint  ${fp(jwt)}`)
    expect(goldRun.out).toMatch(/expires {6}\d{4}-\d\d-\d\d \(17[45] days\)/)
    expect(goldRun.out).toContain('Apple accepts it for vn.eno.web (code=probe -> invalid_grant)')
    expect(goldRun.out).toContain('302 -> appleid.apple.com client_id=vn.eno.web response_mode=form_post redirect_uri=https://sb.eno.vn/auth/v1/callback')
    expect(goldRun.out).toContain('auth container: GOTRUE_MAILER_OTP_EXP=3600')
    expectNoLeak(b, goldRun.out)
  })

  it('proves the key at Apple BEFORE writing anything: invalid_client is refused with no backup and no recreate', () => {
    const b = makeBox()
    writeFileSync(at(b, 'state/apple-answer'), 'invalid_client')
    const r = run_(b, INSTALL)
    expect(r.status, r.out).toBe(3)
    expect(r.out).toMatch(/Apple refuses the client secret for vn\.eno\.web \(invalid_client/)
    expect(snapshot(b)).toEqual(b.originals)
    expect(backups(b)).toEqual([])
    expect(lines(b, 'state/recreates.log')).toEqual([])
    expect(existsSync(at(b, 'secrets/apple-token-enc.key'))).toBe(true)
    expectNoLeak(b, r.out)
  })

  it('a failure after the recreate puts EVERY file back and recreates auth on them', () => {
    const b = makeBox()
    writeFileSync(at(b, 'state/apple-stays-off'), '')
    const r = run_(b, INSTALL)
    expect(r.status, r.out).toBe(1)
    expect(r.out).toMatch(/GoTrue did not report apple, google and email on/)
    expect(r.out).toContain('FAILED — putting every file back')
    expect(snapshot(b)).toEqual(b.originals)
    expect(lines(b, 'state/recreates.log')).toEqual(['up -d --no-deps auth', 'up -d --no-deps auth'])
    expect(meta(b, backups(b)[0]).result).toBe('restored')
    expect(existsSync(at(b, 'secrets/apple-token-enc.key'))).toBe(true)
    // the restored container runs the restored files again
    expect(read(b, 'state/auth.env')).not.toContain('GOTRUE_EXTERNAL_APPLE_')
    expectNoLeak(b, r.out)
  })

  it('a configuration compose refuses AFTER the merge is put back the same way; one it refuses before is never touched', () => {
    const b = makeBox()
    writeFileSync(at(b, 'state/compose-config-fails-after-merge'), '')
    const r = run_(b, INSTALL)
    expect(r.status, r.out).toBe(1)
    expect(r.out).toContain('docker compose config refused the configuration')
    expect(snapshot(b)).toEqual(b.originals)
    expect(lines(b, 'state/recreates.log')).toEqual(['up -d --no-deps auth'])   // the restore's own recreate
    expect(meta(b, backups(b)[0]).result).toBe('restored')
    const c = makeBox()
    writeFileSync(at(c, 'state/compose-config-fails'), '')
    expect(run_(c, INSTALL).status).toBe(3)
    expect(snapshot(c)).toEqual(c.originals)
    expect(backups(c)).toEqual([])
  })

  it('refuses an override with two auth: blocks before touching anything', () => {
    const b = makeBox({ override: TWO_AUTH })
    const r = run_(b, INSTALL)
    expect(r.status, r.out).toBe(3)
    expect(r.out).toMatch(/expected exactly one services\.auth block in the override, found 2/)
    expect(snapshot(b)).toEqual(b.originals)
    expect(backups(b)).toEqual([])
  })

  it('a re-run keeps the token key, the key and a flipped rollout flag — and works without the input files', () => {
    const b = cloneBox(GOLD)
    setLine(b, 'secrets/eno-vn.env', 'NEXT_PUBLIC_APPLE_SIGNIN', 'ios,web-test')
    rmSync(at(b, 'secrets/apple-siwa.p8'))
    const before = envOf(b, 'secrets/eno-vn.env')
    const r = run_(b, INSTALL)
    expect(r.status, r.out).toBe(0)
    expect(r.out).toContain(`re-using key ${KID} from eno-vn.env`)
    expect(r.out).toContain('keeping the APPLE_TOKEN_ENC_KEY already in eno-vn.env')
    const after = envOf(b, 'secrets/eno-vn.env')
    expect(after.NEXT_PUBLIC_APPLE_SIGNIN).toBe('ios,web-test')
    expect(after.APPLE_TOKEN_ENC_KEY).toBe(before.APPLE_TOKEN_ENC_KEY)
    expect(after.APPLE_SIWA_PRIVATE_KEY).toBe(before.APPLE_SIWA_PRIVATE_KEY)
    expect(envOf(b, 'secrets/eno-forum.env').APPLE_TOKEN_ENC_KEY).toBe(b.tokenKey)
    expect(read(b, 'supabase/docker-compose.override.yml')).toBe(read(GOLD, 'supabase/docker-compose.override.yml'))
    expectNoLeak(b, r.out)
  })

  it('never replaces the token key: a different key file is refused (it would orphan every stored token)', () => {
    const b = cloneBox(GOLD)
    writeFileSync(at(b, 'secrets/apple-token-enc.key'), randomBytes(32).toString('base64') + '\n', { mode: 0o600 })
    const before = snapshot(b)
    const r = run_(b, INSTALL)
    expect(r.status, r.out).toBe(3)
    expect(r.out).toMatch(/would orphan every stored Apple token/)
    expect(snapshot(b)).toEqual(before)
  })

  it('rotate swaps only GoTrue’s secret, proves it, and keeps a backup', () => {
    const b = cloneBox(GOLD)
    const before = snapshot(b)
    const old = envOf(b, 'supabase/.env').GOTRUE_EXTERNAL_APPLE_SECRET
    const r = run_(b, ['rotate'])
    expect(r.status, r.out).toBe(0)
    const now = envOf(b, 'supabase/.env').GOTRUE_EXTERNAL_APPLE_SECRET
    expect(now).not.toBe(old)
    expect(read(b, 'supabase/.env')).toBe(before['supabase/.env'].replace(old, now))
    for (const f of BOX_FILES.slice(1)) expect(read(b, f), f).toBe(before[f])
    expect(lines(b, 'state/recreates.log')).toEqual(['up -d --no-deps auth'])
    const ts = backups(b).at(-1)!
    expect(meta(b, ts)).toMatchObject({ command: 'rotate', result: 'ok', secret_fp: fp(now) })
    expect(r.out).toContain(`fingerprint  ${fp(now)}`)
    expectNoLeak(b, r.out)
  })

  it('check: healthy — and calibrated: a broken copy of the secret comes back invalid_client', () => {
    const b = cloneBox(GOLD)
    const r = run_(b, ['check', '--calibrate'])
    expect(r.status, r.out).toBe(0)
    expect(r.out).toContain(`key id       ${KID}`)
    expect(r.out).toContain('the running auth container holds this secret')
    expect(r.out).toContain('calibration: a broken copy -> invalid_client (the probe tells them apart)')
    expect(r.out).toContain('healthy')
    expect(lines(b, 'state/recreates.log')).toEqual([])
    expectNoLeak(b, r.out)
  })

  it('check fails when the running container holds another secret than .env, or Apple refuses it', () => {
    const b = cloneBox(GOLD)
    writeFileSync(at(b, 'state/auth.env'), read(b, 'state/auth.env').replace(/^GOTRUE_EXTERNAL_APPLE_SECRET=.*$/m, 'GOTRUE_EXTERNAL_APPLE_SECRET=stale.stale.stale'))
    const r = run_(b, ['check'])
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/not \.env's secret/)
    const c = cloneBox(GOLD)
    writeFileSync(at(c, 'state/apple-answer'), 'invalid_client')
    const r2 = run_(c, ['check'])
    expect(r2.status).toBe(1)
    expect(r2.out).toMatch(/invalid_client/)
  })

  it('at 30 days or fewer: check fails — or, with auto-rotate, rotates in the window and defers outside it', () => {
    const b = cloneBox(GOLD)
    const short = run(['_mint-local', 'vn.eno.web', String(10 * 86400), TEAM, KID], { input: b.p8 }).stdout
    setLine(b, 'supabase/.env', 'GOTRUE_EXTERNAL_APPLE_SECRET', short)
    writeFileSync(at(b, 'state/auth.env'), read(b, 'state/auth.env').replace(/^GOTRUE_EXTERNAL_APPLE_SECRET=.*$/m, `GOTRUE_EXTERNAL_APPLE_SECRET=${short}`))
    const alert = run_(b, ['check'])
    expect(alert.status).toBe(1)
    expect(alert.out).toMatch(/(9|10) days left — rotate now/)
    const deferred = run_(b, ['check', '--auto-rotate'], { ENO_APPLE_SIWA_UTC_HOUR: '12' })
    expect(deferred.status, deferred.out).toBe(0)
    expect(deferred.out).toContain('deferred to the 19:00-22:00 UTC window')
    expect(envOf(b, 'supabase/.env').GOTRUE_EXTERNAL_APPLE_SECRET).toBe(short)
    // the unit's switch (EnvironmentFile) is the same as the flag
    const rotated = run_(b, ['check'], { ENO_APPLE_SIWA_UTC_HOUR: '20', APPLE_SIWA_AUTO_ROTATE: '1' })
    expect(rotated.status, rotated.out).toBe(0)
    const fresh = envOf(b, 'supabase/.env').GOTRUE_EXTERNAL_APPLE_SECRET
    expect(fresh).not.toBe(short)
    expect(Number(b64json(fresh.split('.')[1]).exp) - Date.now() / 1000).toBeGreaterThan(170 * 86400)
    expect(lines(b, 'state/recreates.log')).toEqual(['up -d --no-deps auth'])
    expectNoLeak(b, alert.out, deferred.out, rotated.out)
  })

  it('⛔ a rotation never clears what failed before it: a container/.env mismatch + rotation due → rotates, still exit 1 (C1)', () => {
    const b = cloneBox(GOLD)
    const short = run(['_mint-local', 'vn.eno.web', String(10 * 86400), TEAM, KID], { input: b.p8 }).stdout
    setLine(b, 'supabase/.env', 'GOTRUE_EXTERNAL_APPLE_SECRET', short)
    writeFileSync(at(b, 'state/auth.env'), read(b, 'state/auth.env').replace(/^GOTRUE_EXTERNAL_APPLE_SECRET=.*$/m, 'GOTRUE_EXTERNAL_APPLE_SECRET=stale.stale.stale'))
    const r = run_(b, ['check', '--auto-rotate'], { ENO_APPLE_SIWA_UTC_HOUR: '20' })
    expect(r.status, r.out).toBe(1)
    expect(r.out).toMatch(/not \.env's secret/)
    expect(r.out).toContain('rotated — but 1 earlier check(s) failed above')
    // the rotation ran under check's own lock: one flock, never a second open of the lock file
    expect(lines(b, 'state/argv.log').filter((l) => l.startsWith('flock '))).toHaveLength(1)
    expect(envOf(b, 'supabase/.env').GOTRUE_EXTERNAL_APPLE_SECRET).not.toBe(short)
    expectNoLeak(b, r.out)
  })

  it('⛔ install refuses — before any write — when Apple refuses the key for the app’s bundle id; unreachable only warns', () => {
    const b = makeBox()
    writeFileSync(at(b, 'state/apple-answer-vn.eno.app'), 'invalid_client')
    const before = snapshot(b)
    const r = run_(b, INSTALL)
    expect(r.status, r.out).toBe(3)
    expect(r.out).toContain('Apple refuses this key for vn.eno.app: native sign-in would keep no token to revoke')
    expect(snapshot(b)).toEqual(before)
    expect(lines(b, 'state/recreates.log')).toEqual([])
    expectNoLeak(b, r.out)
    const c = makeBox()
    writeFileSync(at(c, 'state/apple-answer-vn.eno.app'), 'unreachable')
    const ok = run_(c, INSTALL)
    expect(ok.status, ok.out).toBe(0)
    expect(ok.out).toContain('vn.eno.app -> unreachable')
  })

  it('⛔ check reads under the lock: a lock held for 15 minutes FAILS the run — no probe, never a silent pass', () => {
    const b = cloneBox(GOLD)
    writeFileSync(at(b, 'state/flock-busy'), '')
    const probes = lines(b, 'state/apple-secrets.log').length // the box's own install probed already
    const r = run_(b, ['check', '--calibrate'])
    expect(r.status, r.out).toBe(1)
    expect(r.out).toContain('stayed busy for 15 minutes')
    expect(r.out).toContain('nothing was checked')
    expect(lines(b, 'state/apple-secrets.log')).toHaveLength(probes)
    expect(lines(b, 'state/argv.log').some((l) => l.startsWith('flock -w 900'))).toBe(true)
  })

  it('check with Apple off in GoTrue passes without probing', () => {
    const b = makeBox()
    const r = run_(b, ['check'])
    expect(r.status, r.out).toBe(0)
    expect(r.out).toContain('nothing to check')
    expect(lines(b, 'state/apple-secrets.log')).toEqual([])
  })

  it('restore <ts> puts the pre-install files back, recreates auth, and keeps a pre-restore backup', () => {
    const b = cloneBox(GOLD)
    const ts = backups(b)[0]
    const r = run_(b, ['restore', ts])
    expect(r.status, r.out).toBe(0)
    // ⛔ Everything back as it was — except the apps' Apple revocation settings, which a restore never takes away
    // (C1/C3 + follow-up): stored tokens need the key to open them and the rest to mint Apple's client secret. They
    // come back from the pre-restore copy, and no value ever reaches the output.
    const snap = snapshot(b)
    for (const f of ['secrets/eno-vn.env', 'secrets/eno-forum.env']) {
      const was = envOf(GOLD, f)
      for (const k of ['APPLE_SIWA_TEAM_ID', 'APPLE_SIWA_KEY_ID', 'APPLE_SIWA_PRIVATE_KEY', 'APPLE_SIWA_SERVICES_ID', 'APPLE_SIWA_BUNDLE_ID', 'APPLE_TOKEN_ENC_KEY']) {
        expect(envOf(b, f)[k], `${f} ${k}`).toBe(was[k])
        snap[f] = snap[f].replace(new RegExp(`^${k}=.*\\n`, 'm'), '')
      }
      expect(r.out).toContain(`kept the Apple revocation settings in ${f.split('/')[1]}`)
    }
    expect(snap).toEqual(b.originals)
    expect(lines(b, 'state/recreates.log')).toEqual(['up -d --no-deps auth'])
    expect(r.out).toContain('Apple is off in GoTrue')
    const pre = backups(b).filter((d) => d !== ts)
    expect(pre).toHaveLength(1)
    expect(meta(b, pre[0])).toMatchObject({ command: 'pre-restore', result: 'ok' })
    expect(read(b, `backups/${pre[0]}/eno-vn.env`)).toBe(read(GOLD, 'secrets/eno-vn.env'))
    expectNoLeak(b, r.out)
  })

  it('restore refuses to revert what it does not manage — unless --force', () => {
    const b = cloneBox(GOLD)
    const ts = backups(b)[0]
    writeFileSync(at(b, 'secrets/eno-vn.env'), read(b, 'secrets/eno-vn.env') + 'INDEXNOW_KEY=added-later\n')
    const before = snapshot(b)
    const r = run_(b, ['restore', ts])
    expect(r.status).toBe(3)
    expect(r.out).toMatch(/eno-vn\.env: INDEXNOW_KEY/)
    expect(r.out).not.toContain('added-later')
    expect(snapshot(b)).toEqual(before)
    const forced = run_(b, ['restore', ts, '--force'])
    expect(forced.status, forced.out).toBe(0)
    let vn = read(b, 'secrets/eno-vn.env')
    for (const k of ['APPLE_SIWA_TEAM_ID', 'APPLE_SIWA_KEY_ID', 'APPLE_SIWA_PRIVATE_KEY', 'APPLE_SIWA_SERVICES_ID', 'APPLE_SIWA_BUNDLE_ID', 'APPLE_TOKEN_ENC_KEY']) {
      expect(envOf(b, 'secrets/eno-vn.env')[k], k).toBe(envOf(GOLD, 'secrets/eno-vn.env')[k]) // the revocation settings stay
      vn = vn.replace(new RegExp(`^${k}=.*\\n`, 'm'), '')
    }
    expect(vn).toBe(b.originals['secrets/eno-vn.env'])
  })

  it('restore refuses to turn GoTrue’s Apple off while the running apps still show Apple (I13, B5)', () => {
    const b = cloneBox(GOLD)
    writeFileSync(at(b, 'state/flag-eno-vn-app'), 'ios,web-test')
    const before = snapshot(b)
    const r = run_(b, ['restore', backups(b)[0]])
    expect(r.status).toBe(3)
    expect(r.out).toMatch(/I13: empty the flag in both env files and deploy FIRST/)
    expect(snapshot(b)).toEqual(before)
    expect(lines(b, 'state/recreates.log')).toEqual([])
  })

  // ⛔ …AND THE IMAGE'S OWN FLAG. `eno-deploy.sh --rollback` runs :prev under the CURRENT env file: an emptied env
  // over an image BUILT with `ios` still shows Apple (NEXT_PUBLIC_* is inlined). eno-build.sh labels each image.
  it('restore also refuses while a running app’s IMAGE was built with the flag, though its env is empty (a rollback)', () => {
    const b = cloneBox(GOLD)
    writeFileSync(at(b, 'state/label-eno-vn-app'), 'ios,web-test')
    const before = snapshot(b)
    const r = run_(b, ['restore', backups(b)[0]])
    expect(r.status).toBe(3)
    expect(r.out).toContain('eno-vn-app=(empty) built:ios,web-test')
    expect(r.out).toMatch(/I13: empty the flag in both env files and deploy FIRST/)
    expect(snapshot(b)).toEqual(before)
    expect(lines(b, 'state/recreates.log')).toEqual([])
    // An image built without it — or older than the label — is no reason to refuse.
    writeFileSync(at(b, 'state/label-eno-vn-app'), '')
    const ok = run_(b, ['restore', backups(b)[0]])
    expect(ok.status, ok.out).toBe(0)
  })

  it('⛔ restore refuses when an app container cannot be read — missing or not running is not "flag empty" (C1)', () => {
    for (const state of ['missing-eno-forum-app', 'stopped-eno-vn-app']) {
      const b = cloneBox(GOLD)
      writeFileSync(at(b, `state/${state}`), '')
      const before = snapshot(b)
      const r = run_(b, ['restore', backups(b)[0]])
      expect(r.status, state).toBe(3)
      expect(r.out).toContain(`${state.replace(/^(missing|stopped)-/, '')}=(not running: cannot tell)`)
      expect(r.out).toMatch(/I13: empty the flag in both env files and deploy FIRST/)
      expect(snapshot(b)).toEqual(before)
      expect(lines(b, 'state/recreates.log')).toEqual([])
      const forced = run_(b, ['restore', backups(b)[0], '--force'])
      expect(forced.status, forced.out).toBe(0)
    }
  })

  it('⛔ restore keeps the revocation settings AS ONE SET: an older set in the backup is replaced by the running one', () => {
    const b = cloneBox(GOLD)
    const ts = backups(b)[0]
    // The install's backup, as if an EARLIER install had left a different key id and services id in it.
    const old = at(b, `backups/${ts}/eno-vn.env`)
    writeFileSync(old, readFileSync(old, 'utf8') + 'APPLE_SIWA_KEY_ID=OLDKEY0001\nAPPLE_SIWA_SERVICES_ID=vn.eno.old\n')
    const r = run_(b, ['restore', ts, '--force'])
    expect(r.status, r.out).toBe(0)
    const now = envOf(b, 'secrets/eno-vn.env'), was = envOf(GOLD, 'secrets/eno-vn.env')
    for (const k of ['APPLE_SIWA_TEAM_ID', 'APPLE_SIWA_KEY_ID', 'APPLE_SIWA_PRIVATE_KEY', 'APPLE_SIWA_SERVICES_ID', 'APPLE_SIWA_BUNDLE_ID', 'APPLE_TOKEN_ENC_KEY']) {
      expect(now[k], k).toBe(was[k])
    }
    expect(read(b, 'secrets/eno-vn.env')).not.toContain('OLDKEY0001')
    expectNoLeak(b, r.out)
  })

  it('⛔ …and a setting the running copy does NOT hold is removed, never left from the backup (one set, by construction)', () => {
    const b = cloneBox(GOLD)
    const ts = backups(b)[0]
    // Running: the bundle id gone by hand. Backup: an older bundle id. Restore must not pair the old id with the new key.
    writeFileSync(at(b, 'secrets/eno-vn.env'), read(b, 'secrets/eno-vn.env').replace(/^APPLE_SIWA_BUNDLE_ID=.*\n/m, ''))
    const old = at(b, `backups/${ts}/eno-vn.env`)
    writeFileSync(old, readFileSync(old, 'utf8') + 'APPLE_SIWA_BUNDLE_ID=vn.eno.old\n')
    const r = run_(b, ['restore', ts, '--force'])
    expect(r.status, r.out).toBe(0)
    const now = envOf(b, 'secrets/eno-vn.env')
    expect(now.APPLE_SIWA_BUNDLE_ID).toBeUndefined()
    expect(now.APPLE_SIWA_KEY_ID).toBe(envOf(GOLD, 'secrets/eno-vn.env').APPLE_SIWA_KEY_ID)
    expect(read(b, 'secrets/eno-vn.env')).not.toContain('vn.eno.old')
    expectNoLeak(b, r.out)
  })

  it('keep-apple: the backup without its six Apple keys, plus the running file’s six verbatim — an empty one too', () => {
    const d = mkdtempSync(join(tmpdir(), 'siwa-keep-'))
    const cur = join(d, 'cur.env'), bak = join(d, 'bak.env')
    writeFileSync(cur, 'A_KEY=new\nAPPLE_SIWA_KEY_ID=NEWKEY0001\nAPPLE_SIWA_BUNDLE_ID=\nAPPLE_TOKEN_ENC_KEY=k-new\n')
    writeFileSync(bak, 'A_KEY=old\nAPPLE_SIWA_KEY_ID=OLDKEY0001\nAPPLE_SIWA_SERVICES_ID=vn.eno.old\nB_KEY=2')
    const r = helper(['keep-apple', cur, bak], '')
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('A_KEY=old\nB_KEY=2\nAPPLE_SIWA_KEY_ID=NEWKEY0001\nAPPLE_SIWA_BUNDLE_ID=\nAPPLE_TOKEN_ENC_KEY=k-new\n')
    expect(helper(['keep-apple', join(d, 'missing.env'), bak], '').status).not.toBe(0) // unreadable: stop, write nothing
  })

  it('restore lists the backups without a timestamp, and refuses anything that is not one', () => {
    const b = cloneBox(GOLD)
    const list = run_(b, ['restore'])
    expect(list.status).toBe(2)
    expect(list.out).toContain(`${backups(b)[0]}  command=install result=ok key_id=${KID}`)
    expect(run_(b, ['restore', '../../etc']).status).toBe(3)
    expect(run_(b, ['restore', '20991231T000000Z']).status).toBe(3)
  })

  it('install-timer installs the script copy, the units and the auto-rotate switch', () => {
    const b = makeBox()
    const r = run_(b, ['install-timer', '--auto-rotate'])
    expect(r.status, r.out).toBe(0)
    expect(read(b, 'bin/apply-apple-signin.sh')).toBe(SOURCE)
    expect(statSync(at(b, 'bin/apply-apple-signin.sh')).mode & 0o777).toBe(0o755)
    expect(read(b, 'systemd/eno-apple-siwa-check.service')).toBe(UNIT_SERVICE)
    expect(read(b, 'systemd/eno-apple-siwa-check.timer')).toBe(UNIT_TIMER)
    expect(read(b, 'default/eno-apple-siwa-check')).toMatch(/^APPLE_SIWA_AUTO_ROTATE=1$/m)
    expect(statSync(at(b, 'default/eno-apple-siwa-check')).mode & 0o777).toBe(0o644)
    expect(read(b, 'state/argv.log')).toContain('systemctl enable --now eno-apple-siwa-check.timer')
    const off = run_(b, ['install-timer'])
    expect(off.status).toBe(0)
    expect(read(b, 'default/eno-apple-siwa-check')).toMatch(/^APPLE_SIWA_AUTO_ROTATE=0$/m)
  })

  it('a sandbox run refuses the real docker and curl', () => {
    const b = makeBox()
    const r = run(['check'], { env: { ...b.env, PATH: process.env.PATH ?? '' } })
    expect(r.status).toBe(3)
    expect(r.out).toMatch(/sandbox: docker must be the sandbox's stub/)
  })
})
