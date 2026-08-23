import { GET as llmsTxt } from '@/app/llms.txt/route'
import { markdownResponse } from '../markdown-response'

/**
 * `/index.md` — the markdown index of this site, reached by an `afterFiles` rewrite in
 * next.config.ts (`/index.md` -> `/md/index`).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 * nginx's log for the 2026-08-23T11:39Z agent-audit scan shows `/index.md` fetched 15 times, all
 * 404, in the same sweep as `/agents.md` (15) and `/auth.md` (14). The convention the auditor is
 * probing for is a markdown table of contents at a guessable path.
 *
 * ── WHY IT RE-SERVES /llms.txt RATHER THAN HAVING ITS OWN PROSE ─────────────────────────────────
 * Two reasons, and the second one is the load-bearing one.
 *
 * 1. llms.txt ALREADY IS THAT DOCUMENT. Read it: `# heading`, `> summary`, then `## Key pages`,
 *    `## Categories`, `## For developers and agents`, `## Data feeds`, `## Notes` — a linked index
 *    of the site, in markdown, written for exactly this reader. Only its `content-type` says
 *    text/plain, because that is what the llms.txt convention asks for. This route changes the
 *    content type and nothing else. Same mechanism, and the same reasoning, as `/md/home`.
 *
 * 2. ⛔ A HAND-WRITTEN INDEX HERE WOULD BE A LICENSING DEFECT WAITING TO HAPPEN. The site's
 *    description of itself FORKS BY EDITION — eno.vn is a licensed sàn TMĐT and may not describe
 *    visa, itinerary or PayPal surfaces; eno.forum must. llms.txt solves that fork already, and it
 *    solves it the only safe way: the services copy comes from `@/lib/edition-services-copy`, which
 *    `turbopack.resolveAlias` stubs out on a marketplace build, so those sentences are not merely
 *    hidden but ABSENT from eno.vn's artifact. Retyping an index in this file would mean either
 *    forking it here a second time (one edit away from the two disagreeing, which is precisely the
 *    bug that moved llms.txt off `public/`) or typing services vocabulary inline — the trap
 *    documented at the top of src/app/sitemap.xml/route.ts, which happened there and shipped.
 *
 * So `/index.md`, `/md/home` and `/llms.txt` are BYTE-IDENTICAL by construction. There is nothing
 * to keep in sync because there is only one document.
 *
 * ── ON DUPLICATE CONTENT, WHICH IS A REAL QUESTION AND HAS A DELIBERATE ANSWER ──────────────────
 * `src/app/robots.txt/route.ts` carries `Disallow: /md/`, and it is there because `/md/home`, `/md/privacy`
 * and `/md/terms` are directly fetchable URLs whose content ALSO lives at an indexable HTML page —
 * `/`, `/privacy`, `/terms`. Those three compete with the canonical page for the same query. That
 * Disallow covers `/md/index` too, automatically, and should keep doing so.
 *
 * ⛔ IT MUST NOT BE EXTENDED TO `/index.md` ITSELF, AND THAT IS NOT AN OVERSIGHT. Its twin is
 * `/llms.txt`, which is `Allow`ed on purpose and is not an HTML page: neither URL competes with a
 * canonical document, and both exist to be FOUND by machines. Disallowing the agent-discovery
 * documents in robots.txt to protect a text/plain file nobody ranks would defeat the entire reason
 * this change exists — the audit's finding was that we publish capabilities nothing points at.
 * If a duplicate ever does surface in Search Console, the aimed tool is a `Link:
 * <…/llms.txt>; rel="canonical"` response header on THIS route only, not a robots rule that also
 * blinds every agent.
 *
 * ⚠️ AND NOT `x-robots-tag: noindex` EITHER — see markdownResponse's comment. That header is
 * emitted by the shared helper that also serves the NEGOTIATED response at `/`, so adding one there
 * would deindex the home page. Any per-route header work belongs on the route, not in the helper.
 */

/**
 * ⚠️ EXPLICIT, NOT INHERITED — the same note as `/md/home`. The safety of every markdown route
 * rests on `no-store` (these bytes can be served from the same URL as an HTML page), and Next
 * leaving GET handlers uncached by default is exactly the kind of framework default that changes
 * under you in a major bump.
 * ⚠️ Only `GET` is imported from llms.txt. Re-exporting its `revalidate` would silently give this
 * route that route's 24h caching, which is what `markdownResponse` refuses to have.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  // llmsTxt() builds a fresh NextResponse per call, so consuming the body stream here cannot
  // starve a concurrent request for /llms.txt itself.
  const body = await llmsTxt().text()
  return markdownResponse(body)
}
