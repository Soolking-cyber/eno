import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SPEC } from '@/app/api/v1/openapi.json/route'
import { DOC_PATHS } from '@/lib/api/discovery-links'

/**
 * The policy page and the OpenAPI document must tell the same story (page.tsx's header note). Read as source text: the
 * page renders Header/Footer, which this suite does not mount.
 */
const PAGE = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8')
const policy = (SPEC as unknown as { 'x-deprecation-policy': Record<string, unknown> })['x-deprecation-policy']

describe('/developers/versioning agrees with the spec', () => {
  it('the spec points at this page, and the page is canonical at that path', () => {
    expect(String(policy.policyUrl).endsWith(DOC_PATHS.versioning)).toBe(true)
    expect(PAGE).toContain('alternates: { canonical: DOC_PATHS.versioning }')
  })

  it('⛔ "nothing is deprecated" on the page holds only while the spec lists nothing', () => {
    // Deprecating an operation means updating BOTH: this test fails until the page's "Deprecated now" changes too.
    expect(policy.deprecatedOperations).toEqual([])
    expect(policy.sunsetDates).toEqual({})
    expect(PAGE).toContain('Nothing is deprecated in v1, and no sunset date is set.')
    // …and no operation in the document carries `deprecated: true` behind the lists' back.
    const paths = (SPEC as unknown as { paths: Record<string, Record<string, { deprecated?: boolean }>> }).paths
    const flagged = Object.entries(paths).flatMap(([p, ops]) => Object.entries(ops).filter(([, op]) => op?.deprecated).map(([m]) => `${m} ${p}`))
    expect(flagged).toEqual([])
  })

  it('⛔ promises no notice period, like the spec (a commitment only the owner can make)', () => {
    expect(PAGE).toContain('No notice period has been published yet')
    expect(PAGE).not.toMatch(/\b\d+\s*(days|months)\b(?![^<]*example)/i)
    expect(JSON.stringify(policy)).not.toMatch(/notice(Days|Period)/i)
  })

  it('names the same signals the spec names', () => {
    const signals = policy.signals as { headers: string[] }
    expect(signals.headers).toEqual(['Deprecation (RFC 9745)', 'Sunset (RFC 8594)'])
    for (const s of ['Deprecation', 'RFC 9745', 'Sunset', 'RFC 8594', 'deprecated: true']) expect(PAGE).toContain(s)
  })
})
