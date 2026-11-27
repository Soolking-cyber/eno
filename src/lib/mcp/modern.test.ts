import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_VERSIONS, LEGACY_VERSIONS, MODERN_VERSION, decodeHeaderValue, eraOf, headerMismatch, legacyMetaMismatch, modernize, LIST_TTL_MS } from './modern'

/** The MCP 2026-07-28 rules route.ts applies to a request whose _meta names that revision (modern.ts). */

const meta = (v: string) => ({ 'io.modelcontextprotocol/protocolVersion': v, 'io.modelcontextprotocol/clientCapabilities': {} })
const msg = (method: string, params: Record<string, unknown> = {}, v = MODERN_VERSION) => ({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: meta(v) } })
const h = (o: Record<string, string>) => new Headers(o)

describe('the era of a request', () => {
  it('no _meta version is the handshake era, exactly as before', () => {
    expect(eraOf({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).toEqual({ kind: 'legacy' })
    expect(eraOf({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x', _meta: { 'x402/payment': {} } } })).toEqual({ kind: 'legacy' })
    expect(eraOf(null)).toEqual({ kind: 'legacy' })
  })
  it('2026-07-28 is modern; a handshake version in _meta stays legacy; anything else is unsupported', () => {
    expect(eraOf(msg('tools/list'))).toEqual({ kind: 'modern', version: '2026-07-28' })
    expect(eraOf(msg('tools/list', {}, '2025-11-25'))).toEqual({ kind: 'legacy', metaVersion: '2025-11-25' })
    expect(eraOf(msg('tools/list', {}, '2099-01-01'))).toEqual({ kind: 'unsupported', requested: '2099-01-01' })
  })
  it('a notification and initialize are always the handshake era; a non-string _meta version is malformed', () => {
    expect(eraOf({ jsonrpc: '2.0', method: 'notifications/initialized', params: { _meta: meta(MODERN_VERSION) } })).toEqual({ kind: 'legacy' })
    expect(eraOf(msg('initialize', { protocolVersion: MODERN_VERSION }))).toEqual({ kind: 'legacy' })
    expect(eraOf({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': 20260728 } } })).toEqual({ kind: 'malformed' })
  })
  it('a handshake version in _meta: the header, when sent, must say the same', () => {
    expect(legacyMetaMismatch(h({}), '2025-11-25')).toBeNull()
    expect(legacyMetaMismatch(h({ 'mcp-protocol-version': '2025-11-25' }), '2025-11-25')).toBeNull()
    expect(legacyMetaMismatch(h({ 'mcp-protocol-version': '2026-07-28' }), '2025-11-25')).toMatch(/does not match/)
  })
  it('the handshake list is route.ts SUPPORTED, in its order — the two cannot drift', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/mcp/route.ts'), 'utf8')
    const block = /const SUPPORTED = new Set\(\[([^\]]+)\]\)/.exec(src)
    expect(block).toBeTruthy()
    expect([...block![1].matchAll(/'([^']+)'/g)].map((x) => x[1])).toEqual([...LEGACY_VERSIONS])
    expect(ALL_VERSIONS).toEqual(['2026-07-28', ...LEGACY_VERSIONS])
  })
})

describe('header validation (transport: Server Validation)', () => {
  const ok = { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': 'search_listings' }
  const call = msg('tools/call', { name: 'search_listings', arguments: {} })
  it('accepts headers that mirror the body', () => {
    expect(headerMismatch(h(ok), call, MODERN_VERSION)).toBeNull()
    expect(headerMismatch(h({ 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' }), msg('tools/list'), MODERN_VERSION)).toBeNull()
  })
  it('refuses a missing or different MCP-Protocol-Version, Mcp-Method or Mcp-Name', () => {
    const { 'mcp-protocol-version': _v, ...noVersion } = ok
    const { 'mcp-method': _m, ...noMethod } = ok
    const { 'mcp-name': _n, ...noName } = ok
    expect(headerMismatch(h(noVersion), call, MODERN_VERSION)).toMatch(/MCP-Protocol-Version header is missing/)
    expect(headerMismatch(h({ ...ok, 'mcp-protocol-version': '2025-11-25' }), call, MODERN_VERSION)).toMatch(/does not match/)
    expect(headerMismatch(h(noMethod), call, MODERN_VERSION)).toMatch(/Mcp-Method header is missing/)
    expect(headerMismatch(h({ ...ok, 'mcp-method': 'tools/list' }), call, MODERN_VERSION)).toMatch(/Mcp-Method/)
    expect(headerMismatch(h(noName), call, MODERN_VERSION)).toMatch(/Mcp-Name header is missing/)
    expect(headerMismatch(h({ ...ok, 'mcp-name': 'create_listing' }), call, MODERN_VERSION)).toMatch(/Mcp-Name header value 'create_listing'/)
  })
  it('Mcp-Name names the uri for resources/read, and only the named methods need it', () => {
    const read = msg('resources/read', { uri: 'ui://eno/search.html' })
    expect(headerMismatch(h({ 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'resources/read', 'mcp-name': 'ui://eno/search.html' }), read, MODERN_VERSION)).toBeNull()
    expect(headerMismatch(h({ 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'resources/read', 'mcp-name': 'ui://other' }), read, MODERN_VERSION)).toMatch(/Mcp-Name/)
  })
  it('decodes the Base64 sentinel before comparing (a name outside header-safe characters)', () => {
    const name = 'tìm_kiếm'
    const enc = `=?base64?${Buffer.from(name, 'utf8').toString('base64')}?=`
    expect(decodeHeaderValue(enc)).toBe(name)
    expect(headerMismatch(h({ ...ok, 'mcp-name': enc }), msg('tools/call', { name }), MODERN_VERSION)).toBeNull()
    // Markers are case-sensitive; bad Base64 and bad UTF-8 are malformed, not a pass.
    expect(decodeHeaderValue('=?BASE64?YQ==?=')).toBe('=?BASE64?YQ==?=')
    expect(decodeHeaderValue('=?base64?YQ=?=')).toBeNull()
    // Non-canonical: 'YR==' decodes to 'a' in Node, but only 'YQ==' is a's encoding — a strict reader would disagree.
    expect(decodeHeaderValue('=?base64?YQ==?=')).toBe('a')
    expect(decodeHeaderValue('=?base64?YR==?=')).toBeNull()
    expect(decodeHeaderValue(`=?base64?${Buffer.from([0xff, 0xfe]).toString('base64')}?=`)).toBeNull()
  })
})

describe('a result, restated for 2026-07-28', () => {
  const info = { name: 'eno Agentic Commerce', version: '2.0.0' }
  it('every result gains resultType and serverInfo; a list gains the cache hints', () => {
    const out = modernize('tools/list', { jsonrpc: '2.0', id: 1, result: { tools: [] } }, info) as { result: Record<string, unknown> }
    expect(out.result).toEqual({ tools: [], resultType: 'complete', ttlMs: LIST_TTL_MS, cacheScope: 'public', _meta: { 'io.modelcontextprotocol/serverInfo': info } })
    const call = modernize('tools/call', { jsonrpc: '2.0', id: 1, result: { content: [], isError: true } }, info) as { result: Record<string, unknown> }
    expect(call.result.resultType).toBe('complete')
    expect(call.result).not.toHaveProperty('ttlMs')
  })
  it('keeps a tool\'s own result _meta (x402 settlement) beside the server\'s identity', () => {
    const out = modernize('tools/call', { jsonrpc: '2.0', id: 1, result: { content: [], _meta: { 'x402/payment-response': { ok: true } } } }, info) as { result: { _meta: Record<string, unknown> } }
    expect(out.result._meta).toEqual({ 'x402/payment-response': { ok: true }, 'io.modelcontextprotocol/serverInfo': info })
  })
  it('an error response is left as it is (no resultType on an error)', () => {
    const err = { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } }
    expect(modernize('nope', err, info)).toBe(err)
  })
})
