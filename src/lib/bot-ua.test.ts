import { describe, it, expect } from 'vitest'
import { isBotUserAgent } from './bot-ua'
import { coarseUserAgent } from './site-stats-shared'

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
