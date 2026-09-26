import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * robots.txt is ~75 comment lines around 22 directives, and every line of it is SERVED — so a comment
 * is a public claim, and three of them were false (identity audit, 2026-09-27): Google-Extended
 * described as a search crawler, an AI Labyrinth "trap" that is switched off, and an unknown
 * directive called a "parse error" to Google. The corrections touched comments only.
 *
 * ⛔ THE FIRST TEST IS THE ONE THAT MATTERS: it pins every directive AND every blank line (a blank
 * line ends a group under RFC 9309), so a comment edit cannot quietly change what a crawler obeys.
 * Changing a rule means changing this list on purpose.
 */
const load = async () => {
  vi.resetModules()
  return import('./route')
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
})
afterEach(() => { vi.unstubAllEnvs() })

const bodyOf = async () => (await load()).GET().text()

describe('/robots.txt', () => {
  it('⛔ serves exactly the directives it served before the comment corrections', async () => {
    const rules = (await bodyOf()).split('\n').filter((l) => !l.startsWith('#'))
    expect(rules).toEqual([
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin',
      'Disallow: /api',
      'Allow: /api/v1/status',
      'Disallow: /md/',
      'Disallow: /disputes',
      'Disallow: /appeal',
      'Disallow: /reports',
      'Disallow: /unsubscribe',
      '',
      'User-agent: GPTBot',
      'User-agent: CCBot',
      'User-agent: ClaudeBot',
      'User-agent: anthropic-ai',
      'User-agent: Bytespider',
      'User-agent: ImagesiftBot',
      'User-agent: img2dataset',
      'User-agent: Diffbot',
      'User-agent: Omgilibot',
      'User-agent: Applebot-Extended',
      'Disallow: /',
      '',
      'Sitemap: https://eno.vn/sitemap.xml',
      '',
    ])
  })

  it('no longer makes the three false claims', async () => {
    const body = await bodyOf()
    // Google-Extended is a training + grounding control token, not a search/answer crawler.
    expect(body).not.toMatch(/\(OAI-SearchBot[^)]*Google-Extended/)
    expect(body).toContain('Google-Extended is not listed either, and it is not a search crawler')
    // AI Labyrinth was disabled on the eno.vn zone (read 2026-09-27), so the "traps" claim went. No
    // replacement claim either: this file is served on BOTH hosts, only one zone was read, and a
    // served comment advertising what is not enforced is an invitation.
    expect(body).not.toMatch(/AI Labyrinth/)
    expect(body).not.toMatch(/Nothing enforces/)
    // Google ignores an invalid line; only Lighthouse's validator fails the file.
    expect(body).not.toMatch(/PARSE ERROR to Google/)
    expect(body).not.toMatch(/BREAKS THE WHOLE FILE FOR GOOGLE/)
  })

  it('names only its own origin in the Sitemap line', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.eno.forum')
    const body = await bodyOf()
    expect(body).toContain('Sitemap: https://www.eno.forum/sitemap.xml')
    expect(body).not.toContain('https://eno.vn')
  })
})
