import { NextResponse } from 'next/server'
import { SITE_NAME } from '@/lib/edition'

/**
 * /robots.txt — served by a ROUTE, not from public/, and the reason is a leak that was LIVE.
 *
 * ⛔ public/robots.txt IS COPIED INTO BOTH BUILDS VERBATIM, so its last line —
 * `Sitemap: https://eno.vn/sitemap.xml` — was served by eno.forum too. Measured on production
 * 2026-08-23: `curl https://www.eno.forum/robots.txt` ended with the licensed marketplace's
 * sitemap. The services deployment was directing every crawler that reads its robots.txt to
 * enumerate eno.vn's URLs, from the one file whose entire job is to tell crawlers what THIS site
 * contains.
 *
 * ⚠️ THIS IS THE SIXTH INSTANCE OF THE SAME DEFECT CLASS, and the fix is always the same one:
 * static llms.txt (moved here for this reason), the OpenAPI title, the developers page, an
 * ApiStatus description, and the MCP server's own `serverInfo.name`. Anything in `public/` that
 * names a host is wrong on one of the two editions by construction. A route can read the edition;
 * a file cannot.
 *
 * ⚠️ EVERYTHING ELSE IS BYTE-FOR-BYTE THE PREVIOUS FILE, deliberately — the Disallow list, the
 * AI-crawler groups and their comments all carry reasoning that was expensive to establish (see
 * the note about /messages and /saved carrying meta-noindex, and the `Allow: /api/v1/status`
 * exception). Only the Sitemap lines vary.
 *
 * ⛔ NO `schemamap:` LINE (owner, 2026-11-19: Lighthouse SEO 100 over ora's 1-point nlweb-schema-feeds check). Lighthouse
 * fails robots.txt on any line it does not know, and this one took SEO from 100 to 92 (PageSpeed, phone and desktop,
 * 2026-11-19). The Schema Map stays at /schemamap.xml, linked from /llms.txt. Re-add the line only once Lighthouse knows
 * the directive, as it learned content-signal in 13.2.
 *
 * ⚠️ THREE SITEMAP LINES SINCE 2026-11-27. Two since 2026-10-18 (teacher visibility plan): /sitemap.xml (an index then; one
 * flat urlset while the site is small since 2026-11-18, src/app/sitemap.xml/build.ts), and the page sitemap it lists — which
 * holds the guides, the hub and every landing. Measured in Cloudflare's sampled logs over 7 days: Claude-SearchBot fetched
 * /sitemap.xml 93 times and /sitemaps/pages.xml never. Google's robots.txt spec allows several Sitemap lines.
 * ⛔ /sitemaps/vi.xml FIRST (2026-11-27, owner): the Vietnamese pages of pages.xml (src/app/sitemaps/vi.xml/build.ts) for
 * Cốc Cốc, which reads a sitemap only from these lines and crawls a few hundred pages a day — it had indexed 1,262 English
 * listing pages and 4 of the 40 Vietnamese guides. Every URL in it is also in the two after it.
 */

const SITE_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`

const BODY = `# Public marketplace pages (home, listings, categories, seller storefronts, SEO
# landings) are crawlable. Private/app/API paths are not — and consolidating to a
# single group closes a leak where named bots (Googlebot/Bingbot) previously had
# no Disallow and could crawl /admin.
# Auth-gated app pages (/signin /onboard /post /account /saved /dashboard
# /messages) are deliberately NOT disallowed: they each carry a noindex directive,
# and a Disallow would block crawlers from ever SEEING it — the URLs could then
# linger in the index as "indexed, though blocked by robots.txt".
#
# ⚠️ TWO MECHANISMS, NOT ONE, AND THIS COMMENT USED TO CLAIM OTHERWISE. It said all of
# them "carry meta noindex". Measured on production 2026-07-27, /messages,
# /messages/ai, /messages/pending and /saved carried NO robots meta at all — they are
# client components and cannot export metadata, so they were returning 200, indexable,
# wearing the homepage's title. They now carry an 'X-Robots-Tag: noindex, nofollow'
# RESPONSE HEADER instead, set in next.config.ts. So, precisely:
#   · meta noindex  — /signin, /onboard, /post, and every /dashboard/* section page
#   · X-Robots-Tag  — /messages/:path*, /messages, /saved  (next.config.ts headers())
#   · redirects     — /account and /dashboard, which only 30x into the pages above
# The premise this file's Disallow policy rests on holds either way: a header is as
# invisible to a crawler that was never allowed to fetch the URL as a meta tag is.
# Verify a claim here against next.config.ts before repeating it — the whole reason the
# gap survived is that the comment sounded authoritative.
# Sensitive trust/ops surfaces (/disputes /appeal /reports /unsubscribe) get the
# opposite call: keeping crawlers out entirely outweighs that trade-off there.
# The AI crawlers named below share THIS group and its rules (2026-11-18: agent-readiness scanners ask for them by
# name). Never give one a group of its own: a crawler obeys only the most specific group that names it (RFC 9309),
# so its own group would drop every Disallow line below for it.
User-agent: *
User-agent: GPTBot
User-agent: ClaudeBot
User-agent: ChatGPT-User
User-agent: OAI-SearchBot
User-agent: Claude-SearchBot
User-agent: PerplexityBot
User-agent: Google-Extended
Allow: /
# Content Signals (contentsignals.org; IETF draft-romm-aipref-contentsignals): the policy the groups in
# this file already enforce, stated as a preference. search=yes and ai-input=yes: search and AI answer
# engines may use the public pages, as this group allows. ai-train=yes (owner 2026-11-17: "allow these too" — Bytespider,
# ClaudeBot, CCBot, GPTBot and Meta-ExternalAgent, then "training yes"): the public pages may train models too. Unlike
# 'Agentmap:' (see below), Lighthouse accepts this line: 'content-signal' is in its robots.txt safelist since 13.2, and
# PageSpeed ran 13.6.0 on 2026-11-16.
Content-Signal: search=yes, ai-input=yes, ai-train=yes
Disallow: /admin
Disallow: /api
# ⛔ …EXCEPT THE ONE API PATH THAT EXISTS FOR CRAWLERS AND AGENTS. /api/v1/status needs no
# credential; it returns the edition, the API version, links to the spec and the OAuth metadata,
# and live 'RateLimit' headers so an agent can see the throttle before it has a key. It was added
# specifically so an anonymous auditor could verify those headers on a real response — and then
# 'Disallow: /api' above forbade every compliant one from fetching it, which a reviewer caught.
# ⚠️ Allow must be MORE SPECIFIC than the Disallow it overrides: robots.txt precedence is
# longest-match-wins (RFC 9309 §2.2.2), so this 16-character rule beats the 4-character one.
Allow: /api/v1/status
# …and the two the home page fills its later rows from (2026-11-17, the home slimming: the server sends those rows' cards
# as ids). A renderer that may not fetch them — Googlebot's — would see placeholders where it used to see the listings.
# Both are public, read-only card lists (browser-cached; Cloudflare does not cache them).
Allow: /api/category-rails
Allow: /api/home/cards
# ⛔ /md/* ARE THE MARKDOWN REPRESENTATIONS OF '/', '/privacy' AND '/terms', AND THEY ARE REAL,
# DIRECTLY FETCHABLE URLs — not merely internal rewrite destinations. 'GET /md/home' with no Accept
# header returns 200 text/markdown carrying the same content as the home page. Without this line
# they are three crawlable duplicate-content URLs per edition. They deliberately do NOT carry
# 'x-robots-tag: noindex' instead: the same handler serves the NEGOTIATED response at '/', so a
# noindex header on it would be a noindex on the home page itself. See the comment in
# src/app/md/markdown-response.ts.
Disallow: /md/
# ⛔ THE AGENT-DISCOVERY DOCUMENTS ARE DELIBERATELY *NOT* DISALLOWED — /agents.md, /auth.md,
# /index.md, /llms.txt and /.well-known/ai-catalog.json. Read the rule above precisely before
# "consistently" adding them: 'Disallow: /md/' exists because /md/home, /md/privacy and /md/terms
# duplicate an INDEXABLE HTML PAGE ('/', '/privacy', '/terms') and would compete with the canonical
# document for the same query. It now also covers /md/agents, /md/auth and /md/index automatically,
# which is correct — those three are the internal rewrite destinations, and the canonical URLs are
# the dotted ones a client actually fetches.
# The dotted URLs have no HTML twin. /agents.md and /auth.md exist nowhere else; /index.md is
# byte-identical to /llms.txt, which is already crawlable on purpose and is not a page anything
# ranks. Neither competes with a canonical document, and both exist to be FOUND by a machine —
# blocking them to tidy up a duplicate of a text/plain file would defeat the entire reason they were
# published. The 2026-08-23 agent audit's finding was that this deployment runs capabilities nothing
# points at; a Disallow here would recreate that by hand. If a duplicate ever surfaces in Search
# Console, the aimed tool is a 'Link: <…/llms.txt>; rel="canonical"' header on /index.md alone.
# ⚠️ AND NOT 'x-robots-tag: noindex' EITHER — see src/app/md/markdown-response.ts. That helper also
# serves the NEGOTIATED response at '/', so a noindex there is a noindex on the home page.
Disallow: /disputes
Disallow: /appeal
Disallow: /reports
Disallow: /unsubscribe

# Pure-scraper and dataset crawlers that ingest our content (incl. listing photos) but send no traffic back — blocked
# entirely. ⛔ CCBot and Bytespider are NOT here since 2026-11-17 (owner: "allow these too"): with GPTBot, ClaudeBot and
# Meta-ExternalAgent they fall under "User-agent: *" — public pages, ai-train=yes. ⛔ Nor Diffbot (its Knowledge Graph feeds
# AI answers) and ImagesiftBot since 2026-11-25 (Seobility's AI-bot check, "AI Bots Blocked: Diffbot, ImagesiftBot"; the
# owner: "also address these") — the same decision as CCBot's. AI *search / answer* crawlers
# (OAI-SearchBot, Claude-SearchBot, ChatGPT-User, PerplexityBot, Applebot, Bingbot, and Meta/social
# link-preview bots) are intentionally NOT listed here, so they fall under
# "User-agent: *" above and keep indexing public pages — ${SITE_NAME} stays
# discoverable in search AND in AI answers.
# Google-Extended is named in the first group, with its rules, and it is not a search crawler: it is a
# control token with no user agent of its own (Google fetches as Googlebot). Per
# Google's documentation it governs Gemini model TRAINING as well as grounding in
# Gemini Apps and Vertex AI, and does not affect inclusion in Google Search. Both
# uses are allowed, as ai-train=yes says.
User-agent: img2dataset
User-agent: Omgilibot
Disallow: /

# ⛔ NO TRAINING-CRAWLER GROUP ANY MORE (owner, 2026-11-17: "allow these too", "robots.txt blocks: anthropic-ai", then
# "also anthropic-ai Applebot-Extended allow"). The 2026-11-16 "Brand pages only" group held GPTBot, ClaudeBot,
# anthropic-ai, Applebot-Extended and Meta-ExternalAgent to the pages about ${SITE_NAME}; all five now read the public pages
# under "User-agent: *", where Content-Signal says ai-train=yes. The private paths above stay closed to them as to everyone.
# What the old group kept from training, and is now open by that decision: the home feed's listings and photos (68
# listings, ~360 photo URLs on 2026-11-16) and the teacher-profile photo rails under /teach-in-vietnam/<article>.
#
# ⛔ NO 'Agentmap:' DIRECTIVE HERE. IT WAS ADDED 2026-08-23 AND REMOVED THE SAME DAY, BECAUSE
# LIGHTHOUSE FAILS THE FILE ON IT.
# The ARD spec (agenticresourcediscovery.org/spec, v0.9) lists four ways to advertise a catalogue:
# the well-known URI, an HTML <link rel="ai-catalog">, a DNS SVCB record, and an 'Agentmap:' line
# here. Adding the line looked free once this file became a route (an absolute URL is safe when
# ${SITE_ORIGIN} is edition-derived). It is not free: Lighthouse SEO reported
#   "robots.txt is not valid — 1 error found · line 94 · Agentmap: … · Unknown directive"
# and dropped the SEO score to 92. That is Lighthouse's validator, not Google's parser: Google's
# robots.txt documentation says it ignores invalid lines and uses only the valid ones, so the
# Disallow rules would have kept working. The line stays out because the validator flags it and
# the catalogue is already discoverable without it — not because it would break crawling.
# ⚠️ THE TRADE IS THE WHOLE LESSON: ~1.7 points of agent-readiness against a validator error on the
# file that governs how the entire site is crawled. The well-known URI at
# ${SITE_ORIGIN}/.well-known/ai-catalog.json is the primary mechanism, it already works, and every
# ARD client checks it. Do not re-add this for a score.
# The Vietnamese pages first: every URL in this one is also in the two below.
Sitemap: ${SITE_ORIGIN}/sitemaps/vi.xml
Sitemap: ${SITE_ORIGIN}/sitemap.xml
# The page sitemap is also named directly: /sitemap.xml lists every URL itself while the site is small, and becomes an index of its children once it is not.
Sitemap: ${SITE_ORIGIN}/sitemaps/pages.xml
`

export const revalidate = 86400

export function GET() {
  return new NextResponse(BODY, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600, s-maxage=86400',
    },
  })
}
