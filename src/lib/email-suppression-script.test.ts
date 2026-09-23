import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * scripts/email-suppression.mjs — the admin's way to find and lift a Cloudflare Email Sending
 * suppression for a user who proved they control the address. Pinned: it only ever touches the
 * ONE address asked about, it is a dry run unless told `--yes`, a read-only entry is reported for
 * Cloudflare Support rather than attempted, and the token never leaves a request header.
 */

import { main, listSuppressions, readToken, removeSuppressions, REVOKE_REMINDER, SuppressionError } from '../../scripts/email-suppression.mjs'

/** The token as the operator would paste it at the hidden prompt. */
const pasted = async () => 'tok'

type Call = { url: string; method: string; auth: string | null }

function fakeCloudflare(entries: Array<Record<string, unknown>>, opts: { pages?: boolean; failDelete?: boolean } = {}) {
  const calls: Call[] = []
  const fetchImpl = async (url: string, init: { method?: string; headers?: Record<string, string> } = {}) => {
    const method = init.method || 'GET'
    calls.push({ url, method, auth: init.headers?.authorization ?? null })
    const u = new URL(url)
    if (method === 'DELETE') {
      if (opts.failDelete) return new Response(JSON.stringify({ success: false, errors: [{ message: 'This suppression is read-only.' }] }), { status: 403 })
      return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: { id: u.pathname.split('/').pop() } }))
    }
    const email = u.searchParams.get('email')
    const rows = email ? entries.filter((e) => e.email === email) : entries
    if (opts.pages && !u.searchParams.get('cursor')) {
      return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: rows.slice(0, 1), result_info: { count: 1, per_page: 1000, next_cursor: 'c2' } }))
    }
    const rest = opts.pages ? rows.slice(1) : rows
    return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: rest, result_info: { count: rest.length, per_page: 1000, next_cursor: null } }))
  }
  return { calls, fetchImpl }
}

const entry = (over: Record<string, unknown>) => ({
  id: '396a5436-d4b0-42a6-b3fc-48e8fa522321', email: 'victim@gmail.com', reason: 'complaint',
  created_at: '2026-09-20T02:20:00Z', expires_at: null, read_only: false, ...over,
})

describe('scripts/email-suppression.mjs', () => {
  it('lists one address with an exact filter and a bearer header', async () => {
    const cf = fakeCloudflare([entry({})])
    const rows = await listSuppressions({ token: 'tok', email: 'victim@gmail.com', fetchImpl: cf.fetchImpl as never })
    expect(rows).toHaveLength(1)
    expect(cf.calls[0].url).toContain('/accounts/c91cf27edd31b01aba677ac9e007d569/email/sending/suppressions?')
    expect(new URL(cf.calls[0].url).searchParams.get('email')).toBe('victim@gmail.com')
    expect(cf.calls[0].auth).toBe('Bearer tok')
  })

  it('follows the cursor to the end', async () => {
    const cf = fakeCloudflare([entry({ id: 'a' }), entry({ id: 'b', email: 'other@gmail.com' })], { pages: true })
    const rows = await listSuppressions({ token: 'tok', email: null, fetchImpl: cf.fetchImpl as never })
    expect(rows.map((r: { id: string }) => r.id)).toEqual(['a', 'b'])
    expect(new URL(cf.calls[1].url).searchParams.get('cursor')).toBe('c2')
  })

  it('remove is a DRY RUN without --yes: nothing is deleted', async () => {
    const cf = fakeCloudflare([entry({})])
    const out: string[] = []
    const code = await main(['remove', 'victim@gmail.com'], {}, (l: string) => out.push(l), cf.fetchImpl as never, pasted)
    expect(code).toBe(0)
    expect(cf.calls.filter((c) => c.method === 'DELETE')).toEqual([])
    expect(out.join('\n')).toContain('DRY RUN')
    expect(out.join('\n')).toContain('proved they control this address')
  })

  it('remove --yes deletes only the mutable entry for THAT address', async () => {
    const cf = fakeCloudflare([
      entry({ id: 'mine-1' }),
      entry({ id: 'someone-else', email: 'other@gmail.com' }),
    ])
    const out: string[] = []
    const code = await main(['remove', 'victim@gmail.com', '--yes'], {}, (l: string) => out.push(l), cf.fetchImpl as never, pasted)
    expect(code).toBe(0)
    const deletes = cf.calls.filter((c) => c.method === 'DELETE')
    expect(deletes).toHaveLength(1)
    expect(deletes[0].url).toMatch(/\/email\/sending\/suppressions\/mine-1$/)
    expect(out.join('\n')).toContain('lifted mine-1')
  })

  it('re-checks the address even if the API ignored the filter', async () => {
    // A fake that returns EVERY row whatever the filter says — the script must still only lift ours.
    const rows = [entry({ id: 'mine-1' }), entry({ id: 'not-mine', email: 'other@gmail.com' })]
    const calls: Call[] = []
    const fetchImpl = async (url: string, init: { method?: string } = {}) => {
      calls.push({ url, method: init.method || 'GET', auth: null })
      if (init.method === 'DELETE') return new Response(JSON.stringify({ success: true, result: {} }))
      return new Response(JSON.stringify({ success: true, result: rows, result_info: { next_cursor: null } }))
    }
    const r = await removeSuppressions({ token: 'tok', email: 'victim@gmail.com', confirm: true, fetchImpl: fetchImpl as never })
    expect(r.removed.map((e: { id: string }) => e.id)).toEqual(['mine-1'])
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url.split('/').pop())).toEqual(['mine-1'])
  })

  it('a READ-ONLY entry is never attempted: it points at Cloudflare Support and exits non-zero', async () => {
    const cf = fakeCloudflare([entry({ id: 'policy-1', reason: 'policy', read_only: true })])
    const out: string[] = []
    const code = await main(['remove', 'victim@gmail.com', '--yes'], {}, (l: string) => out.push(l), cf.fetchImpl as never, pasted)
    expect(code).toBe(1)
    expect(cf.calls.filter((c) => c.method === 'DELETE')).toEqual([])
    expect(out.join('\n')).toMatch(/only Cloudflare Support can lift/)
  })

  it('refuses without a token, without an address, and on a non-address', async () => {
    const log = () => {}
    const none = async () => { throw new SuppressionError('no API token given') }
    expect(await main(['list', 'victim@gmail.com'], {}, log, fetch, none)).toBe(2)
    expect(await main(['remove'], {}, log, fetch, pasted)).toBe(2)
    expect(await main(['remove', '--yes'], {}, log, fetch, pasted)).toBe(2)
    const cf = fakeCloudflare([])
    expect(await main(['remove', 'not-an-address', '--yes'], {}, log, cf.fetchImpl as never, pasted)).toBe(1)
    expect(cf.calls).toEqual([])
  })

  it('reminds the operator to REVOKE the token on every run that used one', async () => {
    const cf = fakeCloudflare([entry({})])
    const out: string[] = []
    await main(['list', 'victim@gmail.com'], {}, (l: string) => out.push(l), cf.fetchImpl as never, pasted)
    expect(out.at(-1)).toBe(REVOKE_REMINDER)
    expect(REVOKE_REMINDER).toMatch(/Revoke/)
  })

  it('reports an API failure as a failure', async () => {
    const cf = fakeCloudflare([entry({})], { failDelete: true })
    const out: string[] = []
    const code = await main(['remove', 'victim@gmail.com', '--yes'], {}, (l: string) => out.push(l), cf.fetchImpl as never, pasted)
    expect(code).toBe(1)
    expect(out.join('\n')).toContain('read-only')
  })
})

// ── The token: short-lived, laptop-only, and never on a command line ──────────────────────────
// The suppressions API needs Account · Email Sending: Edit, which can also SEND as eno.vn and
// eno.forum outside the Worker. The dashboard is the primary unblock path; when this script is used,
// its token must never land in shell history — so an env assignment is refused outright.
describe('scripts/email-suppression.mjs — where the token may come from', () => {
  const withDir = <T>(fn: (dir: string) => Promise<T>) => async () => {
    const dir = mkdtempSync(join(tmpdir(), 'supp-token-'))
    try { return await fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
  }

  it('⛔ refuses CF_EMAIL_TOKEN in the environment (an inline assignment lands in shell history)', async () => {
    await expect(readToken({ CF_EMAIL_TOKEN: 'tok' }, { isTTY: true, promptHidden: async () => 'other' })).rejects.toThrow(/CF_EMAIL_TOKEN is set — refusing/)
    const out: string[] = []
    const cf = fakeCloudflare([entry({})])
    expect(await main(['list', 'victim@gmail.com'], { CF_EMAIL_TOKEN: 'tok' }, (l: string) => out.push(l), cf.fetchImpl as never)).toBe(2)
    expect(cf.calls).toEqual([])
  })

  it('reads a mode-0600 CF_EMAIL_TOKEN_FILE, and refuses one other users can read', withDir(async (dir) => {
    const file = join(dir, 'token')
    writeFileSync(file, 'file-token\n')
    chmodSync(file, 0o600)
    expect(await readToken({ CF_EMAIL_TOKEN_FILE: file })).toBe('file-token')
    chmodSync(file, 0o644)
    await expect(readToken({ CF_EMAIL_TOKEN_FILE: file })).rejects.toThrow(/chmod 600/)
    await expect(readToken({ CF_EMAIL_TOKEN_FILE: join(dir, 'missing') })).rejects.toThrow(/cannot be read/)
  }))

  it('prompts with hidden input on a terminal, and reads a pipe otherwise', async () => {
    let asked = ''
    expect(await readToken({}, { isTTY: true, promptHidden: async (q: string) => { asked = q; return ' pasted-token \n' } })).toBe('pasted-token')
    expect(asked).toMatch(/input hidden/)
    expect(await readToken({}, { isTTY: false, readStdin: async () => 'piped-token\n' })).toBe('piped-token')
    await expect(readToken({}, { isTTY: false, readStdin: async () => '  ' })).rejects.toThrow(/no API token/)
  })
})
