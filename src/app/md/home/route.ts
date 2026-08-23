import { GET as llmsTxt } from '@/app/llms.txt/route'
import { markdownResponse } from '../markdown-response'

/**
 * The markdown representation of `/`, reached by the Accept-header rewrite in next.config.ts.
 *
 * ── WHY THIS RE-SERVES /llms.txt RATHER THAN HAVING ITS OWN PROSE ───────────────────────────────
 * ⛔ THE HOME PAGE'S DESCRIPTION OF ITSELF IS EDITION-GATED, AND A SECOND COPY OF IT IS A LICENSING
 * DEFECT WAITING FOR SOMEONE TO EDIT ONE AND NOT THE OTHER. eno.vn may not describe visa, itinerary
 * or PayPal surfaces; eno.forum must. `src/app/llms.txt/route.ts` already solves exactly that
 * problem for exactly this audience — it exists because `public/llms.txt` was shared and hardcoded,
 * so eno.forum spent months introducing itself as "eno.vn, a trusted classifieds marketplace" to
 * every agent that asked. Writing a fresh marketing blurb here would recreate that bug in a new
 * file, one rewrite away from the same readers.
 *
 * So the body is not paraphrased, adapted or "kept in sync" — it is the SAME BYTES, produced by the
 * same function. There is nothing to drift.
 *
 * ⚠️ AND IT IS ALREADY MARKDOWN. llms.txt is an `# H1` + `> summary` + `## sections` document with
 * markdown links throughout; only its `content-type` says text/plain, because that is what the
 * llms.txt convention asks for. This route changes the content type and nothing else.
 *
 * ⚠️ YES, THIS IMPORTS ONE ROUTE MODULE FROM ANOTHER. That is unusual and it is the point: a route
 * file is a plain ES module, and importing its handler is the only way to reuse the body without
 * either duplicating the prose or editing a file outside this change's scope. The cleaner shape is
 * to lift MARKETPLACE_BODY / SERVICES_BODY into `src/lib/`, export them, and have both routes read
 * them; do that when someone next owns both files. Nothing here depends on this staying an import —
 * only on the bytes coming from one place.
 * ⚠️ Only `GET` is imported. Re-exporting llms.txt's `revalidate` would silently give this route
 * that route's caching, which is precisely what `markdownResponse` refuses to have (see its
 * no-store comment).
 */

/**
 * ⚠️ EXPLICIT, NOT INHERITED. The safety of this route rests on its `no-store` (see
 * markdown-response.ts): these bytes are served from the SAME URL as an HTML page, so anything
 * that stores them under that key serves markdown to browsers. Next 15+ leaves GET route handlers
 * uncached by default, which means `no-store` alone is enough TODAY — and that is precisely the
 * kind of framework default that changes under you in a major bump. Declaring it here makes the
 * guarantee local to the file whose comment claims it.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  // llmsTxt() builds a fresh NextResponse per call, so consuming the body stream here cannot
  // starve a concurrent request for /llms.txt itself.
  const body = await llmsTxt().text()
  return markdownResponse(body)
}
