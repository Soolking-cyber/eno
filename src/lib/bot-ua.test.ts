import { describe, it, expect } from 'vitest'
import { isBotUserAgent, isBotRequest } from './bot-ua'
import { coarseUserAgent } from './site-stats-shared'
import { CRAWLER_UAS, PERSON_UAS } from './__fixtures__/user-agents'

/**
 * ⛔ THESE USER-AGENTS ARE NOT INVENTED. Every string below was read out of Cloudflare's own log
 * for POST /api/site-stats on the eno.forum zone, 2026-09-17 02:14–02:24 UTC — the ten minutes in
 * which the footer claimed "5 here now". One human session, six Meta renderer hits. A guard whose
 * fixtures are made up proves only that the regex matches the regex.
 */
describe('a crawler is not a visitor', () => {
  const METAS = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 (compatible; meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler))',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 (compatible; meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler))',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 (compatible; meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler))',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.0.0 (compatible; meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler))',
  ]

  it('catches every meta-externalagent variant that reached the endpoint', () => {
    for (const ua of METAS) expect(isBotUserAgent(ua)).toBe(true)
  })

  /**
   * ⚠️ THE POINT OF THIS ONE IS THE SHAPE, NOT THE COUNT. Those four strings collapse to THREE
   * distinct coarse identities (chrome|mac, chrome|windows, chrome|linux), and each arrived from a
   * different address — so before the guard, one crawl minted a person per request in a table that
   * also feeds the durable all-time total.
   */
  it('shows why it mattered: the crawler rotates the identity this counter is built on', () => {
    expect(new Set(METAS.map(coarseUserAgent)).size).toBeGreaterThan(1)
  })

  it('catches the other renderers and the self-identifying clients', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/145.0.0.0 Safari/537.36',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'curl/8.7.1',
      'python-requests/2.32.3',
      // PageSpeed Insights (Lighthouse) and its older self-named agent — the "Join eno" prompt reads
      // this list too, and must never ask an audit run. ⚠️ NOT from our Cloudflare log like the rest:
      // these are the published PSI user-agent shapes (the `Chrome-Lighthouse` suffix, and the legacy
      // `Google Page Speed Insights` token), so they pin the tokens, not an observed visit.
      'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0.2272.118 Safari/537.36 Google Page Speed Insights',
    ]) expect(isBotUserAgent(ua)).toBe(true)
  })

  /**
   * ⛔ THE HALF THAT ACTUALLY NEEDS GUARDING. A false positive is SILENT: a real reader matched
   * here loses the footer counters and their visit is never recorded, with nothing to notice. The
   * first two strings are the two real people measured in that same ten-minute window.
   */
  it('does not touch a real reader', () => {
    for (const ua of [
      /**
       * ⛔ CUBOT IS THE FIXTURE THAT MATTERS AND IT IS NOT HYPOTHETICAL. It is an Android brand
       * sold in Vietnam, and its model string lands in the platform block as `CUBOT_NOTE_40` or
       * `CUBOT KING KONG 5 Pro`. A generic `bot`-at-token-end pattern matched BOTH — three
       * reviewers refused the first draft of the guard over exactly this, and the strings below
       * were checked against the pattern before the list replaced it.
       */
      'Mozilla/5.0 (Linux; Android 12; CUBOT_NOTE_40) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Linux; Android 11; CUBOT KING KONG 5 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/153.0.8010.24 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/23G71',
      'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36',
      // A real person who tapped a shared link and landed in WhatsApp's in-app browser. The
      // unfurler shares this token and cannot run JavaScript, so it never reaches the endpoint.
      'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 WhatsApp/2.24.20.85',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.0.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
      'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    ]) expect(isBotUserAgent(ua)).toBe(false)
  })
})

/**
 * The counter guard (`isBotRequest`) that every crawler-reachable counter reads since 2026-10-03 —
 * the listing view, the footer heartbeat and the forum post view. One table of strings, shared with
 * those routes' own tests (src/lib/__fixtures__/user-agents.ts).
 */
describe('isBotRequest — may this request move a count?', () => {
  const req = (ua: string | null) => ({ headers: new Headers(ua === null ? {} : { 'user-agent': ua }) })

  for (const [name, ua] of Object.entries(CRAWLER_UAS)) {
    it(`no — ${name}`, () => expect(isBotRequest(req(ua))).toBe(true))
  }

  it('no — a request that sends no user-agent header at all (no browser does)', () => {
    expect(isBotRequest(req(null))).toBe(true)
    expect(isBotRequest(req('   '))).toBe(true)
  })

  /**
   * ⛔ THE HALF THAT MATTERS. A person matched here is a view a seller never sees, silently. The
   * in-app browsers are the point: Facebook, Messenger, Instagram, Zalo and TikTok are where a shared
   * listing actually gets opened in this market, and two of them belong to companies whose crawlers
   * ARE on the list.
   */
  for (const [name, ua] of Object.entries(PERSON_UAS)) {
    it(`yes — ${name}`, () => expect(isBotRequest(req(ua))).toBe(false))
  }

  it('isBotUserAgent keeps its old answer for an empty string (the signup prompt reads it)', () => {
    expect(isBotUserAgent('')).toBe(false)
  })
})
