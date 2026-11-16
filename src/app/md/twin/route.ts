import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { markdownTwin, TWIN_DENY } from '@/lib/markdown-twin'
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
const PER_IP_PER_MIN = 30

const notFound = () => new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get('p') ?? ''
  // The rewrite only sends allowed pages; this repeats the hard part of that rule for a direct /md/twin?p= request.
  const first = p.split('/')[0]
  // ONLY a root page on the build's allowlist (next.config.ts twinRoots → env ENO_TWIN_ROOTS): never a storefront
  // handle, en/ or vi/ (the internal [lang] tree), or anything TWIN_DENY names. No list at all → nothing (fail closed).
  const roots = new Set((process.env.ENO_TWIN_ROOTS ?? '').split(',').filter(Boolean))
  if (!PATH.test(p) || p.length > 200 || p.endsWith('/') || !roots.has(first) || TWIN_DENY.has(first)) return notFound()
  const limit = await rateLimit('md-twin-ip', clientIp(req), PER_IP_PER_MIN, '1 m')
  if (!limit.success) {
    return new NextResponse('Too many requests', { status: 429, headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '60' } })
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
  const md = markdownTwin(await res.text(), pageUrl, SITE_ORIGIN)
  if (!md) return notFound()
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
