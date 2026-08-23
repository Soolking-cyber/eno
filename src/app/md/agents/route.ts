import { OAUTH_SCOPES } from '@/lib/api/oauth'
import { API_RATE_PER_MIN, API_RATE_WINDOW_SEC } from '@/lib/api/auth'
import { toolDescriptors } from '@/lib/mcp/tools'
import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { markdownResponse, SITE_ORIGIN } from '../markdown-response'

/**
 * `/agents.md` — what an agent can do on this deployment, reached by an `afterFiles` rewrite in
 * next.config.ts (`/agents.md` -> `/md/agents`).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 * nginx's log for the 2026-08-23T11:39Z agent-audit scan: `/agents.md` and `/index.md` fetched 15
 * times each, `/auth.md` 14, all 404. The audit sits at 95/100 and the gaps it prices are
 * discovery, not capability — `/api/mcp` has been a live MCP server for months with nothing
 * pointing at it.
 *
 * ── WHAT THIS SHAPE IS BASED ON, AND WHAT IT IS NOT ─────────────────────────────────────────────
 * ⚠️ THERE IS NO PUBLISHED SPEC FOR AN HTTP-SERVED `/agents.md`, AND ANYONE WHO TELLS YOU
 * OTHERWISE IS THINKING OF A DIFFERENT DOCUMENT. Checked 2026-08-23: agents.md (the convention with
 * 60k+ adopters) is a REPOSITORY file — "a dedicated, predictable place to provide context and
 * instructions to help AI coding agents work on your project" — read from a project directory by a
 * coding agent. Its own guidance is that it is "just standard Markdown, use any headings you like";
 * it says nothing whatsoever about serving the file over HTTP at a site root. So this document
 * borrows that convention's NAME and its "plain markdown, no schema" licence, and takes its
 * PURPOSE from llms.txt (llmstxt.org): tell a machine what is here and how to use it.
 *
 * ⛔ WHICH MEANS: DO NOT "FIX" THIS FILE TO MATCH A SCHEMA. If one is ever ratified, migrate
 * deliberately. Until then the only contract is that it is markdown, it is at a guessable path, and
 * every statement in it is true.
 *
 * ── THE ONE RULE THAT KEEPS THIS FILE LEGAL ─────────────────────────────────────────────────────
 * ⛔ IT DESCRIBES THE AGENT INTERFACE, NEVER THE CATALOGUE. eno.vn is a licensed Vietnamese
 * marketplace and may not show, link to or describe visa / itinerary / PayPal surfaces; eno.forum
 * may. This file compiles into BOTH editions, so a sentence about what is for sale would either
 * have to fork here (a second copy of a description that already forks in llms.txt, one edit away
 * from disagreeing) or ship services vocabulary inside eno.vn's bundle — the exact trap documented
 * at the top of src/app/llms.txt/route.ts and again in src/app/sitemap.xml/route.ts. So "what this
 * site sells" is answered with a LINK to /llms.txt, which already forks correctly, and everything
 * written here is edition-neutral: the API, the MCP server, auth, rate limits, negotiation and the
 * privacy rules are byte-identical on both hosts (curled, 2026-08-23).
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  /**
   * ⚠️ HARVESTED, NOT RETYPED — the same descriptors `tools/list` answers with on /api/mcp. A tool
   * added or renamed there changes this document with no second edit, which is the only way a
   * hand-written list of fifteen tools stays true for longer than a month.
   */
  const tools = toolDescriptors()

  const body = `# ${SITE_NAME} for agents

> A machine-readable guide to what an autonomous client can do on ${SITE_NAME}: what is open, what
> needs a credential, where the entry points are, and what is off limits.

**What this site is**, and when it is the right site to use, is in
[\`/llms.txt\`](${SITE_ORIGIN}/llms.txt). That document is the one place this deployment describes
its own catalogue; this one describes its interfaces.

## Without a credential

Everything here is public, unauthenticated and safe to fetch:

| Path | What it gives you |
| --- | --- |
| [\`/llms.txt\`](${SITE_ORIGIN}/llms.txt) | What this site is, its key pages and categories, its data feeds. |
| [\`/index.md\`](${SITE_ORIGIN}/index.md) | The same document as markdown. |
| [\`/api/v1/status\`](${SITE_ORIGIN}/api/v1/status) | Edition, API version, links to every document below, and live \`RateLimit\` headers — the throttle, before you have a key. |
| [\`/openapi.json\`](${SITE_ORIGIN}/openapi.json) | OpenAPI 3.1 for the whole Partner API. Also at \`/api/v1/openapi.json\`. |
| [\`/.well-known/ai-catalog.json\`](${SITE_ORIGIN}/.well-known/ai-catalog.json) | Agentic Resource Discovery catalogue: the callable and machine-readable resources — the API, the MCP server, the OAuth metadata and this file — in one document. (Human-facing and crawler-facing files like \`/sitemap.xml\` and \`/robots.txt\` are listed on this page but are not ARD resources.) |
| [\`/.well-known/oauth-authorization-server\`](${SITE_ORIGIN}/.well-known/oauth-authorization-server) | RFC 8414 metadata. |
| [\`/.well-known/oauth-protected-resource\`](${SITE_ORIGIN}/.well-known/oauth-protected-resource) | RFC 9728 metadata. |
| [\`/auth.md\`](${SITE_ORIGIN}/auth.md) | How to authenticate, in full. |
| [\`/sitemap.xml\`](${SITE_ORIGIN}/sitemap.xml) | Every public URL. |
| [\`/robots.txt\`](${SITE_ORIGIN}/robots.txt) | What may be crawled. It is binding — see below. |

Public listing, category, brand and storefront pages are crawlable HTML and need no account.
Browsing and searching never require sign-in.

## With a credential

Everything that touches a shop is authenticated. One credential acts for exactly one storefront and
only ever sees that storefront's data.

- **REST** — \`${SITE_ORIGIN}/api/v1\`. Listings (read, create, edit, delete, re-status), bulk
  import, catalogue sync by your own \`externalId\`, analytics, media upload, webhooks.
- **MCP** — \`${SITE_ORIGIN}/api/mcp\`. A stateless Model Context Protocol server over the
  Streamable-HTTP transport, wrapping the same shop-scoped operations. \`POST\` only; \`GET\`
  answers 405. Put the key in your MCP client's connection config as the Bearer token, never as a
  tool argument — the model then sees tool names, schemas and results, and never the credential.

### MCP tools

${tools.map((t) => `- \`${t.name}\` — ${t.description}`).join('\n')}

Call \`tools/list\` on the live server for the authoritative input schemas.

## Authentication in one paragraph

Send \`Authorization: Bearer eno_live_…\` — or exchange that key for a short-lived JWT at
\`POST ${SITE_ORIGIN}/api/v1/oauth/token\` (OAuth 2.0 client credentials) and send that instead.
Both work everywhere, including MCP. Scopes: ${OAUTH_SCOPES.map((s) => `\`${s}\``).join(', ')}. Keys
are issued in the dashboard under Developers, to business accounts. There is no sandbox and no test
key. Full detail: [\`/auth.md\`](${SITE_ORIGIN}/auth.md).

## Rate limits

- Authenticated: **${API_RATE_PER_MIN} requests per ${API_RATE_WINDOW_SEC}s per key**. A token
  shares its key's bucket.
- The token endpoint is throttled far harder — it is the credential-guessing surface. Its exact
  budget is stated in [\`/auth.md\`](${SITE_ORIGIN}/auth.md) §4; read it there rather than probing.
  A 429 carries \`Retry-After\` either way.
- Every authenticated response carries \`RateLimit\` headers, and a 429 carries \`Retry-After\`.
  Back off on both.

## Content negotiation

Send \`Accept: text/markdown\` to \`/\`, \`/privacy\` or \`/terms\` and you get markdown instead of
an HTML shell. \`text/x-markdown\` and \`application/markdown\` work too.

A path that matches **no route at all** (\`/nope/xyz\`) also negotiates: with \`Accept: text/markdown\`
it answers 404 with a short markdown body telling you where to look next.

⚠️ A **single-segment** path (\`/docs\`, \`/ask\`, \`/v1\`) does NOT. It matches this site's
username route, which returns a real 404 status but an empty body. The status code is always
honest — a 404 here never means "try again" and never means the page exists — but do not expect a
readable body from a one-segment miss. Use \`/llms.txt\`, \`/index.md\` or \`/sitemap.xml\` to find
real URLs instead of probing.

## Rules

- **\`/robots.txt\` is binding.** \`/admin\`, \`/api\` (except \`/api/v1/status\`), \`/md/\`,
  \`/disputes\`, \`/appeal\`, \`/reports\` and \`/unsubscribe\` are disallowed for every crawler.
  Several AI-training and scraper user-agents are disallowed entirely.
- **Contact details are never public.** Phone numbers and addresses are exchanged inside the in-app
  chat and appear on no listing page and in no API response you are not the owner of. If a task
  needs to reach a seller, the answer is "sign in and message them", never a scraped number.
- **Member-to-member deals have no checkout.** No escrow, no payment API, no order object between
  members${IS_SERVICES ? '; services the operator sells itself are the exception and are paid for on-site' : ''}. Buyers and sellers meet and
  settle directly, deliberately. An agent cannot buy anything here on a user's behalf.
- **Write access is your own shop only.** There is no API that mutates another seller's listings,
  and ownership is re-checked server-side on every write.

## Contact

Something wrong in this document, or a capability you need that is not here — the support address
for this deployment is on [\`/contact\`](${SITE_ORIGIN}/contact).
`

  return markdownResponse(body)
}
