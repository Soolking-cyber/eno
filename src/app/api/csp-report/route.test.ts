import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The CSP report sink. Since 2026-10-22 (security review item 24) a Report-Only twin of script-src without
// 'unsafe-eval' runs beside the enforced policy, so the log line says which policy saw the violation: `disp=report`
// (the eval probe — nothing was blocked) or `disp=enforce` (the CSP blocked it). Every branch stays a bodyless 204.

vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.9' }))

const { POST } = await import('./route')

let lines: string[] = []
beforeEach(() => {
  lines = []
  vi.spyOn(console, 'warn').mockImplementation((line: string) => { lines.push(line) })
})
afterEach(() => vi.restoreAllMocks())

const post = (body: unknown, type: string) =>
  POST(new Request('https://eno.vn/api/csp-report', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': type } }) as never)

describe('csp-report', () => {
  it('a Reporting API batch from the eval probe logs disp=report', async () => {
    const res = await post([{ type: 'csp-violation', body: { effectiveDirective: 'script-src', blockedURL: 'eval', documentURL: 'https://eno.vn/', disposition: 'report' } }], 'application/reports+json')
    expect(res.status).toBe(204)
    expect(lines).toEqual(['[csp] script-src disp=report blocked=eval doc=https://eno.vn/'])
  })

  it('a legacy report-uri payload from the enforced policy logs disp=enforce', async () => {
    await post({ 'csp-report': { 'violated-directive': 'connect-src', 'blocked-uri': 'https://evil.example', 'document-uri': 'https://eno.vn/x', disposition: 'enforce' } }, 'application/csp-report')
    expect(lines).toEqual(['[csp] connect-src disp=enforce blocked=https://evil.example doc=https://eno.vn/x'])
  })

  it('an unexpected disposition is never echoed into the log', async () => {
    await post({ 'csp-report': { 'violated-directive': 'img-src', 'blocked-uri': 'data', disposition: 'x\ninjected' } }, 'application/csp-report')
    expect(lines).toEqual(['[csp] img-src disp=unknown blocked=data doc='])
  })
})
