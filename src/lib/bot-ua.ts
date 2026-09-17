/**
 * Is this user-agent a crawler rather than a person?
 *
 * ⛔ ITS OWN MODULE, AND site-stats-shared.ts IS THE WRONG PLACE FOR IT — a reviewer moved it here
 * and the reason is the same one written at the top of that file. `site-stats-shared` exists so
 * the FOOTER WIDGET can import a type and two numbers without dragging the server in; it is in the
 * client bundle of every page on the site. This list is ~50 crawler names that only the server ever
 * reads, and shipping it to every human visitor is exactly the bloat that split was made to stop.
 * It cannot live in site-stats.ts either — that module pulls `node:crypto` and Prisma at the top
 * level, which would make this untestable without them. So: its own file, no imports, server-only
 * by convention and by the fact that nothing on the client references it.
 *
 * ⛔ THIS EXISTS BECAUSE THE COUNTER WAS MEASURABLY WRONG, NOT AS A PRECAUTION. eno.forum showed
 * "5 here now" on 2026-09-17; Cloudflare's own log for POST /api/site-stats over the same ten
 * minutes held ONE real visitor (a Chrome/152 session on a VN residential IPv6) and SIX hits from
 * `meta-externalagent/1.1` — Meta's renderer, out of `2a03:2880:f816::/48`, a different address
 * every time and three different platform strings (Mac, Windows, Linux Chrome/145).
 *
 * ⚠️ AND THAT IS THE WORST POSSIBLE SHAPE FOR THIS PARTICULAR DESIGN. The visitor identity is
 * ip + coarseUserAgent, and a renderer that rotates BOTH halves mints a brand-new visitor on every
 * single request. It is not merely "here now" that was overstated — `site_visit_total` is durable,
 * so the all-time figure has been absorbing one phantom visitor per crawl with no path back.
 *
 * ⚠️ IT ONLY CATCHES CRAWLERS THAT RUN JAVASCRIPT, AND THERE IS NOTHING TO CATCH BESIDES. The
 * heartbeat is a POST issued by a React effect in a visible tab, so curl, a plain Googlebot fetch,
 * an uptime probe and every non-rendering scraper were never counted in the first place. The list
 * below is therefore short on purpose: the renderers that actually reach this endpoint, plus the
 * generic tokens every well-behaved automated client self-identifies with.
 *
 * ⛔ TIGHT PATTERNS, BECAUSE A FALSE POSITIVE IS SILENT. A real reader matched here loses the
 * footer counters and their visit is never recorded, with nothing to notice. So this matches
 * declared bot tokens only — never a heuristic like "no Accept-Language" or an unfamiliar family.
 * A determined forger can still spoof a human user-agent; the ceiling on that is unchanged
 * (families x platforms per address per day) and authenticating a decorative counter would cost
 * more than the number is worth.
 */
/**
 * ⛔ AN EXPLICIT LIST OF CRAWLER NAMES, NOT A GENERIC `bot` TOKEN — AND THE GENERIC ONE IS WHAT ALL
 * THREE REVIEWERS KILLED, CORRECTLY. The first draft matched `bot` at the end of any token, on the
 * reasoning that "no shipping browser puts `bot` at the end of a token". **Cubot** does: it is an
 * Android brand sold in Vietnam, and its model string sits in the platform block as
 * `Android 12; CUBOT_NOTE_40` or `Android 11; CUBOT KING KONG 5 Pro`. Both match. Verified against
 * the real strings before believing it, and no tightening of the trailing delimiter saves it —
 * `_`, a space and `)` all really occur there, which is every delimiter a crawler token uses too.
 *
 * ⚠️ SO THE TRADE IS MADE DELIBERATELY IN ONE DIRECTION. A name missing from this list is a
 * crawler that keeps being counted — the behaviour that already existed, no worse than before, and
 * fixed by adding one word. A false positive is a REAL READER whose visit is never recorded and
 * whose footer counters silently vanish, with nothing anywhere to notice. The list rots slowly and
 * safely; the clever pattern fails immediately and invisibly.
 *
 * ⚠️ IT ONLY NEEDS THE CRAWLERS THAT RUN JAVASCRIPT. The heartbeat is a POST issued by a React
 * effect in a visible tab, so curl, a plain Googlebot HTML fetch, an uptime probe and every
 * non-rendering scraper were never counted in the first place — `curl` and `python-requests` are
 * here only because a client that declares itself costs nothing to honour.
 */
const BOT_TOKENS = [
  // The one measured in our own logs, and its stablemate.
  'meta-externalagent', 'facebookexternalhit',
  // Search + SEO.
  'googlebot', 'google-inspectiontool', 'bingbot', 'yandexbot', 'duckduckbot', 'baiduspider',
  'applebot', 'petalbot', 'seznambot', 'ahrefsbot', 'semrushbot', 'mj12bot', 'dotbot', 'dataforseobot',
  // AI crawlers.
  'gptbot', 'oai-searchbot', 'chatgpt-user', 'claudebot', 'claude-web', 'anthropic-ai',
  'perplexitybot', 'amazonbot', 'bytespider', 'ccbot', 'google-extended',
  // Link unfurlers. ⛔ `whatsapp` WAS HERE AND CAME STRAIGHT BACK OUT (reviewer, same round as the
  // Cubot finding). WhatsApp's unfurler is `WhatsApp/2.x` — but so is the in-app browser a real
  // person lands in after tapping a shared link, on a messenger this market actually uses. The
  // unfurler cannot run JavaScript, so it never reaches this endpoint in the first place: the token
  // bought nothing and risked exactly the silent false positive this list is shaped to avoid.
  'twitterbot', 'slackbot', 'discordbot', 'telegrambot', 'linkedinbot', 'pinterestbot',
  'skypeuripreview', 'embedly', 'iframely',
  // Headless/synthetic browsers and the clients that declare themselves.
  'headlesschrome', 'phantomjs', 'puppeteer', 'playwright', 'lighthouse', 'chrome-lighthouse',
  // ⚠️ `headlesschrome`/`playwright`/`lighthouse` also match THIS REPO'S OWN e2e and CI runs, which
  // is intended and currently costless: nothing under e2e/ asserts the footer counters (grepped).
  // If a suite ever does, it will see zeros — give that test a normal user-agent rather than
  // reopening this list.
  'pingdom', 'uptimerobot', 'statuscake', 'python-requests', 'curl', 'wget', 'go-http-client',
  // Generic self-declarations. ⚠️ `crawler`/`spider` are safe as substrings (no consumer device
  // name contains either); `bot` on its own is NOT, which is the whole note above.
  'crawler', 'crawling', 'spider', 'slurp',
] as const

const BOT_UA = new RegExp(BOT_TOKENS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')

export function isBotUserAgent(userAgent: string): boolean {
  return BOT_UA.test(userAgent)
}
