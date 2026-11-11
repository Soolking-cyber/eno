#!/usr/bin/env node
// eno-vn — the command-line client for the eno.vn Partner API (https://eno.vn/developers/cli).
// Zero dependencies: Node 18+ (global fetch, FormData, Blob). Every command is one REST call to
// https://eno.vn/api/v1 and prints the JSON answer, so a script or an agent can pipe it on.
import { readFileSync, realpathSync } from 'node:fs'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const VERSION = '1.0.0'

export const USAGE = `eno-vn ${VERSION} — manage your eno.vn shop from the command line.

Usage: eno-vn <command> [arguments] [--flags]

Needs no key:
  status                              Service status, API version, discovery links
  openapi                             The OpenAPI 3.1 description of the API

Needs ENO_API_KEY (dashboard → Developers on eno.vn):
  shop                                Your storefront profile
  shop-update <file.json>             Edit the profile (name, bio, location, avatarUrl, phone)
  listings [--limit N] [--cursor C]   Your listings, every status (add --all to follow every page)
  listing <id>                        One listing
  create <file.json> [--idempotency-key K]
                                      Create a listing. The Idempotency-Key used is printed to stderr:
                                      re-run with --idempotency-key K within 24 h and a lost reply never
                                      creates twice
  update <id> <file.json>             Edit a listing (only the fields you send change)
  set-status <id> <active|sold|hidden>
  delete <id>                         Remove a listing
  bulk <file.json> [--idempotency-key K]
                                      Create up to 200 listings: {"listings":[…]} (same retry rule)
  sync <file.json> [--full]           Upsert your catalogue by externalId; --full hides what is missing
  upload <image>                      Upload a JPEG/PNG/WebP; prints the URL to use in images[]
  analytics                           Shop totals
  analytics-listings [--from D] [--to D] [--limit N] [--cursor C]
  webhooks                            Your webhook endpoints
  webhook-add <url> [event …]         Register one (default: every event); prints the secret ONCE.
                                      If the reply is lost: \`webhooks\`, delete the new one, add it again
  webhook-delete <id>
  token [--scope "a b"]               Exchange the key for a one-hour OAuth access token

Environment:
  ENO_API_KEY    your eno_live_… key (or an access token). There is no test key: every key is live.
  ENO_BASE_URL   default https://eno.vn

Every answer is JSON on stdout (an API refusal too). Exit codes: 0 success, 1 the API refused, 2 usage error,
3 no confirmed answer (network, timeout, redirect, unexpected reply): a write may have happened — check first.
Docs: https://eno.vn/developers · MCP server: https://eno.vn/developers/mcp`

export class UsageError extends Error {}

/**
 * ⛔ EVERY COMMAND DECLARES ITS ARGUMENTS AND FLAGS, AND ANYTHING ELSE IS A USAGE ERROR BEFORE ANY REQUEST (2026-11-11).
 * These commands change a live shop, so a typo must never pass for intent: `--ful` silently meant a normal sync,
 * `--all=true` one page reported as complete, `--scope` with no value an unscoped token, `--idempotency-key=` no retry
 * protection. A loose parser grew a new hole each review round; a declared table closes the class.
 * `args`: required positional names; `rest`: extra positionals allowed (webhook-add's events). Flags are 'value'
 * (a non-empty string, `--f v` or `--f=v`) or 'bool' (bare `--f` only).
 */
export const COMMANDS = {
  status: { args: [] },
  openapi: { args: [] },
  shop: { args: [] },
  'shop-update': { args: ['file'] },
  listings: { args: [], flags: { limit: 'value', cursor: 'value', all: 'bool' } },
  listing: { args: ['id'] },
  create: { args: ['file'], flags: { 'idempotency-key': 'value' } },
  update: { args: ['id', 'file'] },
  'set-status': { args: ['id', 'status'] },
  delete: { args: ['id'] },
  bulk: { args: ['file'], flags: { 'idempotency-key': 'value' } },
  sync: { args: ['file'], flags: { full: 'bool' } },
  upload: { args: ['file'] },
  analytics: { args: [] },
  'analytics-listings': { args: [], flags: { from: 'value', to: 'value', limit: 'value', cursor: 'value', all: 'bool' } },
  webhooks: { args: [] },
  'webhook-add': { args: ['url'], rest: true },
  'webhook-delete': { args: ['id'] },
  token: { args: [], flags: { scope: 'value' } },
}

/** Split argv into positionals and flags, checked against the command's declaration (COMMANDS). */
export function parseArgs(argv) {
  // ⛔ The command is argv[0], always: found anywhere else, a flag's value could be checked as one command and another
  // run (`--idempotency-key create delete ID`).
  const cmd = argv[0]
  if (cmd !== undefined && cmd.startsWith('-')) throw new UsageError(`the command comes first (got "${cmd}")`)
  // Own properties only: `toString` or `constructor` must never resolve to something inherited.
  const spec = cmd !== undefined && Object.hasOwn(COMMANDS, cmd) ? COMMANDS[cmd] : undefined
  if (!spec) throw new UsageError(cmd === undefined ? '' : `unknown command "${cmd}"`)
  const allowed = spec.flags ?? {}
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (i === 0) { positional.push(a); continue }
    if (!a.startsWith('--')) { positional.push(a); continue }
    const eq = a.indexOf('=')
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2)
    const kind = Object.hasOwn(allowed, name) ? allowed[name] : undefined
    if (!kind) throw new UsageError(`${cmd} takes no --${name}${Object.keys(allowed).length ? ` (it takes ${Object.keys(allowed).map((f) => `--${f}`).join(', ')})` : ''}`)
    if (name in flags) throw new UsageError(`--${name} given twice`)
    if (kind === 'bool') {
      if (eq > 0) throw new UsageError(`--${name} takes no value`)
      flags[name] = true
      continue
    }
    const value = eq > 0 ? a.slice(eq + 1) : argv[++i]
    if (value === undefined || value === '' || (eq < 0 && value.startsWith('--'))) throw new UsageError(`--${name} needs a value`)
    flags[name] = value
  }
  const args = positional.slice(1)
  if (args.length < spec.args.length) throw new UsageError(`${cmd} needs ${spec.args.map((n) => `<${n}>`).join(' ')}`)
  if (args.length > spec.args.length && !spec.rest) throw new UsageError(`${cmd} takes ${spec.args.length ? spec.args.map((n) => `<${n}>`).join(' ') : 'no arguments'}, not "${args.slice(spec.args.length).join(' ')}"`)
  return { positional, flags }
}

function need(value, what) {
  if (value === undefined || value === '') throw new UsageError(`missing ${what}`)
  return value
}

/** An id is one path segment: never empty, `.` or `..` (encodeURIComponent leaves those as path syntax). */
function seg(value, what) {
  const v = need(value, what)
  if (v === '.' || v === '..') throw new UsageError(`"${v}" is not ${what}`)
  return encodeURIComponent(v)
}

function readJson(path) {
  let text
  try { text = readFileSync(need(path, 'a JSON file'), 'utf8') } catch (e) {
    if (e instanceof UsageError) throw e
    throw new UsageError(`cannot read ${path}: ${e.message}`)
  }
  let value
  try { value = JSON.parse(text) } catch (e) { throw new UsageError(`${path} is not valid JSON: ${e.message}`) }
  // Every body the API takes is a JSON object; an array or a bare value would be sent and refused, or (sync --full)
  // lose the mode silently.
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new UsageError(`${path} must contain a JSON object`)
  return value
}

function query(flags, names) {
  const q = new URLSearchParams()
  for (const n of names) if (typeof flags[n] === 'string') q.set(n, flags[n])
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** The caller's --idempotency-key (a retry of a create whose reply was lost), else a fresh one. */
function idemKey(flags) {
  return typeof flags['idempotency-key'] === 'string' ? flags['idempotency-key'] : randomUUID()
}

/** With --all, a list command carries how to ask for the page after `cursor` (the same filters, the new cursor). */
function paged(req, path, flags, keep) {
  if (flags.all !== true) return req
  // --all means the WHOLE list: starting from a cursor would end in next_cursor: null with everything before it missing.
  if (typeof flags.cursor === 'string') throw new UsageError('--all reads the whole list; it cannot start from --cursor')
  return { ...req, paged: 'listings', pageAfter: (cursor) => `${path}${query({ ...pick(flags, keep), cursor }, [...keep, 'cursor'])}` }
}
function pick(o, keys) { return Object.fromEntries(keys.filter((k) => typeof o[k] === 'string').map((k) => [k, o[k]])) }

const MAX_PAGES = 10_000
/** Per request. A bulk import re-hosts up to 200 rows of photos, hence generous. */
const TIMEOUT_MS = 120_000

const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

/**
 * Turn one command line into the request it makes. Pure: no network, no environment — which is what the tests pin.
 * `paged` marks a list command `--all` may follow through `next_cursor`.
 */
export function buildRequest(argv) {
  const { positional, flags } = parseArgs(argv)
  const [cmd, a, b, ...rest] = positional
  const json = (method, path, body, extra = {}) => ({ method, path, body: body === undefined ? undefined : JSON.stringify(body), auth: true, ...extra })
  switch (cmd) {
    case 'status': return { method: 'GET', path: '/api/v1/status', auth: false }
    case 'openapi': return { method: 'GET', path: '/openapi.json', auth: false }
    case 'shop': return json('GET', '/api/v1/shop')
    case 'shop-update': return json('PATCH', '/api/v1/shop', readJson(a))
    case 'listings': return paged(json('GET', `/api/v1/listings${query(flags, ['limit', 'cursor'])}`), '/api/v1/listings', flags, ['limit'])
    case 'listing': return json('GET', `/api/v1/listings/${seg(a, 'a listing id')}`)
    case 'create': return json('POST', '/api/v1/listings', readJson(a), { idempotencyKey: idemKey(flags) })
    case 'update': return json('PATCH', `/api/v1/listings/${seg(a, 'a listing id')}`, readJson(b))
    case 'set-status': {
      const status = need(b, 'a status (active, sold or hidden)')
      if (!['active', 'sold', 'hidden'].includes(status)) throw new UsageError(`status must be active, sold or hidden, not "${status}"`)
      return json('POST', `/api/v1/listings/${seg(a, 'a listing id')}/status`, { status })
    }
    case 'delete': return json('DELETE', `/api/v1/listings/${seg(a, 'a listing id')}`)
    case 'bulk': return json('POST', '/api/v1/listings/bulk', readJson(a), { idempotencyKey: idemKey(flags) })
    case 'sync': {
      const body = readJson(a)
      // ⛔ Only --full can make a sync full (it hides every active listing missing from the file): a `mode` inside the
      // file would do it silently.
      if (Object.hasOwn(body, 'mode')) throw new UsageError(`${a} sets "mode"; leave it out and pass --full for a full sync`)
      if (flags.full === true) body.mode = 'full'
      return json('POST', '/api/v1/listings/sync', body)
    }
    case 'upload': {
      const file = need(a, 'an image file')
      const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
      const type = IMAGE_TYPES[ext]
      if (!type) throw new UsageError('upload takes a .jpg, .jpeg, .png or .webp file')
      return { method: 'POST', path: '/api/v1/media', auth: true, upload: { file, type } }
    }
    case 'analytics': return json('GET', '/api/v1/analytics/summary')
    case 'analytics-listings': return paged(json('GET', `/api/v1/analytics/listings${query(flags, ['from', 'to', 'limit', 'cursor'])}`), '/api/v1/analytics/listings', flags, ['from', 'to', 'limit'])
    case 'webhooks': return json('GET', '/api/v1/webhooks')
    case 'webhook-add': return json('POST', '/api/v1/webhooks', { url: need(a, 'a webhook URL'), events: b === undefined ? '*' : [b, ...rest] })
    case 'webhook-delete': return json('DELETE', `/api/v1/webhooks/${seg(a, 'a webhook id')}`)
    case 'token': return { method: 'POST', path: '/api/v1/oauth/token', auth: false, token: true, scope: typeof flags.scope === 'string' ? flags.scope : undefined }
    default: throw new UsageError(`unknown command "${cmd}"`) // unreachable: parseArgs knows every command
  }
}

/**
 * Send it. Returns { ok, status, body } — never throws for an API refusal, only for a network failure.
 * `env` and `fetchImpl` are injected so the tests run offline.
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: (url: string, init: any) => Promise<{ ok: boolean, status: number, text: () => Promise<string>, headers?: { get: (n: string) => string | null } }>, log?: (m: string) => void }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, body: any }>}
 */
export async function run(argv, { env = process.env, fetchImpl = fetch, log = (m) => console.error(m) } = {}) {
  const req = buildRequest(argv)
  const raw = env.ENO_BASE_URL || 'https://eno.vn'
  // ⛔ HTTPS only (localhost aside): the key rides every request, and `token` puts it in the body. And an ORIGIN only:
  // a path, query or fragment would swallow the API path appended after it (`https://eno.vn?x=1` + `/api/v1/…`).
  let baseUrl
  try { baseUrl = new URL(raw) } catch { throw new UsageError(`ENO_BASE_URL is not a URL: ${raw}`) }
  if (baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash || baseUrl.username || baseUrl.password) {
    throw new UsageError(`ENO_BASE_URL must be a bare origin like https://eno.vn (got ${raw})`)
  }
  const base = baseUrl.origin
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname)
  if (baseUrl.protocol !== 'https:' && !(local && baseUrl.protocol === 'http:')) throw new UsageError(`ENO_BASE_URL must be https:// (got ${raw})`)
  const key = env.ENO_API_KEY || ''
  if ((req.auth || req.token) && !key) throw new UsageError('set ENO_API_KEY to your eno_live_… key (dashboard → Developers on eno.vn)')
  // Header values must be printable ASCII, or fetch throws BEFORE sending — which must read as a usage error (2), never
  // as "the change may already have been made" (3). The docs' `eno_live_…` placeholder is the likely culprit.
  const printable = /^[\x21-\x7e]+$/
  if ((req.auth || req.token) && !printable.test(key)) throw new UsageError('ENO_API_KEY has a character a key cannot contain (did you paste the … placeholder?)')
  if (typeof req.idempotencyKey === 'string' && !printable.test(req.idempotencyKey)) throw new UsageError('--idempotency-key must be printable ASCII with no spaces')
  // The token exchange takes the KEY as client_secret; never post an access token (or anything else) there.
  if (req.token && !/^eno_(live|test)_[A-Za-z0-9]+$/.test(key)) throw new UsageError('token needs ENO_API_KEY to be an eno_live_… key, not an access token')
  const headers = { 'User-Agent': `eno-vn-cli/${VERSION}`, Accept: 'application/json' }
  let body = req.body
  if (req.auth) headers.Authorization = `Bearer ${key}`
  if (req.body !== undefined) headers['Content-Type'] = 'application/json'
  if (req.idempotencyKey) {
    headers['Idempotency-Key'] = req.idempotencyKey
    // On stderr, so stdout stays pure JSON: the key to re-run with if the reply never arrives.
    log(`eno-vn: Idempotency-Key ${req.idempotencyKey} (if the reply is lost, re-run with --idempotency-key ${req.idempotencyKey}; it protects only within 24 h of its first use, and retries do not extend that)`)
  }
  if (req.token) {
    // client_id = the key's 16-character prefix, client_secret = the key (RFC 6749 §4.4, as /developers documents).
    const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: key.slice(0, 16), client_secret: key })
    if (req.scope) form.set('scope', req.scope)
    body = form.toString()
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
  }
  if (req.upload) {
    let bytes
    try { bytes = readFileSync(req.upload.file) } catch (e) { throw new UsageError(`cannot read ${req.upload.file}: ${e.message}`) }
    const fd = new FormData()
    fd.append('file', new Blob([bytes], { type: req.upload.type }), basename(req.upload.file))
    body = fd
  }
  const call = async (path) => {
    // ⛔ redirect: 'manual'. Followed, a 301/302 turns a POST into a GET that "succeeds" having changed nothing, and a
    // cross-origin hop drops the Authorization header (an apex that 308s to www). Say where to point instead.
    // Every failure after a write was SENT says the write may have happened, with the retry key — one rule, one helper.
    const maybe = req.method !== 'GET' ? ` The change may already have been made: check before repeating it${req.idempotencyKey ? `, or re-run with --idempotency-key ${req.idempotencyKey} — that protects only within 24 h of the key's FIRST use; retries do not extend it` : ''}.` : ''
    const unexpected = (status, what) => ({ ok: false, unconfirmed: true, status, body: { error: { code: 'unexpected_response', message: `${what}.${maybe}` } } })
    // ⛔ ONE error boundary around the request AND the body read: fetch resolves on the headers, so a body that stalls or
    // a connection that drops after the server committed a write fails in res.text(), not in fetch. Either way a write
    // may already have happened, and the answer says so (with the retry key), as JSON like every other answer.
    let res
    let text
    try {
      res = await fetchImpl(`${base}${path}`, { method: req.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
      text = res.status >= 300 && res.status < 400 ? '' : await res.text()
    } catch (e) {
      const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError'
      const why = timedOut ? `no complete answer from ${base}${path} within ${TIMEOUT_MS / 1000} s` : `the connection to ${base}${path} failed (${e?.message || e})`
      return { ok: false, unconfirmed: true, status: 0, body: { error: { code: timedOut ? 'timeout' : 'network_error', message: `${why}.${maybe}` } } }
    }
    if (res.status >= 300 && res.status < 400) {
      const to = res.headers?.get('location') || '(no Location)'
      // The redirect is not followed, but a server may have committed a write before answering with one.
      return { ok: false, unconfirmed: true, status: res.status, body: { error: { code: 'redirected', message: `${base}${path} redirected to ${to}; this client never follows redirects. If that address is the API's real origin, set ENO_BASE_URL to it.${maybe}` } } }
    }
    // ⛔ A refusal is only "the API refused" (exit 1) when the API said so: a 4xx carrying its X-Request-Id. A 5xx, or any
    // refusal without that header (a gateway's 502), confirms nothing — after a write it may already have happened.
    if (!res.ok && (res.status >= 500 || (path.startsWith('/api/v1/') && !path.startsWith('/api/v1/oauth/token') && !res.headers?.get('x-request-id')))) {
      return unexpected(res.status, `${base}${path} answered ${res.status} (${text.slice(0, 120).replace(/\s+/g, ' ')})`)
    }
    // ⛔ A success must come from the API: every /api/v1 response but the token endpoint's carries X-Request-Id
    // (src/lib/api/respond.ts). JSON from anything else — a proxy, a captive portal — never confirms a change.
    if (res.ok && path.startsWith('/api/v1/') && !path.startsWith('/api/v1/oauth/token') && !res.headers?.get('x-request-id')) {
      return unexpected(res.status, `${base}${path} answered ${res.status} without the API's X-Request-Id header, so nothing confirms it came from the API`)
    }
    // An empty body is a success only as a 204: an empty 200 from a proxy confirms nothing.
    if (!text) return res.status === 204 ? { ok: true, status: 204, body: null } : unexpected(res.status, `${base}${path} answered ${res.status} with an empty body`)
    try {
      const parsed = JSON.parse(text)
      // ⛔ THE API'S TWO SHAPES, AND NOTHING ELSE COUNTS (one rule, not a case per review round): a success is a JSON
      // object with no `error` member, from a response carrying the API's X-Request-Id (checked above); a refusal is
      // `{"error":{"code":"…"}}`. `null`, `true`, an array, an error envelope on a 2xx, or a 4xx without the envelope is
      // unconfirmed (exit 3). ⚠️ Known limit, accepted: an intermediary that forged our X-Request-Id AND answered a bare
      // object would pass; per-command success shapes would close that, at the cost of tracking every endpoint here.
      const isObject = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      if (res.ok && (!isObject || Object.hasOwn(parsed, 'error'))) return unexpected(res.status, `${base}${path} answered ${res.status} with a body that is not an API success`)
      // The token endpoint speaks OAuth (RFC 6749 §5.2): its refusal is `{"error":"invalid_client", …}`, a string.
      const refusal = isObject && (typeof parsed.error?.code === 'string' || (req.token && typeof parsed.error === 'string'))
      if (!res.ok && !refusal) return unexpected(res.status, `${base}${path} answered ${res.status} without the API's error envelope`)
      return { ok: res.ok, status: res.status, body: parsed }
    } catch {
      // ⛔ Not JSON — a proxy, a challenge or an HTML error page — is never a success, whatever the status says: the API
      // answers JSON, so nothing here confirms the command did anything.
      return unexpected(res.status, `${base}${path} answered ${res.status} with something that is not JSON (${text.slice(0, 80).replace(/\s+/g, ' ')}…)`)
    }
  }
  let out = await call(req.path)
  // ⛔ The token endpoint is exempt from the X-Request-Id check (it builds its own headers), so check the token itself.
  if (req.token && out.ok && (typeof out.body?.access_token !== 'string' || out.body.access_token === '')) {
    return { ok: false, unconfirmed: true, status: out.status, body: { error: { code: 'unexpected_response', message: 'the token endpoint answered without an access_token' } } }
  }
  if (req.paged && out.ok) {
    // --all: follow next_cursor until it is null, concatenating the pages into one list.
    // ⛔ Each page must BE a page — the list array and a next_cursor that is a string or null — or the run is an error:
    // an HTML 200 or a renamed field must never read as "complete and empty".
    const isPage = (b) => b !== null && typeof b === 'object' && Array.isArray(b[req.paged]) && (b.next_cursor === null || (typeof b.next_cursor === 'string' && b.next_cursor !== ''))
    const notPage = (n) => ({ ok: false, unconfirmed: true, status: 0, body: { error: { code: 'unexpected_response', message: `page ${n} of ${req.path} is not a {${req.paged}: [...], next_cursor} page; stopped rather than report a partial list as whole.` } } })
    if (!isPage(out.body)) return notPage(1)
    const items = [...out.body[req.paged]]
    let cursor = out.body.next_cursor
    const seen = new Set()
    for (let pages = 1; cursor; pages++) {
      // ⛔ Never report a partial list as whole: a repeated cursor or the page cap is an error, not a silent stop.
      if (seen.has(cursor) || pages >= MAX_PAGES) {
        return { ok: false, unconfirmed: true, status: 0, body: { error: { code: 'incomplete', message: `stopped after ${pages} pages (${seen.has(cursor) ? 'the API repeated a cursor' : `the ${MAX_PAGES}-page cap`}); ${items.length} items read so far. Page by hand with --cursor ${cursor}.` } } }
      }
      seen.add(cursor)
      const page = await call(req.pageAfter(cursor))
      if (!page.ok) return page
      if (!isPage(page.body)) return notPage(pages + 1)
      items.push(...page.body[req.paged])
      cursor = page.body.next_cursor
    }
    out = { ok: true, status: 200, body: { ...out.body, [req.paged]: items, next_cursor: null } }
  }
  return out
}

export async function main(argv = process.argv.slice(2)) {
  // Only on their own: `token --scope --help` is a usage error, never a silent exit 0.
  if (argv.length === 1 && (argv[0] === '--version' || argv[0] === 'version')) { console.log(VERSION); return 0 }
  if (argv.length === 0 || (argv.length === 1 && (argv[0] === '--help' || argv[0] === 'help'))) { console.log(USAGE); return 0 }
  try {
    const res = await run(argv)
    // The API's JSON answer goes to stdout either way, so a pipeline always gets JSON; the exit code says which it was:
    // 1 only when the API itself refused, 3 when nothing confirms what happened (a script must not read that as "refused").
    console.log(JSON.stringify(res.body, null, 2))
    if (res.ok) return 0
    return res.unconfirmed ? 3 : 1
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`eno-vn: ${e.message}\n\n${USAGE}`)
      return 2
    }
    // Not a usage error and not an API answer: nothing confirms what happened (3, never 1 "the API refused").
    console.log(JSON.stringify({ error: { code: 'client_error', message: String(e?.message || e) } }, null, 2))
    return 3
  }
}

// Run only as a program (npx, a global install's symlink, or `node eno-vn.mjs`), never on import by the tests.
if (process.argv[1]) {
  let self = false
  try { self = realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { self = false }
  if (self) main().then((code) => { process.exitCode = code })
}
