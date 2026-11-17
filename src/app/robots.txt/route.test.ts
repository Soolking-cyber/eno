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
  it('the five crawlers the owner allowed (2026-11-17) read the public pages under "User-agent: *", training yes', async () => {
    const body = await bodyOf()
    for (const ua of ['Bytespider', 'ClaudeBot', 'CCBot', 'GPTBot', 'Meta-ExternalAgent']) expect(body).not.toMatch(new RegExp(`^User-agent: ${ua}$`, 'm'))
    expect(body).toMatch(/^User-agent: \*\nAllow: \/$/m)
    expect(body).not.toContain('ai-train=no')
  })

  it('⛔ serves exactly these directives (comment edits never change them; the 2026-11-17 crawler change did, on purpose)', async () => {
    const rules = (await bodyOf()).split('\n').filter((l) => !l.startsWith('#'))
    expect(rules).toEqual([
      'User-agent: *',
      'Allow: /',
      // Content Signals (2026-11-16): the file's existing policy as a preference — search and AI answers yes; training yes since 2026-11-17 (owner).
      'Content-Signal: search=yes, ai-input=yes, ai-train=yes',
      'Disallow: /admin',
      'Disallow: /api',
      'Allow: /api/v1/status',
      'Disallow: /md/',
      'Disallow: /disputes',
      'Disallow: /appeal',
      'Disallow: /reports',
      'Disallow: /unsubscribe',
      '',
      'User-agent: ImagesiftBot',
      'User-agent: img2dataset',
      'User-agent: Diffbot',
      'User-agent: Omgilibot',
      'Disallow: /',
      '',
      // Owner 2026-11-16 "Brand pages only": the assistants' training crawlers learn what eno.vn is, never the listings.
      'User-agent: anthropic-ai',
      'User-agent: Applebot-Extended',
      'Content-Signal: search=yes, ai-input=yes, ai-train=yes',
      'Allow: /about$',
      'Allow: /developers$',
      'Allow: /developers/',
      'Allow: /guides$',
      'Allow: /guides/',
      'Allow: /huong-dan$',
      'Allow: /huong-dan/',
      'Allow: /help$',
      'Allow: /help/',
      'Allow: /teach-in-vietnam$',
      'Allow: /trust$',
      'Allow: /safety$',
      'Allow: /partners$',
      'Allow: /hcmc-rent-index$',
      'Allow: /llms.txt$',
      'Allow: /index.md$',
      'Allow: /agents.md$',
      'Allow: /auth.md$',
      'Allow: /pricing.md$',
      'Disallow: /',
      '',
      'Sitemap: https://eno.vn/sitemap.xml',
      // The page sitemap, named directly (2026-10-18): a crawler that reads the index need not open it.
      'Sitemap: https://eno.vn/sitemaps/pages.xml',
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
    expect(body).toContain('Sitemap: https://www.eno.forum/sitemaps/pages.xml')
    expect(body).not.toContain('https://eno.vn')
  })
})
