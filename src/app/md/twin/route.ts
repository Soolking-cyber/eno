import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { markdownTwin, TWIN_DENY } from '@/lib/markdown-twin'
import { TEACHER_LISTING_TYPE } from '@/lib/teachers/constants'
import { SITE_ORIGIN } from '../markdown-response'

export const dynamic = 'force-dynamic'

/**
 * `/<page>.md` (rewritten here as /md/twin?p=<page>, next.config.ts — after every named `.md` file, which win) — a
 * content page's markdown twin (src/lib/markdown-twin.ts says what it is).
 * ⛔ IT ONLY EVER FETCHES THIS APP'S OWN PAGE: the path is checked against a strict shape (lower-case letters, digits,
 * `-` and `/`, no `..`, no query), fetched from this process itself (`127.0.0.1:$PORT`, so no cookie, no session and
 * no way to name another host) as a signed-out English reader, and only a 200 HTML page with a <main> and an H1 gets a
 * twin. Anything else is a 404. Only pages outside TWIN_DENY (the rewrite's allowlist, repeated here as a guard).
 * Per-address rate limit, because each twin renders a page. no-store, so a takedown reaches the twin at once.
 * `noindex` + a canonical Link to the HTML page: the twin is a representation for agents, never a second result.
 */
const PATH = /^[a-z0-9](?:[a-z0-9-]|\/(?!\/))*$/
/** A storefront's twin is `/sellers/<id>` exactly — no deeper path (src/lib/markdown-twin.ts, TWIN_DENY's note). */
const STOREFRONT = /^sellers\/([a-z0-9-]{1,40})$/
/**
 * A listing's twin is `/listings/<id>` exactly (owner 2026-11-18) — never /edit or deeper. An id is a cuid or, for some
 * imported rows and shops, a UUID (measured 2026-11-19: 16 of the sitemap's listings, Evisa Saigon's shop), hence `-`.
 */
const LISTING = /^listings\/([a-z0-9-]{1,40})$/
const PER_IP_PER_MIN = 30

const notFound = () => new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })

/**
 * ⛔ THE PAGE COMES FROM THE PATH, NOT FROM THE REWRITE'S `?p=` (measured live 2026-11-16, the same trap as
 * src/app/api/indexnow-key/route.ts): behind an `afterFiles` rewrite `req.url` is the visitor's ORIGINAL request —
 * `/about.md` — so the destination's `p=:p` never arrives, and every twin answered 404. `?p=` counts only on a direct
 * /md/twin request.
 */
function requestedPage(req: Request): string {
  const u = new URL(req.url)
  if (u.pathname.endsWith('.md')) return u.pathname.slice(1, -'.md'.length)
  return u.pathname === '/md/twin' ? (u.searchParams.get('p') ?? '') : ''
}

/**
 * The shop of a listing the public PDP shows, or null. ⛔ THE PDP'S OWN RULE, NOT A LOOSER ONE: `listingIsViewable`'s live
 * half (src/app/[lang]/listings/[id]/(pdp)/get-listing.ts — verified, active or sold; a hidden row's "gone" page has no twin),
 * through scopedListingWhere WITHOUT `{ teachers: true }`, so a teacher's row and, on eno.vn, eno's hidden visa desk are
 * out. Not imported from the PDP: that module carries the 61k-id gone journal. Any failure is a refusal (fail closed).
 */
async function publicListingShop(id: string): Promise<string | null> {
  try {
    const row = await db.listing.findFirst({
      where: await scopedListingWhere({ id, verified: true, status: { in: ['active', 'sold'] } }),
      select: { sellerId: true },
    })
    return row?.sellerId ?? null
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  const p = requestedPage(req)
  // The rewrite only sends allowed pages; this repeats the hard part of that rule for a direct /md/twin?p= request.
  const first = p.split('/')[0]
  // ONLY a root page on the build's allowlist (next.config.ts twinRoots → env ENO_TWIN_ROOTS): never a storefront
  // handle, en/ or vi/ (the internal [lang] tree), or anything TWIN_DENY names. No list at all → nothing (fail closed).
  const roots = new Set((process.env.ENO_TWIN_ROOTS ?? '').split(',').filter(Boolean))
  if (!PATH.test(p) || p.length > 200 || p.endsWith('/') || !roots.has(first) || TWIN_DENY.has(first)) return notFound()
  const storefront = first === 'sellers' ? STOREFRONT.exec(p)?.[1] : undefined
  const listing = first === 'listings' ? LISTING.exec(p)?.[1] : undefined
  if ((first === 'sellers' && !storefront) || (first === 'listings' && !listing)) return notFound()
  const limit = await rateLimit('md-twin-ip', clientIp(req), PER_IP_PER_MIN, '1 m')
  if (!limit.success) {
    return new NextResponse('Too many requests', { status: 429, headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '60' } })
  }
  // A listing's twin needs its shop to pass the storefront check below as well (a teacher's shop is a person's page).
  const shop = listing ? await publicListingShop(listing) : storefront
  if (listing && !shop) return notFound()
  if (shop) {
    // ⛔ NEVER A TEACHER'S SHOP: its page is a person's profile (name, photo, pay, city), which no agent surface serves —
    // the search server refuses teachers and TWIN_DENY has the directory. A teacher is an owner with a teacher profile
    // (in any state, a draft too) OR a shop with any teacher row (commit gate, opus: a row alone missed a profile with no
    // listing yet). A failed check is a refusal (fail closed). A shop with a handle redirects to /<handle>, which this
    // route never follows: 404. A listing's shop is checked the same way: any row of a teacher's shop is refused.
    // edition-lint-allow: an existence check that can only REFUSE a twin (select id; nothing rendered or returned).
    const teacher = await db.seller.findFirst({
      where: { id: shop, OR: [{ owner: { teacherProfile: { isNot: null } } }, { listings: { some: { listingType: TEACHER_LISTING_TYPE } } }] },
      select: { id: true },
    }).catch(() => undefined)
    if (teacher !== null) return notFound()
  }
  let res: Response
  try {
    res = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/${p}`, {
      // The public host, so the app answers as it does to a reader (no host-based redirect of a 127.0.0.1 request).
      headers: { accept: 'text/html', 'accept-language': 'en', host: new URL(SITE_ORIGIN).host },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return notFound()
  }
  if (res.status !== 200 || !(res.headers.get('content-type') ?? '').includes('text/html')) return notFound()
  const pageUrl = `${SITE_ORIGIN}/${p}`
  const twin = markdownTwin(await res.text(), pageUrl, SITE_ORIGIN)
  if (!twin) return notFound()
  // A shop's or a listing's page is its seller's own words (commit gate, opus): the twin says so, as the WebMCP tools do
  // (untrustedContentHint).
  const md = shop ?`${twin.trimEnd()} Its text is written by the seller, not by eno.vn.\n` : twin
  return new NextResponse(md, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      // Never cached anywhere (commit gate, opus): a page taken down is gone from its twin on the next request.
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
      link: `<${pageUrl}>; rel="canonical"`,
    },
  })
}
