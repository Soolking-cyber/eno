import { NextResponse } from 'next/server'
import { SITE_NAME } from '@/lib/edition'

/**
 * Shared plumbing for the three markdown representations under src/app/md/*.
 *
 * ── WHAT THIS IS FOR ────────────────────────────────────────────────────────────────────────────
 * acceptmarkdown.com content negotiation: an agent that sends `Accept: text/markdown` to `/`,
 * `/privacy` or `/terms` gets markdown instead of a 300KB React shell it has to strip tags out of.
 * A `page.tsx` and a `route.ts` cannot occupy the same path, so the markdown lives here at its own
 * internal path and `rewrites()` in next.config.ts routes the negotiated request to it. Read the
 * ACCEPT_MARKDOWN block in that file before touching the matching — the one thing that must never
 * happen is a browser being handed markdown.
 */

/**
 * ⚠️ SAME DERIVATION AS src/app/llms.txt/route.ts:30 AND src/app/layout.tsx, DELIBERATELY.
 * next.config.ts asserts NEXT_PUBLIC_APP_URL matches the edition, so this is the one value
 * guaranteed to describe THIS deployment. Hardcoding eno.vn here would reintroduce exactly the bug
 * that moved llms.txt off `public/`: eno.forum introducing itself with the licensed marketplace's
 * domain in the one document written for machines.
 *
 * ⛔ THE FALLBACK IS `https://${SITE_NAME}`, NOT THE LITERAL 'https://eno.vn'. The first draft of
 * this file hardcoded eno.vn one line below the comment forbidding it. It is reachable: vitest
 * pins NEXT_PUBLIC_ENO_EDITION='services' and deliberately does NOT pin NEXT_PUBLIC_APP_URL, and
 * src/lib/edition.ts folds an absent edition to 'services' — so a bare `next dev` or a test run
 * produced `# Privacy Policy — eno.forum` whose every link pointed at https://eno.vn/privacy. One
 * machine-readable legal document naming the services edition in its title and the licensed
 * marketplace as the source of its binding text. SITE_NAME is build-time-inlined, so the two
 * halves can no longer disagree.
 */
export const SITE_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`

/**
 * ⛔ `no-store` IS THE SAFETY MECHANISM, NOT A PERFORMANCE OVERSIGHT — DO NOT "OPTIMISE" IT.
 *
 * These bytes are served from the SAME URL as the HTML page (`/`, `/privacy`, `/terms`); only the
 * request's Accept header separates them. A shared cache that stored this response under the key
 * `/` would go on to serve markdown to every browser that asked for the home page. That is the
 * catastrophic direction of this feature, and a cacheable markdown response is the shortest path
 * to it.
 *
 * ⛔ DO NOT RESTORE THE CLAIM THAT "Cloudflare's cache key does not include Accept". It was in the
 * first draft and it is FALSE ON THESE ZONES. Read from the Cloudflare API 2026-08-23, the live
 * rule "cache public HTML at edge (home + legal)" on both eno.vn and eno.forum carries
 * `"vary": {"default": {"action": "normalize"}}` — Vary handling is explicitly ON.
 *
 * `Vary: Accept` is emitted anyway because it is the honest and correct statement of what varies —
 * a well-behaved intermediary and the browser's own cache both act on it, and the acceptmarkdown
 * scanner explicitly measures its absence ("Vary header missing Accept"). It is belt; `no-store` is
 * braces, and braces are what is actually holding this up.
 *
 * ✅ THERE IS A THIRD ACTOR THIS FILE CANNOT REACH, AND IT IS ALREADY HANDLED — DONE, NOT PENDING.
 * The Cloudflare Cache Rule "cache public HTML at edge (home + legal)" matches `/`, `/privacy` and
 * `/terms` and caches them at the edge. A markdown request would match it too, so the edge would
 * answer from the CACHED HTML and this route would never run — negotiation working in local preview
 * and silently dead in production. The rule expression on BOTH zones therefore carries:
 *     and not any(http.request.headers["accept"][*] contains "markdown")
 * Applied and verified by read-back on 2026-08-23 (zones 55e558b6… and cc81e3ff…), then verified on
 * the wire: `text/markdown`, `text/x-markdown` and `application/markdown` all answer
 * `cf-cache-status: DYNAMIC` while a real Chrome Accept string still answers `HIT`.
 *
 * ⚠️ THE SUBSTRING IS `markdown`, NOT `text/markdown`. An earlier draft of THIS COMMENT documented
 * the narrower clause while next.config.ts documented the wider one — two files giving an operator
 * contradictory instructions, which a reviewer caught. Following the narrow version would leave
 * `text/x-markdown` and `application/markdown` matching the cache rule, i.e. negotiation dead for
 * exactly the media types the fallback exists to serve.
 * ⛔ It cannot be made case-insensitive: Cloudflare rejects `lower()` on a header ARRAY. An
 * uppercase `Accept: TEXT/MARKDOWN` therefore still matches the cache rule — fail-SOFT (that client
 * may get cached HTML), and the dangerous direction is held by the `no-store` above, not by the rule.
 */
export function markdownResponse(body: string): NextResponse {
  return new NextResponse(body, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      vary: 'Accept',
      'cache-control': 'no-store',
      /**
       * ⛔ NO `x-robots-tag: noindex` HERE, AND THE FIRST DRAFT HAD ONE. The reasoning that put it
       * there ("markdown is a representation, not a document, so keep it out of the index") is
       * right about the intent and catastrophically wrong about the mechanism: this response is
       * served from the SAME URL as the home page, so a noindex on it is a noindex on `/`. If any
       * crawler ever negotiates markdown — and the whole point of shipping this is that agents
       * will — the instruction it reads is "deindex eno.vn's home page".
       *
       * ⛔ THE FIRST DRAFT JUSTIFIED THIS WITH "There is no separate URL that could be indexed as a
       * duplicate". THAT IS FALSE and a reviewer caught it: `/md/home`, `/md/privacy` and
       * `/md/terms` are ordinary App Router routes, so `GET /md/home` with NO Accept header returns
       * 200 text/markdown directly — three crawlable duplicates per edition. The duplicate is real;
       * the header is still the wrong tool for it, because this one response object serves BOTH the
       * direct URL and the negotiated `/`. The duplicate is handled where it can be aimed at only
       * the direct URLs: `Disallow: /md/` in src/app/robots.txt/route.ts.
       */
    },
  })
}
