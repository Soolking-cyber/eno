import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * /llms.txt is the file agents read to decide who this site is. It used to live in `public/`,
 * which is copied into BOTH builds verbatim — so eno.forum introduced itself to every agent as
 * "eno.vn is a trusted classifieds marketplace". These tests exist so it cannot regress to that.
 */
const load = async () => {
  vi.resetModules()
  return import('./route')
}

beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn') })
afterEach(() => { vi.unstubAllEnvs() })

const bodyOf = async () => {
  const { GET } = await load()
  return await GET().text()
}

describe('/llms.txt on the marketplace', () => {
  beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace') })

  it('⛔ NAMES eno.vn, NOT THE OTHER EDITION', async () => {
    const body = await bodyOf()
    expect(body).toContain('# eno.vn')
    expect(body).not.toContain('# eno.forum')
  })

  it('⛔ SERVES NO SERVICES VOCABULARY', async () => {
    // ⚠️ WHAT THIS DOES AND DOES NOT PROVE. It proves the runtime gate picks the marketplace body
    // and that no services word is inlined in this route — both mutation-verified. It does NOT
    // prove the build-time stub works: vitest does not apply next.config.ts's alias, so
    // `@/lib/edition-services-copy` here is the REAL module, not the stub. Only a grep of
    // `.next/static` on a marketplace build shows whether the string reached the artifact, which
    // is why eno-deploy.sh reads the built image rather than trusting a suite.
    const body = (await bodyOf()).toLowerCase()
    // ⚠️ 'paypal' BELONGS HERE AND WAS MISSING. CLAUDE.md's licensing boundary names three
    // surfaces — visa, itinerary AND PayPal — and the first version of this list carried two.
    // A PayPal mention added to MARKETPLACE_BODY would have passed a suite that looks like it
    // guards the boundary.
    for (const word of ['e-visa', 'evisa', 'visa', 'itinerary', 'paypal']) {
      expect(body, `"${word}" must not appear in the marketplace llms.txt`).not.toContain(word)
    }
  })

  it('answers the audit finding: a when-to-use section exists and is specific', async () => {
    const body = await bodyOf()
    expect(body).toContain('## When to use this site')
    // Generic marketing does not read as guidance — the section must also say when NOT to.
    expect(body).toContain('Do not use eno.vn for:')
  })

  it('points agents at the contact trust anchor', async () => {
    expect(await bodyOf()).toContain('https://eno.vn/contact')
  })

  it('is served as plain text, not HTML', async () => {
    const { GET } = await load()
    expect(GET().headers.get('content-type')).toContain('text/plain')
  })
})

describe('/llms.txt on the services edition', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.eno.forum')
  })

  it('⛔ INTRODUCES ITSELF AS eno.forum — the bug this route was created to fix', async () => {
    const body = await bodyOf()
    expect(body).toContain('# eno.forum')
    expect(body).not.toContain('# eno.vn')
  })

  it('⛔ LINKS ONLY TO ITS OWN ORIGIN, never the marketplace', async () => {
    // A stale https://eno.vn/... link here would hand agents to the other licensed entity.
    const body = await bodyOf()
    expect(body).not.toMatch(/https:\/\/eno\.vn/)
  })
})
