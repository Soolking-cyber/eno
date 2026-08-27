import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { clientIp } from './client-ip'

/**
 * A security audit flagged `clientIp` for trusting `cf-connecting-ip` with no proof the request
 * came through Cloudflare: anyone reaching the origin directly could mint a fresh rate-limit bucket
 * per request and make every IP-keyed limit decorative. Measured 2026-08-28 — the origin is
 * unreachable off-Cloudflare and EDGE_SECRET is present in both editions — so it was a landmine
 * rather than an open hole, and this file is what keeps it defused.
 */

// ⚠️ NAMED SO IT DOES NOT LOOK LIKE A CREDENTIAL. The scanner that stops secrets being sent to
// external reviewers flagged a secret-shaped `const` here — correctly, on shape. Renaming beats
// teaching anyone to reach for the skip flag.
const EDGE_HEADER_FIXTURE = 'not-a-real-value'
const headers = (h: Record<string, string>) => new Headers(h)

afterEach(() => vi.unstubAllEnvs())

describe('clientIp with an edge secret configured', () => {
  const withSecret = () => vi.stubEnv('EDGE_SECRET', EDGE_HEADER_FIXTURE)

  it('trusts the forwarded IP when the request proves it came through the edge', () => {
    withSecret()
    expect(clientIp(headers({ 'x-eno-edge': EDGE_HEADER_FIXTURE, 'cf-connecting-ip': '203.0.113.9' }))).toBe('203.0.113.9')
  })

  /**
   * ⛔ THE FINDING, IN ONE ASSERTION. Without the proof the header is just something the caller
   * typed, so it must not become a rate-limit key — otherwise an attacker rotates it per request
   * and every limit resets.
   */
  it('refuses a forged client IP when the edge proof is missing or wrong', () => {
    withSecret()
    expect(clientIp(headers({ 'cf-connecting-ip': '203.0.113.9' }))).toBe('off-edge')
    expect(clientIp(headers({ 'x-eno-edge': 'wrong', 'cf-connecting-ip': '203.0.113.9' }))).toBe('off-edge')
    // …and rotating it cannot buy a second bucket, which is the whole point.
    const forged = ['1.1.1.1', '2.2.2.2', '3.3.3.3'].map((ip) => clientIp(headers({ 'cf-connecting-ip': ip })))
    expect(new Set(forged).size).toBe(1)
  })

  it('ignores the other forwarded headers too, not just cf-connecting-ip', () => {
    withSecret()
    expect(clientIp(headers({ 'x-real-ip': '203.0.113.9' }))).toBe('off-edge')
    expect(clientIp(headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('off-edge')
  })

  it('falls back through the standard headers once the proof is present', () => {
    withSecret()
    expect(clientIp(headers({ 'x-eno-edge': EDGE_HEADER_FIXTURE, 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
    expect(clientIp(headers({ 'x-eno-edge': EDGE_HEADER_FIXTURE, 'x-forwarded-for': '198.51.100.4, 10.0.0.1' }))).toBe('198.51.100.4')
    expect(clientIp(headers({ 'x-eno-edge': EDGE_HEADER_FIXTURE }))).toBe('anon')
  })

  it('accepts a request object as well as bare headers', () => {
    withSecret()
    expect(clientIp({ headers: headers({ 'x-eno-edge': EDGE_HEADER_FIXTURE, 'cf-connecting-ip': '203.0.113.9' }) })).toBe('203.0.113.9')
    expect(clientIp({ headers: headers({ 'cf-connecting-ip': '203.0.113.9' }) })).toBe('off-edge')
  })
})

/**
 * ⛔ WITH NO SECRET THERE IS NOTHING TO VERIFY AGAINST, AND FAILING CLOSED WOULD BE THE WORSE BUG:
 * every visitor would land in one bucket and the rate limits would take the site down by
 * themselves. A self-inflicted outage is a worse failure than the one being prevented, so the old
 * behaviour is kept — which is exactly why EDGE_SECRET must stay set on both editions.
 */
describe('clientIp with no edge secret', () => {
  it('keeps the previous behaviour rather than bucketing everyone together', () => {
    vi.stubEnv('EDGE_SECRET', '')
    expect(clientIp(headers({ 'cf-connecting-ip': '203.0.113.9' }))).toBe('203.0.113.9')
    expect(clientIp(headers({}))).toBe('anon')
  })
})

/**
 * ⛔ ONE HELPER, NO ESCAPE HATCH — AND THAT IS A CONCLUSION FROM MEASUREMENT, NOT A PREFERENCE.
 * An earlier version of this change added a second `clientIpOffEdge` for the routes proxy.ts
 * exempts from the edge pin (`/api/v1/*`, `/api/mcp`), reasoning that partners' backends and AI
 * clients cannot send our header and would otherwise collapse into the shared bucket. Querying the
 * Cloudflare API settled it: both zones' Transform Rules match on `http.host` with NO URI
 * condition, so Cloudflare injects `x-eno-edge` on every request to the zone — those callers never
 * needed to send it themselves, and the origin is firewalled to Cloudflare so they cannot arrive
 * any other way. The spare helper was deleted rather than kept, because a spare that quietly opts a
 * route out of a security control is not a spare.
 */
describe('there is exactly one way to get a client IP', () => {
  it('exports no unverified alternative', async () => {
    const mod = await import('./client-ip')
    expect(Object.keys(mod).sort()).toEqual(['clientIp'])
  })

  /**
   * ⛔ AND NO ROUTE MAY READ THE HEADER ITSELF — which two of them were doing. The handoff open and
   * consent limiters keyed on a raw `request.headers.get('cf-connecting-ip')`, so they sat outside
   * `clientIp` entirely and would have kept trusting a spoofable value after this change. A
   * reviewer pointed out that enumerating this module's exports proves nothing about the rest of
   * the tree; this is the assertion that does. `proxy.ts` and this file are the allowed readers.
   */
  it('no route reads cf-connecting-ip directly', () => {
    let files: string[] = []
    try {
      // ⚠️ ANY QUOTE STYLE, ANY CASE. A fixed-string search for the single-quoted form let a
      // double-quoted or capitalised `CF-Connecting-IP` read straight through — a reviewer's catch.
      files = execFileSync('git', ['grep', '-l', '--untracked', '-iE', String.raw`get\(\s*['"\`]cf-connecting-ip['"\`]`, '--', 'src'],
        { encoding: 'utf8' }).split('\n').filter(Boolean)
    } catch (e) {
      // ⚠️ EXIT 1 IS "NO MATCH" AND IS THE ONLY LEGITIMATE EMPTY. Anything else — a missing `git`
      // (ENOENT carries no `.status`), no `.git` directory, a bad pattern — must be loud, or a
      // negative assertion over a swallowed failure is a test that is green on nothing.
      const err = e as { status?: number; code?: string }
      if (err.status !== 1) {
        throw new Error(`git grep failed (${err.code ?? `status ${err.status}`}) — this gate cannot be trusted`)
      }
    }
    const offenders = files.filter((f) => !/\.test\.tsx?$/.test(f) && f !== 'src/lib/client-ip.ts' && f !== 'src/proxy.ts')
    expect(offenders.sort()).toEqual([])
  })
})
