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
 * exception). Only the Sitemap line varies.
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
User-agent: *
Allow: /
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

# AI-training + pure-scraper crawlers that ingest our content (incl. listing photos)
# but send no traffic back — blocked entirely. AI *search / answer* crawlers
# (OAI-SearchBot, ChatGPT-User, PerplexityBot, Google-Extended, Applebot, Bingbot,
# and Meta/social link-preview bots) are intentionally NOT listed here, so they fall
# under "User-agent: *" above and keep indexing public pages — ${SITE_NAME} stays
# discoverable in search AND in AI answers, while Cloudflare's AI Labyrinth traps any
# of these that ignore the rules below.
User-agent: GPTBot
User-agent: CCBot
User-agent: ClaudeBot
User-agent: anthropic-ai
User-agent: Bytespider
User-agent: ImagesiftBot
User-agent: img2dataset
User-agent: Diffbot
User-agent: Omgilibot
User-agent: Applebot-Extended
Disallow: /

# ✅ 'Agentmap:' IS SERVED HERE, AND IT ONLY BECAME POSSIBLE WHEN THIS FILE STOPPED BEING STATIC.
# The comment that used to sit here said the opposite — that the directive was deliberately omitted
# because it needs an ABSOLUTE url, and 'public/' is copied into both builds verbatim so any
# hostname written into it is wrong on one of the two deployments. That reasoning was correct, and
# it is exactly why this file moved into a route. Once it did, the constraint disappeared.
# The ARD spec (agenticresourcediscovery.org/spec, v0.9) lists four ways to advertise a catalogue:
# the well-known URI, an HTML <link rel="ai-catalog">, a DNS SVCB record, and an 'Agentmap:' line in
# robots.txt. We serve the well-known URI, and now that this file is a route it could serve the
# Agentmap directive too — an absolute URL is safe here because ${SITE_ORIGIN} is edition-derived.
Agentmap: ${SITE_ORIGIN}/.well-known/ai-catalog.json
Sitemap: ${SITE_ORIGIN}/sitemap.xml
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
