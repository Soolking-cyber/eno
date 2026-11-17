import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/api/mcp/search/tools', () => {
  class SearchToolError extends Error { constructor(public code: string, message: string) { super(message) } }
  return { SEARCH_TOOLS_BY_NAME: new Map(), SearchToolError }
})

import { agentCard, handleA2A, readAsk, requestedVersion, summarize, A2A_ERR, A2A_URL, type Runner } from './agent'
import { SearchToolError } from '@/app/api/mcp/search/tools'

const row = { id: 'cmumdd7j604h49tq4ipbjg8w8', title: 'Honda Vision 2022', price: 18_500_000, price_unit: 'VND', url: 'https://eno.vn/listings/cmumdd7j604h49tq4ipbjg8w8', sponsored: false }

function runner(result: Record<string, unknown> = { total: 1, listings: [row], next_offset: null, capped: false }) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const r: Runner = { allowCall: async () => true, tool: async (name, args) => { calls.push({ name, args }); return result } }
  return { r, calls }
}

const send = (parts: unknown[], method = 'SendMessage', extra: Record<string, unknown> = {}) =>
  ({ jsonrpc: '2.0', id: 7, method, params: { message: { messageId: 'm1', role: 'ROLE_USER', parts, ...extra } } })

describe('A2A agent card', () => {
  it('has every field A2A 1.0 marks REQUIRED, and only true capabilities', () => {
    const c = agentCard() as Record<string, any>
    for (const k of ['name', 'description', 'supportedInterfaces', 'version', 'capabilities', 'defaultInputModes', 'defaultOutputModes', 'skills']) expect(c[k]).toBeTruthy()
    expect(c.supportedInterfaces[0]).toEqual({ url: A2A_URL, protocolBinding: 'JSONRPC', protocolVersion: '1.0' })
    expect(c.capabilities).toEqual({ streaming: false, pushNotifications: false, extendedAgentCard: false })
    expect(c.securitySchemes).toBeUndefined() // nothing here signs anyone in
    for (const s of c.skills) for (const k of ['id', 'name', 'description', 'tags']) expect(s[k]).toBeTruthy()
    expect(c.skills.map((s: { id: string }) => s.id)).toEqual(['find-listings', 'listing-details', 'categories'])
    // 0.3 clients find the same endpoint.
    expect([c.url, c.preferredTransport, c.protocolVersion]).toEqual([A2A_URL, 'JSONRPC', '0.3.0'])
  })
})

describe('requestedVersion', () => {
  const req = (h?: string, q = '') => new Request(`https://eno.vn/api/a2a${q}`, { headers: h ? { 'A2A-Version': h } : {} })
  it('reads an absent header as 0.3 (§3.6.2), Major.Minor, and the query form', () => {
    expect(requestedVersion(req())).toBe('0.3')
    expect(requestedVersion(req('1.0'))).toBe('1.0')
    expect(requestedVersion(req('0.3.0'))).toBe('0.3')
    expect(requestedVersion(req(undefined, '?A2A-Version=1.0'))).toBe('1.0')
    expect(requestedVersion(req('2.0'))).toEqual({ unsupported: '2.0' })
    expect(requestedVersion(req(), 'SendMessage')).toBe('1.0') // a 1.0 method name with no header
    expect(requestedVersion(req(), 'message/send')).toBe('0.3')
  })
})

describe('readAsk', () => {
  it('routes text, URLs, ids, "categories" and data parts to the right skill', () => {
    expect(readAsk({ parts: [{ text: 'xe máy quận 3' }] })).toEqual({ skill: 'find-listings', args: { q: 'xe máy quận 3' } })
    expect(readAsk({ parts: [{ kind: 'text', text: `see ${A2A_URL.replace('/api/a2a', '')}/listings/${row.id}` }] })).toEqual({ skill: 'listing-details', args: { id: row.id } })
    expect(readAsk({ parts: [{ text: row.id }] })).toEqual({ skill: 'listing-details', args: { id: row.id } })
    expect(readAsk({ parts: [{ text: `Is ${A2A_URL.replace('/api/a2a', '')}/listings/${row.id}. still on?` }] })).toEqual({ skill: 'listing-details', args: { id: row.id } })
    expect(readAsk({ parts: [{ text: 'categories?' }] })).toEqual({ skill: 'categories', args: {} })
    expect(readAsk({ parts: [{ text: 'chungcuquan7giarecanho' }] })).toMatchObject({ skill: 'find-listings' }) // a word, not an id
    expect(readAsk({ parts: [{ data: { q: 'macbook', price_max: 25_000_000 } }] })).toEqual({ skill: 'find-listings', args: { q: 'macbook', price_max: 25_000_000 } })
    expect(readAsk({ parts: [{ kind: 'data', data: { id: row.id } }] })).toEqual({ skill: 'listing-details', args: { id: row.id } })
    expect(readAsk({ parts: [{ text: 'cheap' }, { data: { category: 'vehicles' } }] })).toEqual({ skill: 'find-listings', args: { category: 'vehicles', q: 'cheap' } })
  })
  it('refuses what it cannot read with the spec\'s errors', () => {
    expect(readAsk({ parts: [] })).toMatchObject({ error: A2A_ERR.invalidParams })
    expect(readAsk({ parts: [{ url: 'https://x/y.png' }] })).toMatchObject({ error: A2A_ERR.contentType })
    expect(readAsk({ parts: [{ data: { skill: 'pay' } }] })).toMatchObject({ error: A2A_ERR.invalidParams })
    expect(readAsk({ parts: [{ data: { skill: 'constructor' } }] })).toMatchObject({ error: A2A_ERR.invalidParams }) // not a prototype key
    // Another site's /listings/ link is words to search for, not a listing here.
    expect(readAsk({ parts: [{ text: 'cheaper than https://other.example/listings/cmumdd7j604h49tq4ipbjg8w8' }] })).toMatchObject({ skill: 'find-listings' })
    expect(readAsk({ parts: [{ text: '   ' }] })).toMatchObject({ error: A2A_ERR.invalidParams })
  })
})

describe('handleA2A', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('answers SendMessage (1.0) with { message } holding a text and a data part', async () => {
    const { r, calls } = runner()
    const res = (await handleA2A(send([{ text: 'honda vision' }]), '1.0', r)) as any
    expect(calls).toEqual([{ name: 'search_listings', args: { q: 'honda vision' } }])
    expect(res.id).toBe(7)
    const m = res.result.message
    expect(m.role).toBe('ROLE_AGENT')
    expect(m.parts[0].text).toContain('Honda Vision 2022')
    expect(m.parts[0].text).toContain('18,500,000 đ')
    expect(m.parts[1]).toMatchObject({ mediaType: 'application/json', data: { skill: 'find-listings', total: 1 } })
  })

  it('answers message/send (0.3) with the bare Message in 0.3 shape', async () => {
    const { r } = runner()
    const res = (await handleA2A(send([{ kind: 'text', text: 'honda' }], 'message/send', { contextId: 'ctx-1' }), '0.3', r)) as any
    expect(res.result).toMatchObject({ kind: 'message', role: 'agent', contextId: 'ctx-1' })
    expect(res.result.parts.map((p: { kind: string }) => p.kind)).toEqual(['text', 'data'])
  })

  it('keeps no tasks, and says so with the spec\'s codes', async () => {
    const { r } = runner()
    const err = async (method: string, params: unknown = {}) => ((await handleA2A({ jsonrpc: '2.0', id: 1, method, params }, '1.0', r)) as any).error.code
    expect(await err('GetTask', { id: 't' })).toBe(A2A_ERR.taskNotFound)
    expect(await err('CancelTask', { id: 't' })).toBe(A2A_ERR.taskNotFound)
    expect(await err('SendStreamingMessage')).toBe(A2A_ERR.unsupported)
    expect(await err('CreateTaskPushNotificationConfig')).toBe(A2A_ERR.pushNotSupported)
    expect(await err('GetExtendedAgentCard')).toBe(A2A_ERR.extendedCardNotConfigured)
    expect(await err('tasks/delete')).toBe(A2A_ERR.methodNotFound)
    expect(await err('toString')).toBe(A2A_ERR.methodNotFound) // not an inherited key
    expect(((await handleA2A(send([{ text: 'x' }], 'SendMessage', { taskId: 'old' }), '1.0', r)) as any).error.code).toBe(A2A_ERR.taskNotFound)
    expect(((await handleA2A({ jsonrpc: '2.0', id: 1, method: 'ListTasks' }, '1.0', r)) as any).result.tasks).toEqual([])
  })

  it('rejects malformed requests, ignores notifications, and honours the call budget', async () => {
    const { r } = runner()
    expect(((await handleA2A({ jsonrpc: '1.0', id: 1, method: 'SendMessage' }, '1.0', r)) as any).error.code).toBe(A2A_ERR.invalidRequest)
    expect(await handleA2A({ jsonrpc: '2.0', method: 'SendMessage', params: {} }, '1.0', r)).toBeNull()
    const busy: Runner = { allowCall: async () => false, tool: async () => ({}) }
    expect(((await handleA2A(send([{ text: 'x' }]), '1.0', busy)) as any).error.message).toMatch(/Too many/)
  })

  it('turns a gone listing into an answer, and a bad argument into Invalid params', async () => {
    const gone: Runner = { allowCall: async () => true, tool: async () => { throw new SearchToolError('not_found', 'No live listing has that id.') } }
    const res = (await handleA2A(send([{ text: row.id }]), '1.0', gone)) as any
    expect(res.result.message.parts[1].data).toEqual({ skill: 'listing-details', listing: null })
    const bad: Runner = { allowCall: async () => true, tool: async () => { throw new SearchToolError('invalid_input', 'limit: too big') } }
    expect(((await handleA2A(send([{ data: { limit: 999 } }]), '1.0', bad)) as any).error).toEqual({ code: A2A_ERR.invalidParams, message: 'limit: too big' })
  })
})

describe('summarize', () => {
  it('marks sponsored rows and per-month prices', () => {
    const text = summarize('find-listings', { q: 'room' }, { total: 40, listings: [{ ...row, sponsored: true, price: 5_000_000, price_unit: 'VND/month' }] })
    expect(text).toContain('About 40 live listings')
    expect(text).toContain('5,000,000 đ/month (sponsored)')

    // Another currency keeps its own code (never "đUSD").
    expect(summarize('find-listings', {}, { total: 1, listings: [{ ...row, price: 1200, price_unit: 'USD/month' }] })).toContain('1,200 USD/month')
  })
})
