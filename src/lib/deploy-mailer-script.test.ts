import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * infra/cloudflare/deploy-mailer.sh, run for real against a FAKE `curl` on PATH.
 *
 * ⛔ WHAT MATTERS: a Workers PUT drops every binding it does not send, so the upload must carry
 * BOTH send_email bindings (each pinned to its own sender), the KV namespace and the budget vars,
 * and keep the secrets; preview URLs must be switched OFF; and neither the API token nor a secret
 * value may ever appear on a command line, where `ps` shows it to every user on the box.
 */

const SCRIPT = join(process.cwd(), 'infra/cloudflare/deploy-mailer.sh')
const TOKEN = 'cf-token-SHOULD-NEVER-BE-IN-ARGV'

const FAKE_CURL = `#!/usr/bin/env node
const fs = require('fs')
const args = process.argv.slice(2)
let method = 'GET', url = '', config = null, stdinBody = null
const forms = {}
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '-X') method = args[++i]
  else if (a === '--config') config = args[++i]
  else if (a === '-F') { const f = args[++i]; const [k, v] = f.split(/=(.*)/s); const p = v.split(';')[0]; forms[k] = p.startsWith('@') ? fs.readFileSync(p.slice(1), 'utf8') : p }
  else if (a === '--data-binary') { const d = args[++i]; stdinBody = d === '@-' ? fs.readFileSync(0, 'utf8') : d }
  else if (/^https:/.test(a)) url = a
}
const configText = config === '-' ? fs.readFileSync(0, 'utf8') : config ? fs.readFileSync(config, 'utf8') : null
fs.appendFileSync(process.env.FAKE_CURL_LOG, JSON.stringify({ argv: args, method, url, forms, stdinBody, configText }) + '\\n')
let out = { success: true, errors: [], messages: [], result: {} }
if (/\\/storage\\/kv\\/namespaces/.test(url)) out.result = [{ id: 'kv-namespace-id-1', title: 'eno-mailer' }]
else if (/\\/secrets$/.test(url) && method === 'GET') out.result = (process.env.FAKE_SECRETS || '').split(',').filter(Boolean).map((name) => ({ name, type: 'secret_text' }))
else if (/\\/workers\\/scripts\\/eno-mailer$/.test(url)) out.result = { id: 'eno-mailer', modified_on: '2026-09-23T00:00:00Z' }
process.stdout.write(JSON.stringify(out))
`

let dir: string
let log: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'deploy-mailer-'))
  log = join(dir, 'curl.log')
  writeFileSync(join(dir, 'curl'), FAKE_CURL)
  chmodSync(join(dir, 'curl'), 0o755)
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function run(args: string[], opts: { input?: string; env?: Record<string, string> } = {}) {
  const r = spawnSync('bash', [SCRIPT, ...args], {
    input: opts.input ?? '',
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      CF_TOKEN: TOKEN,
      CF_TOKEN_FILE: join(dir, 'no-such-file'),
      FAKE_CURL_LOG: log,
      FAKE_SECRETS: 'MAILER_KEY_VN,MAILER_KEY_FORUM',
      ...opts.env,
    },
  })
  const calls = existsSync(log)
    ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as {
      argv: string[]; method: string; url: string; forms: Record<string, string>; stdinBody: string | null; configText: string | null
    })
    : []
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls }
}

describe('deploy-mailer.sh deploy', () => {
  it('uploads EVERY binding, keeps the secrets, and turns previews off', () => {
    const { status, calls, stderr } = run([])
    expect(stderr).toBe('')
    expect(status).toBe(0)
    const put = calls.find((c) => c.method === 'PUT' && /\/workers\/scripts\/eno-mailer$/.test(c.url))!
    const meta = JSON.parse(put.forms.metadata)
    expect(meta.main_module).toBe('worker.js')
    expect(meta.bindings).toEqual([
      { type: 'send_email', name: 'EMAIL_VN', allowed_sender_addresses: ['no-reply@eno.vn'] },
      { type: 'send_email', name: 'EMAIL_FORUM', allowed_sender_addresses: ['no-reply@eno.forum'] },
      { type: 'kv_namespace', name: 'MAILER_KV', namespace_id: 'kv-namespace-id-1' },
      { type: 'plain_text', name: 'DAILY_QUOTA', text: '1000' },
      { type: 'plain_text', name: 'PRIORITY_RESERVE', text: '400' },
      { type: 'plain_text', name: 'SECURITY_RESERVE', text: '25' },
    ])
    expect(meta.keep_bindings).toEqual(['secret_text'])
    expect(put.forms['worker.js']).toContain('export default')

    const sub = calls.find((c) => /\/workers\/scripts\/eno-mailer\/subdomain$/.test(c.url) && c.method === 'POST')!
    expect(JSON.parse(sub.stdinBody!)).toEqual({ enabled: true, previews_enabled: false })
  })

  it('⛔ the token only ever travels in a curl config file, never argv', () => {
    const { calls } = run([])
    expect(calls.length).toBeGreaterThan(2)
    for (const c of calls) {
      expect(c.argv.join(' ')).not.toContain(TOKEN)
      expect(c.configText).toContain(`Authorization: Bearer ${TOKEN}`)
    }
  })

  it('warns loudly when a key secret is missing', () => {
    const { status, stderr } = run([], { env: { FAKE_SECRETS: 'MAILER_KEY_VN' } })
    expect(status).toBe(0)
    expect(stderr).toContain('MISSING SECRETS: MAILER_KEY_FORUM')
    // The Worker authenticates before it looks at its config, so a missing key is a 401, not a
    // 500 that would tell an outsider which edition is configured.
    expect(stderr).toContain('answers 401 until set')
    expect(stderr).not.toContain("500 'config'")
  })

  it('refuses inconsistent budget vars before uploading anything', () => {
    const { status, calls } = run([], { env: { PRIORITY_RESERVE: '10', SECURITY_RESERVE: '50' } })
    expect(status).not.toBe(0)
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('takes an explicit MAILER_KV_ID over the lookup', () => {
    const { calls } = run([], { env: { MAILER_KV_ID: 'explicit-kv' } })
    expect(calls.some((c) => /storage\/kv\/namespaces/.test(c.url))).toBe(false)
    const put = calls.find((c) => c.method === 'PUT')!
    expect(JSON.parse(put.forms.metadata).bindings[2].namespace_id).toBe('explicit-kv')
  })
})

describe('deploy-mailer.sh — the token', () => {
  it('has NO default token file: with neither CF_TOKEN nor CF_TOKEN_FILE it refuses, names step 2, calls nothing', () => {
    const r = run([], { env: { CF_TOKEN: '', CF_TOKEN_FILE: '' } })
    expect(r.status).toBe(1)
    expect(r.calls).toEqual([])
    expect(r.stderr).toMatch(/README\.md step 2/)
    expect(readFileSync(SCRIPT, 'utf8')).not.toMatch(/CF_TOKEN_FILE:-\/opt\/eno/)
  })

  it('reads the token from CF_TOKEN_FILE when CF_TOKEN is not exported', () => {
    const file = join(dir, 'token')
    writeFileSync(file, `${TOKEN}\n`)
    const r = run([], { env: { CF_TOKEN: '', CF_TOKEN_FILE: file } })
    expect(r.status).toBe(0)
    expect(r.calls.length).toBeGreaterThan(0)
    expect(r.calls.every((c) => (c.configText ?? '').includes(TOKEN))).toBe(true)
  })
})

describe('deploy-mailer.sh set-secret', () => {
  const VALUE = 'f'.repeat(64)

  it('sends the value in the request body from stdin — never argv', () => {
    const { status, calls } = run(['set-secret', 'MAILER_KEY_FORUM'], { input: `${VALUE}\n` })
    expect(status).toBe(0)
    expect(calls).toHaveLength(1)
    const c = calls[0]
    expect(c.method).toBe('PUT')
    expect(c.url).toMatch(/\/workers\/scripts\/eno-mailer\/secrets$/)
    expect(JSON.parse(c.stdinBody!)).toEqual({ name: 'MAILER_KEY_FORUM', type: 'secret_text', text: VALUE })
    expect(c.argv.join(' ')).not.toContain(VALUE)
    expect(c.argv.join(' ')).not.toContain(TOKEN)
  })

  it('refuses a short key and an unknown secret name without calling the API', () => {
    expect(run(['set-secret', 'MAILER_KEY_VN'], { input: 'short\n' }).calls).toEqual([])
    const unknown = run(['set-secret', 'CF_TOKEN'], { input: `${VALUE}\n` })
    expect(unknown.status).toBe(2)
    expect(unknown.calls).toEqual([])
  })
})
