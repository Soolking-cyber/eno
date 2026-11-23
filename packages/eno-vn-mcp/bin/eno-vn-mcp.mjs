#!/usr/bin/env node
// eno-vn-mcp — eno.vn's MCP server, eno Agentic Commerce, for MCP clients that start a local (stdio) server (https://eno.vn/developers/mcp).
// Zero dependencies: Node 18+ (global fetch). A BRIDGE, NOT A SECOND SERVER: each JSON-RPC message the client writes to
// stdin is POSTed to one of eno.vn's hosted MCP servers and the answer written back to stdout, one message per line. So
// the tools, their schemas, limits and rules are exactly the hosted server's, and nothing here can drift from them.
// stdout carries only MCP messages; everything else goes to stderr.
import { createInterface } from 'node:readline'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const VERSION = '2.0.0'

/** The hosted servers. `all` (the default since 2.0.0, owner 2026-11-23: one server) and `shop` are the same endpoint and the
 *  only ones ever sent a key; `all` works without one (search and docs), `shop` insists on it. */
export const SERVERS = {
  all: { path: '/api/mcp', key: 'optional', about: 'eno Agentic Commerce, every tool: search and docs with no key; with ENO_API_KEY, your shop too (listings, catalogue sync, analytics, webhooks, ads).' },
  search: { path: '/api/mcp/search', key: false, about: 'Search live eno.vn listings only. No key.' },
  docs: { path: '/api/mcp/docs', key: false, about: "Search and read eno.vn's documentation for agents. No key." },
  shop: { path: '/api/mcp', key: true, about: 'Manage your eno.vn shop: listings, catalogue sync, analytics, webhooks. Needs ENO_API_KEY.' },
}

export const USAGE = `eno-vn-mcp ${VERSION} — eno.vn's MCP server, eno Agentic Commerce, for MCP clients that start a local server.

Usage: npx -y eno-vn-mcp [--server all|search|docs|shop]

Servers:
  all      ${SERVERS.all.about} The default.
  search   ${SERVERS.search.about}
  docs     ${SERVERS.docs.about}
  shop     ${SERVERS.shop.about}

Environment:
  ENO_API_KEY    your eno_live_… key (dashboard → Developers on eno.vn); sent to /api/mcp only (all, shop)
  ENO_BASE_URL   default https://eno.vn

Client config (Claude Desktop, Cursor, …):
  { "mcpServers": { "eno-vn": { "command": "npx", "args": ["-y", "eno-vn-mcp"] } } }

Docs: https://eno.vn/developers/mcp
`

export class UsageError extends Error {}

/**
 * The server to bridge to, from the arguments and the environment.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ name: string, url: string, key: string | null }}
 */
export function pickServer(argv, env = {}) {
  /** @type {string | null} */
  let name = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--server') name = argv[++i] ?? ''
    else if (a.startsWith('--server=')) name = a.slice('--server='.length)
    else throw new UsageError(`unknown argument: ${a}`)
  }
  const key = env.ENO_API_KEY || ''
  if (name === null) name = 'all'
  const server = Object.prototype.hasOwnProperty.call(SERVERS, name) ? SERVERS[/** @type {keyof typeof SERVERS} */ (name)] : null
  if (!server) throw new UsageError(`--server must be all, search, docs or shop (got ${name || 'nothing'})`)
  const raw = env.ENO_BASE_URL || 'https://eno.vn'
  // ⛔ HTTPS only (localhost aside): the shop server is sent the key. And an ORIGIN only, as the eno-vn CLI requires.
  let base
  try { base = new URL(raw) } catch { throw new UsageError(`ENO_BASE_URL is not a URL: ${raw}`) }
  if (base.pathname !== '/' || base.search || base.hash || base.username || base.password) {
    throw new UsageError(`ENO_BASE_URL must be a bare origin like https://eno.vn (got ${raw})`)
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
  if (base.protocol !== 'https:' && !(local && base.protocol === 'http:')) throw new UsageError(`ENO_BASE_URL must be https:// (got ${raw})`)
  if (server.key === true && !key) throw new UsageError('the shop server needs ENO_API_KEY: your eno_live_… key (dashboard → Developers on eno.vn)')
  const sends = server.key === true || (server.key === 'optional' && !!key)
  // A header value must be printable ASCII, or fetch throws on every message; the docs' `eno_live_…` placeholder is the likely culprit.
  if (sends && !/^[\x21-\x7e]+$/.test(key)) throw new UsageError('ENO_API_KEY has a character a key cannot contain (did you paste the … placeholder?)')
  return { name, url: `${base.origin}${server.path}`, key: sends ? key : null }
}

/** @param {unknown} id @param {number} code @param {string} message */
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } })

/** @param {any} m */
const isObject = (m) => !!m && typeof m === 'object' && !Array.isArray(m)

/** A JSON-RPC 2.0 message: a request, a notification, or a response with a well-formed result or error. @param {any} m */
const isRpc = (m) => isObject(m) && m.jsonrpc === '2.0' &&
  (typeof m.method === 'string' || 'result' in m || (isObject(m.error) && Number.isInteger(m.error.code) && typeof m.error.message === 'string'))

/** The ids of the requests in a message (a method AND an id); a notification or a response expects no answer. @param {any} msg */
function requestIds(msg) {
  return (Array.isArray(msg) ? msg : [msg])
    .filter((m) => isObject(m) && typeof m.method === 'string' && m.id !== undefined && m.id !== null)
    .map((m) => m.id)
}

/**
 * The JSON-RPC messages of a text/event-stream body (each event's data lines, joined). The hosted servers answer plain
 * JSON today; this keeps the bridge working if one ever streams.
 * @param {string} text
 */
export function sseMessages(text) {
  const out = []
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n')
    if (!data) continue
    try { out.push(JSON.parse(data)) } catch { /* not a message */ }
  }
  return out
}

/**
 * @typedef {{ status: number, headers?: { get: (n: string) => string | null }, text: () => Promise<string> }} FetchResponse
 * @typedef {(url: string, init: any) => Promise<FetchResponse>} FetchLike
 */

/**
 * The bridge: `handle(line)` forwards one stdin line and writes every answer through `write`.
 * ⛔ EVERY REQUEST GETS AN ANSWER: a network failure, a non-MCP reply, or an error the server could not tie to a request
 * (id null: a bad key, a rate limit) is answered on that request's own id — a client waits forever for an id it never gets.
 * @param {{ url: string, key: string | null, write: (m: unknown) => void, fetchImpl?: FetchLike, log?: (m: string) => void, timeoutMs?: number }} opts
 */
export function createBridge({ url, key, write, fetchImpl = fetch, log = () => {}, timeoutMs = 60_000 }) {
  /** @type {string | null} */
  let protocolVersion = null
  /** @type {string | null} */
  let sessionId = null
  /** While an initialize is in flight, later messages wait: they must carry the version it agrees. */
  let initializing = Promise.resolve()

  /** @param {any} msg */
  async function forward(msg) {
    const ids = requestIds(msg)
    const initId = isObject(msg) && msg.method === 'initialize' ? msg.id : undefined
    const answered = new Set()
    /** @param {string} message */
    const failRest = (message) => { for (const id of ids) if (!answered.has(id)) write(rpcError(id, -32603, message)) }
    /** @type {Record<string, string>} */
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': `eno-vn-mcp/${VERSION}` }
    if (protocolVersion) headers['mcp-protocol-version'] = protocolVersion
    if (sessionId) headers['mcp-session-id'] = sessionId
    if (key) headers.authorization = `Bearer ${key}`
    let res
    try {
      res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(msg), redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
    } catch (e) {
      const why = /** @type {any} */ (e)?.message || String(e)
      log(`eno-vn-mcp: ${url} could not be reached: ${why}`)
      return failRest(`eno.vn could not be reached (${why}). Try again.`)
    }
    const sid = res.headers?.get('mcp-session-id')
    if (sid) sessionId = sid
    // A session the server no longer knows answers 404 (MCP Streamable HTTP): forget it, so the next initialize starts
    // a fresh one (commit gate, opus). The hosted servers are stateless today and issue none.
    else if (res.status === 404 && sessionId) sessionId = null
    const text = await res.text().catch(() => '')
    if (res.status === 202 || res.status === 204) return failRest(`eno.vn accepted the message but sent no answer (HTTP ${res.status}).`)
    if (res.status >= 300 && res.status < 400) return failRest(`${url} answered a redirect (HTTP ${res.status}); this bridge never follows one.`)
    const type = res.headers?.get('content-type') || ''
    /** @type {any[]} */
    let answers = []
    if (type.includes('text/event-stream')) answers = sseMessages(text)
    else { try { answers = [JSON.parse(text)] } catch { answers = [] } }
    // Only JSON-RPC 2.0 reaches the client: an edge or proxy error body that happens to be JSON is not an MCP message
    // (commit gate, opus), and the request it failed gets the bridge's own error below.
    answers = answers.filter((a) => (Array.isArray(a) ? a.length > 0 && a.every(isRpc) : isRpc(a)))
    // A message with no request in it (a notification) gets NO answer on stdout, ever — JSON-RPC sends a notification
    // nothing back (commit gate, opus: a revoked key's 401 on notifications/initialized came out as an unsolicited error).
    if (!ids.length) {
      for (const a of answers) if (isObject(a) && a.error) log(`eno-vn-mcp: eno.vn refused a notification: ${a.error.message}`)
      return
    }
    for (const a of answers) {
      if (isObject(a) && a.error && (a.id === null || a.id === undefined)) {
        for (const id of ids) if (!answered.has(id)) { answered.add(id); write({ jsonrpc: '2.0', id, error: a.error }) }
        continue
      }
      // Only a RESPONSE (no method) answers a request; a request the server sends the client carries an id too.
      for (const m of Array.isArray(a) ? a : [a]) if (isObject(m) && m.id !== undefined && m.method === undefined) answered.add(m.id)
      if (isObject(a) && initId !== undefined && a.id === initId && typeof a.result?.protocolVersion === 'string') protocolVersion = a.result.protocolVersion
      write(a)
    }
    failRest(answers.length ? 'eno.vn sent no answer for this request.' : `eno.vn answered HTTP ${res.status} with no MCP message.`)
  }

  /** @param {any} msg */
  async function safeForward(msg) {
    try { await forward(msg) } catch (e) {
      log(`eno-vn-mcp: ${/** @type {any} */ (e)?.message || e}`)
      for (const id of requestIds(msg)) write(rpcError(id, -32603, 'eno-vn-mcp failed on this message.'))
    }
  }

  return {
    /** @param {string} line */
    handle(line) {
      if (!line.trim()) return Promise.resolve()
      let msg
      try { msg = JSON.parse(line) } catch {
        write(rpcError(null, -32700, 'Parse error: each line must be one JSON-RPC message'))
        return Promise.resolve()
      }
      if (isObject(msg) && msg.method === 'initialize') {
        const p = safeForward(msg)
        initializing = p
        return p
      }
      return initializing.then(() => safeForward(msg))
    },
    get protocolVersion() { return protocolVersion },
  }
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(USAGE); return 0 }
  if (argv.includes('--version')) { process.stdout.write(`${VERSION}\n`); return 0 }
  let target
  try { target = pickServer(argv, process.env) } catch (e) {
    if (e instanceof UsageError) { console.error(`eno-vn-mcp: ${e.message}\n\n${USAGE}`); return 2 }
    throw e
  }
  console.error(`eno-vn-mcp ${VERSION}: the ${target.name} server at ${target.url}`)
  const bridge = createBridge({
    url: target.url,
    key: target.key,
    write: (m) => { process.stdout.write(`${JSON.stringify(m)}\n`) },
    log: (m) => console.error(m),
  })
  const pending = new Set()
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    const p = bridge.handle(line)
    pending.add(p)
    p.finally(() => pending.delete(p))
  }
  await Promise.allSettled([...pending])
  return 0
}

// Run only as a program (npx, a global install's symlink, or `node eno-vn-mcp.mjs`), never on import by the tests.
if (process.argv[1]) {
  let self = false
  try { self = realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { self = false }
  if (self) main().then((code) => { process.exitCode = code })
}
