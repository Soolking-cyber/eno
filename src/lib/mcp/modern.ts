/**
 * ── MCP 2026-07-28, BESIDE THE HANDSHAKE ERA (owner 2026-11-27: "mcp 2.0 latest developments … yes build") ──────────────
 * The 2026-07-28 revision (spec: specification/2026-07-28, schema.ts) drops the `initialize` handshake and protocol
 * sessions: every request carries its version and the client's capabilities in `params._meta`, mirrored into HTTP headers
 * (`MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`) that the server MUST check against the body. A "dual-era" server
 * (basic/versioning, "A dual-era server selects its behavior from how the client opens") serves a request that carries
 * the modern `_meta` by this revision, and an `initialize` by the negotiated legacy one, on the same endpoint.
 *
 * This module is the modern half's rules, kept apart from route.ts so the legacy path there stays byte-for-byte what
 * Claude, ChatGPT, Grok, Muse and Manufact have been calling (route.ts runs its legacy handler, then `modernize()`).
 * Pure functions: no I/O, no clock.
 */

/** The revision this server speaks per request. */
export const MODERN_VERSION = '2026-07-28'
/** The handshake-era revisions route.ts negotiates in `initialize` (its SUPPORTED set), newest first. */
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const
/** Every version this server speaks, newest first: server/discover's `supportedVersions` and -32022's `supported`. */
export const ALL_VERSIONS = [MODERN_VERSION, ...LEGACY_VERSIONS]

export const META_VERSION = 'io.modelcontextprotocol/protocolVersion'
export const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo'

// schema.ts 2026-07-28, "Errors".
export const HEADER_MISMATCH = -32020
export const UNSUPPORTED_PROTOCOL_VERSION = -32022

/**
 * How long a client may keep a list or a read (CacheableResult.ttlMs). These answers change only with a deploy; a
 * quarter of an hour bounds how long a client keeps a tool list a deploy has replaced.
 */
export const LIST_TTL_MS = 15 * 60_000

/**
 * The MCP Apps extension (stable; extensions/overview): the tools' `_meta.ui.resourceUri` cards (src/lib/mcp/apps.ts). A
 * 2026-07-28 host negotiates it through `capabilities.extensions` (basic/versioning, Extension Negotiation); `{}` = no
 * settings. Only server/discover states it: `initialize`'s capabilities stay as the handshake era has always read them.
 */
export const MODERN_EXTENSIONS = { 'io.modelcontextprotocol/ui': {} }

/** The methods whose result is a CacheableResult in 2026-07-28 (schema.ts: DiscoverResult, List*Result, ReadResourceResult). */
const CACHEABLE = new Set(['server/discover', 'tools/list', 'resources/list', 'resources/templates/list', 'resources/read'])
/** Removed in 2026-07-28 (changelog, SEP-2575): answered "Method not found" (404) to a modern request. `initialize` never
 *  gets here: it always selects the handshake era (eraOf). */
export const REMOVED_IN_MODERN = new Set(['ping', 'logging/setLevel'])

type Msg = { id?: string | number | null; method?: string; params?: Record<string, unknown> }

export type Era =
  | { kind: 'legacy'; metaVersion?: string }
  | { kind: 'modern'; version: string }
  | { kind: 'unsupported'; requested: string }
  | { kind: 'malformed' }

const isNotification = (msg: unknown) => {
  const id = msg && typeof msg === 'object' ? (msg as Msg).id : undefined
  return id === undefined || id === null
}

/** The `_meta` protocol version a request carries: the string, `undefined` when the key is absent, `null` when it is there but not a string. */
function metaVersionField(msg: unknown): string | null | undefined {
  const meta = msg && typeof msg === 'object' ? (msg as Msg).params?._meta : undefined
  if (!meta || typeof meta !== 'object' || Array.isArray(meta) || !(META_VERSION in meta)) return undefined
  const v = (meta as Record<string, unknown>)[META_VERSION]
  return typeof v === 'string' ? v : null
}

/** The version a request names in `params._meta`, or null when it names none (every legacy request). */
export function metaVersion(msg: unknown): string | null {
  const v = metaVersionField(msg)
  return typeof v === 'string' ? v : null
}

/**
 * Which era serves this message (plan review 2026-11-27, opus, folded in):
 *  · A notification → legacy. 2026-07-28 defines no client notification over HTTP and no header rules for one (transport:
 *    "header requirements for notification POSTs are not defined by this revision"); it keeps its 202.
 *  · `initialize` → legacy, whatever it carries: "An initialize request selects legacy semantics" (basic/versioning).
 *  · No `_meta` version → legacy, exactly as before, whatever the header says: legacy clients send `MCP-Protocol-Version`
 *    too (since 2025-06-18), some send a version they did not negotiate, and route.ts is lenient about it on purpose.
 *    (A draft refused a 2026-07-28 header on a body without the `_meta`; the commit gate showed that breaks a client that
 *    negotiated 2025-11-25 but stamps its SDK's newest version on the header, so it was dropped.)
 *  · A `_meta` version of this revision → modern.
 *  · A `_meta` version this server negotiates in `initialize` → legacy, served statelessly by that version (the
 *    compatibility matrix, Modern → Dual-era: the client "retries with a mutually supported version"; -32022 here would
 *    list the very version it asked for, and loop). Its header must still match it (`legacyMetaMismatch`).
 *  · A `_meta` version key that is not a string → malformed (400 -32020): nothing to compare the header with.
 *  · Anything else → unsupported (-32022 with the list, so the client can retry: basic/versioning, Negotiation).
 */
export function eraOf(msg: unknown): Era {
  if (isNotification(msg)) return { kind: 'legacy' }
  if (msg && typeof msg === 'object' && (msg as Msg).method === 'initialize') return { kind: 'legacy' }
  const v = metaVersionField(msg)
  if (v === undefined) return { kind: 'legacy' }
  if (v === null) return { kind: 'malformed' }
  if (v === MODERN_VERSION) return { kind: 'modern', version: v }
  if ((LEGACY_VERSIONS as readonly string[]).includes(v)) return { kind: 'legacy', metaVersion: v }
  return { kind: 'unsupported', requested: v }
}

/**
 * A handshake version named in `_meta`: the header MUST still equal it (transport: "The header value MUST match the
 * io.modelcontextprotocol/protocolVersion field"). Absent is allowed: versions before 2025-06-18 never sent the header.
 */
export function legacyMetaMismatch(headers: Headers, version: string): string | null {
  const pv = headers.get('mcp-protocol-version')
  return pv !== null && pv.trim() !== version ? `Header mismatch: MCP-Protocol-Version header value '${clip(pv)}' does not match body value '${version}'` : null
}

/** RFC 9110 field-value characters: visible ASCII, space and tab. */
const HEADER_SAFE = /^[\x20-\x7e\t]*$/

/**
 * A header value as the client meant it: `=?base64?…?=` (case-sensitive markers, UTF-8 inside) decoded, anything else as
 * sent. Null when the value is malformed: bad Base64, or characters a header may not carry (transport: Value Encoding).
 */
export function decodeHeaderValue(raw: string): string | null {
  if (!HEADER_SAFE.test(raw)) return null
  const m = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/.exec(raw)
  if (!m) return raw
  if (m[1].length % 4 !== 0) return null
  try {
    const bytes = Buffer.from(m[1], 'base64')
    // Strict: Node's decoder ignores what it cannot read, so only a CANONICAL encoding passes (it must re-encode to the
    // same text) — otherwise a strict intermediary and this server could read two different names from one header.
    if (bytes.toString('base64') !== m[1]) return null
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** What `Mcp-Name` mirrors for a method, or undefined when the method has no `Mcp-Name` (transport: Standard Request Headers). */
function nameFieldOf(msg: Msg): unknown {
  if (msg.method === 'tools/call' || msg.method === 'prompts/get') return msg.params?.name
  if (msg.method === 'resources/read') return msg.params?.uri
  return undefined
}
const NAMED = new Set(['tools/call', 'prompts/get', 'resources/read'])

/**
 * The transport's Server Validation for a modern request: null when the headers agree with the body, else the sentence for
 * the -32020 error. Required: MCP-Protocol-Version (= the `_meta` version), Mcp-Method (= method) and, for tools/call,
 * prompts/get and resources/read, Mcp-Name (= params.name / params.uri, Base64 sentinel decoded first).
 */
export function headerMismatch(headers: Headers, msg: Msg, version: string): string | null {
  const pv = headers.get('mcp-protocol-version')
  if (pv === null) return 'Header mismatch: MCP-Protocol-Version header is missing'
  if (pv.trim() !== version) return `Header mismatch: MCP-Protocol-Version header value '${clip(pv)}' does not match body value '${version}'`
  const method = headers.get('mcp-method')
  if (method === null) return 'Header mismatch: Mcp-Method header is missing'
  if (!HEADER_SAFE.test(method) || method.trim() !== msg.method) return `Header mismatch: Mcp-Method header value '${clip(method)}' does not match body value '${clip(String(msg.method))}'`
  if (NAMED.has(String(msg.method))) {
    const raw = headers.get('mcp-name')
    if (raw === null) return 'Header mismatch: Mcp-Name header is missing'
    const name = decodeHeaderValue(raw.trim())
    const body = nameFieldOf(msg)
    if (name === null) return 'Header mismatch: Mcp-Name header value is malformed'
    if (typeof body !== 'string' || name !== body) return `Header mismatch: Mcp-Name header value '${clip(name)}' does not match body value '${clip(String(body))}'`
  }
  return null
}
const clip = (s: string) => (s.length > 80 ? `${s.slice(0, 80)}…` : s).replace(/[^\x20-\x7e]/g, '?')

/** The UnsupportedProtocolVersionError (schema.ts): the versions to retry with, and the one asked for. */
export const unsupportedVersionError = (id: Msg['id'], requested: string) => ({
  jsonrpc: '2.0' as const,
  id: id ?? null,
  error: { code: UNSUPPORTED_PROTOCOL_VERSION, message: 'Unsupported protocol version', data: { supported: ALL_VERSIONS, requested } },
})

export const headerMismatchError = (id: Msg['id'], message: string) => ({ jsonrpc: '2.0' as const, id: id ?? null, error: { code: HEADER_MISMATCH, message } })

/**
 * A legacy handler's response, as this revision states it. A `result` gains `resultType: "complete"` (schema.ts Result:
 * servers on this revision MUST include it), the server's identity in result `_meta` (merged: a tool's own result
 * `_meta`, x402's settlement, stays), and, for a list or a read, `ttlMs` + `cacheScope`. "public": the lists and the
 * app resources are the same for every caller at an address (route.ts Surface: they vary by URL path, never by the
 * credential), so a shared cache may keep them. An error response is returned as it is.
 */
export function modernize(method: string, response: object, serverInfo: Record<string, unknown>): object {
  const r = response as { result?: unknown }
  if (!('result' in r) || !r.result || typeof r.result !== 'object' || Array.isArray(r.result)) return response
  const result = r.result as Record<string, unknown>
  const meta = result._meta && typeof result._meta === 'object' && !Array.isArray(result._meta) ? (result._meta as Record<string, unknown>) : {}
  return {
    ...response,
    result: {
      ...result,
      resultType: 'complete',
      ...(CACHEABLE.has(method) ? { ttlMs: LIST_TTL_MS, cacheScope: 'public' } : {}),
      _meta: { ...meta, [META_SERVER_INFO]: serverInfo },
    },
  }
}
