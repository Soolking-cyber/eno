/**
 * Is this user-agent a crawler rather than a person?
 *
 * ⛔ ITS OWN MODULE, AND site-stats-shared.ts IS THE WRONG PLACE FOR IT — a reviewer moved it here
 * and the reason is the same one written at the top of that file. `site-stats-shared` exists so
 * the FOOTER WIDGET can import a type and two numbers without dragging the server in; it is in the
 * client bundle of every page on the site. This list is ~50 crawler names that only the server ever
 * reads, and shipping it to every human visitor is exactly the bloat that split was made to stop.
 * It cannot live in site-stats.ts either — that module pulls `node:crypto` and Prisma at the top
 * level, which would make this untestable without them. So: its own file, no imports, and kept out
 * of every first-load bundle.
 * ⚠️ ONE CLIENT READER SINCE 2026-10-01, AND IT IMPORTS THIS LAZILY: the "Join eno" prompt
 * (signup-prompt.tsx) must never ask a crawler, and `import()`s this module only at the moment the
 * prompt is due — a minute into a visit — so it is its own small chunk, never part of first load.
 * Keep it import-free so that stays cheap.
 *
 * ⛔ EVERY COUNTER A CRAWLER CAN REACH READS THIS, THROUGH `isBotRequest` (2026-10-03). The footer
 * counters were guarded on 2026-09-17 and the LISTING VIEW counter was not — and it is the number a
 * seller reads. Cloudflare, 2026-10-02 (~/eno-wb1-backup/plan/edge-5xx-investigation-2026-10-03.md):
 * `meta-externalagent` made ~130k requests that day, 58% of all visitor traffic, and fired ~6.9k
 * POSTs at /api/listings/[id]/view, /api/site-stats and /api/csp-report, because it renders pages and
 * so runs <TrackView>'s effect like any browser. The readers now: listings/[id]/view (Listing.views),
 * site-stats (before its limiter as well as in recordAndRead), and forum/posts/[id] GET
 * (ForumPost.viewCount, which orders the Help Centre's popular answers and is a plain GET any
 * crawler can fetch). Saves and contact reveals are left alone: a save needs a device-local tap and a
 * reveal needs a session, so neither is a page load a renderer makes.
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
 * ⚠️ THE TWO POSTS ONLY EVER SEE CRAWLERS THAT RUN JAVASCRIPT. The heartbeat and the view beacon are
 * POSTs issued by React effects, so curl, a plain Googlebot fetch, an uptime probe and every
 * non-rendering scraper were never counted by them in the first place. The forum post GET is the
 * exception — any client can fetch it — and is why the self-declaring HTTP clients below earn
 * their place rather than merely costing nothing.
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
 * ⚠️ RENDERERS FIRST, BECAUSE THEY ARE WHAT REACHES A POST. The heartbeat and the view beacon only
 * fire from a page that ran its JavaScript, so a non-rendering fetcher never counted there; `curl`,
 * `python-requests` and friends matter for the forum GET (any client can fetch it) and otherwise
 * cost nothing to honour.
 */
const BOT_TOKENS = [
  // The one measured in our own logs, and its stablemates. ⚠️ NOT `facebook`/`fban`/`fb_iab`: the
  // Facebook, Messenger and Instagram IN-APP browsers (`[FBAN/FBIOS;FBAV/…]`, `[FB_IAB/FB4A;…]`)
  // are where a real person lands after tapping a shared listing — bot-ua.test.ts pins them as
  // people. Only Meta's declared agents go here.
  'meta-externalagent', 'meta-externalfetcher', 'meta-webindexer', 'facebookexternalhit', 'facebookcatalog',
  'facebookbot',
  // Search + SEO. `coccocbot` is Vietnam's own engine; its BROWSER is `coc_coc_browser`, which this
  // token does not match (pinned in the test — that browser is a large share of VN desktops).
  'googlebot', 'google-inspectiontool', 'googleother', 'storebot-google', 'adsbot-google',
  'mediapartners-google', 'bingbot', 'bingpreview', 'msnbot', 'adidxbot', 'yandexbot', 'duckduckbot',
  'baiduspider', 'coccocbot', 'applebot', 'petalbot', 'seznambot', 'ahrefsbot', 'ahrefssiteaudit',
  'semrushbot', 'siteauditbot', 'mj12bot', 'dotbot', 'dataforseobot', 'blexbot', 'barkrowler', 'serpstatbot',
  // AI crawlers. ⚠️ NOT `bytedance`: TikTok's in-app browser carries `BytedanceWebview/…` and is a
  // person; `bytespider` is the crawler and the only ByteDance token here.
  'gptbot', 'oai-searchbot', 'chatgpt-user', 'claudebot', 'claude-web', 'claude-user', 'claude-searchbot',
  'anthropic-ai', 'perplexitybot', 'perplexity-user', 'duckassistbot', 'amazonbot', 'bytespider', 'ccbot',
  'google-extended', 'diffbot', 'youbot', 'timpibot', 'imagesiftbot',
  // Link unfurlers. ⛔ `whatsapp` WAS HERE AND CAME STRAIGHT BACK OUT (reviewer, same round as the
  // Cubot finding). WhatsApp's unfurler is `WhatsApp/2.x` — but so is the in-app browser a real
  // person lands in after tapping a shared link, on a messenger this market actually uses. The
  // unfurler cannot run JavaScript, so it never reaches this endpoint in the first place: the token
  // bought nothing and risked exactly the silent false positive this list is shaped to avoid.
  'twitterbot', 'slackbot', 'discordbot', 'telegrambot', 'linkedinbot', 'pinterestbot',
  'skypeuripreview', 'embedly', 'iframely',
  // Headless/synthetic browsers and the clients that declare themselves.
  'headlesschrome', 'phantomjs', 'puppeteer', 'playwright', 'lighthouse', 'chrome-lighthouse',
  // PageSpeed Insights runs Lighthouse (`Chrome-Lighthouse`, above); its older agent named itself.
  'google page speed',
  // ⚠️ `headlesschrome`/`playwright`/`lighthouse` also match THIS REPO'S OWN e2e and CI runs, which
  // is intended and currently costless: nothing under e2e/ asserts the footer counters or a
  // listing's view count (grepped again 2026-10-03). If a suite ever does, it will see zeros — give
  // that test a normal user-agent rather than reopening this list.
  'pingdom', 'uptimerobot', 'statuscake', 'python-requests', 'curl', 'wget', 'go-http-client', 'scrapy',
  // Generic self-declarations. ⚠️ `crawler`/`spider` are safe as substrings (no consumer device
  // name contains either); `bot` on its own is NOT, which is the whole note above.
  'crawler', 'crawling', 'spider', 'slurp',
] as const

const BOT_UA = new RegExp(BOT_TOKENS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')

export function isBotUserAgent(userAgent: string): boolean {
  return BOT_UA.test(userAgent)
}

/**
 * The counter guard: may this request move a count? `false` for a declared crawler — and for a
 * request with NO user-agent at all, which no browser sends (every browser stamps one on fetch and
 * sendBeacon, the native shell's WebView included). Only counter writers use this; the signup
 * prompt keeps `isBotUserAgent`, where an empty string is not evidence of anything.
 *
 * ⛔ A BOT STILL GETS ITS ORDINARY 2xx. Callers skip the WRITE, never the answer: a 4xx/5xx here is
 * a crawl error in Search Console and a red line in a renderer's log, for a request that did
 * nothing wrong but exist.
 */
export function isBotRequest(req: { headers: Headers }): boolean {
  const ua = req.headers.get('user-agent')
  return !ua || !ua.trim() || BOT_UA.test(ua)
}
