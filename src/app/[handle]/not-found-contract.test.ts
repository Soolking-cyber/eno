import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ⛔ THE 404 CONTRACT FOR THE ROOT DYNAMIC SEGMENT — AND WHY HALF OF IT IS PINNED AS A DEFECT.
 *
 * `src/app/[handle]` is the root dynamic segment, so it doubles as the catch-all for every unknown
 * SINGLE-SEGMENT path. That is exactly the shape agent auditors probe. Read from nginx's access log
 * for one is-agentic scan window (2026-08-23T11:39Z): `/docs`, `/agents.md`, `/index.md`,
 * `/auth.md`, `/ask` — all single-segment, all landing on this page.
 *
 * MEASURED against the production build on 2026-08-23 (`curl` + a Chrome UA, identical results):
 *
 *   GET /docs             404, 56,294 bytes, **0 `<a href>`**, `<html id="__next_error__">`,
 *                         `<body>` with NO root-layout class — no header, no footer, no links.
 *   GET /help/nope-topic  404, 54,969 bytes, 0 anchors — same empty shell.
 *   GET /nope/xyz/abc     404, 98,031 bytes, **56 anchors** — src/app/not-found.tsx, fully rendered.
 *   GET /listings/nope-id **200**, 49 anchors, and the body is a SKELETON, not the 404 UI.
 *   GET /c/nope-cat       **200**, 49 anchors, same.
 *
 * ⚠️ THE STATUS AND THE BODY ARE MUTUALLY EXCLUSIVE HERE, AND THAT IS A PROPERTY OF NEXT 16.3.1,
 * NOT OF THIS FILE. Verified by reading the installed runtime and by five builds of an isolated
 * repro app against the same `node_modules/next`:
 *
 *   · `res.statusCode = 404` is written in exactly three places in
 *     `node_modules/next/dist/esm/server/app-render/app-render.js`. Two of them —  :2308 (dynamic)
 *     and :5834 (prerender) — sit in the `catch` around `renderToStream`, i.e. they fire ONLY when
 *     a `notFound()` escaped the whole React render. The third (:1663) is the Server-Action
 *     `not-found` result, which is POST-only and unreachable from a GET.
 *   · That same catch replaces the document with a HARDCODED empty shell:
 *     `createElement('html', { id: '__next_error__' }, createElement('head'), createElement('body'))`
 *     at app-render.js:1251, under the comment *"For metadata notFound error there's no global not
 *     found boundary on top so we create a not found page with AppRouter"*. There is no hook on it.
 *     The recovery links still reach the client — the inlined flight data is deliberately taken
 *     from the MAIN render (app-render.js:2376) — but a non-JS agent never sees them.
 *   · Anything that stops the escape leaves the status at 200. A caught `notFound()` only earns a
 *     `<meta name="robots" content="noindex">` (make-get-server-inserted-html.js:28); no code path
 *     turns a boundary-caught 404 into a 404 status.
 *
 * So the three shapes that give a real 404 WITH a body all come from base-server setting the status
 * BEFORE a normal render: no route matched, `dynamicParams: false` with the param absent from
 * `generateStaticParams`, or the Server-Action path. None is reachable from a matched dynamic page
 * whose params are user-created at runtime.
 *
 * ⛔ THEREFORE THE ONE THING THIS FILE MUST PROTECT IS THE **STATUS**, because the status is the
 * half that is still correct and the half that is trivially destroyed. See below.
 */

const HANDLE_DIR = join(process.cwd(), 'src/app/[handle]')

describe('root dynamic segment 404 contract', () => {
  /**
   * ⛔ A `loading.tsx` HERE WOULD SILENTLY CONVERT EVERY UNKNOWN PATH INTO A SOFT-404, AND THE
   * REPLACEMENT BODY IS A SKELETON, NOT THE 404 PAGE. This is not a theory — it is what
   * `/listings/[id]` and `/c/[category]` do in production TODAY, and both of those segments have a
   * `loading.tsx`. Reproduced in an isolated app on this exact Next version: adding one flipped
   * `/nope` from `404` to `200`, and the server HTML at the boundary was
   *
   *     <!--$!--><template data-dgst="NEXT_HTTP_ERROR_FALLBACK;404"></template><div>loading…</div>
   *
   * React aborts an errored Suspense boundary during SSR by emitting its FALLBACK and deferring
   * recovery to the client, so the 404 UI never reaches a non-JS agent — while the shell has
   * already flushed with a 200. That is the precise failure the "Agent-friendly 404s" audit item
   * names: "never a 200 with your app shell, which makes agents believe every path exists".
   *
   * ⚠️ Adding a loading skeleton to this segment therefore costs the whole 404 contract. If one is
   * ever genuinely wanted, it must go on a NESTED segment that only real handles reach, never here.
   */
  it('has no loading.tsx — a Suspense boundary on this segment turns the 404 into a 200 skeleton', () => {
    expect(existsSync(join(HANDLE_DIR, 'loading.tsx'))).toBe(false)
    expect(existsSync(join(HANDLE_DIR, 'loading.jsx'))).toBe(false)
  })

  /**
   * ⚠️ THE `notFound()` MUST STAY IN `generateMetadata`, AND THE REASON IS NOT THE ONE PEOPLE
   * ASSUME. Moving it into the page body does NOT currently break the status — measured:
   * `/help/nope-topic` throws only from its page body and still answers 404, because with no
   * Suspense boundary in the way the error is fatal to the flight stream either way. What
   * `generateMetadata` buys is that the throw happens BEFORE anything downstream can introduce a
   * boundary that would swallow it. Keeping both halves pinned (throw site + no loading.tsx) is
   * what makes the status robust rather than incidental.
   */
  it('throws notFound() from generateMetadata, before any streaming boundary exists', () => {
    const src = readFileSync(join(HANDLE_DIR, 'page.tsx'), 'utf8')
    const meta = src.slice(src.indexOf('export async function generateMetadata'))
    const metaBody = meta.slice(0, meta.indexOf('\nexport default'))
    expect(metaBody).toContain('notFound()')
  })
})

/**
 * The `/_not-found` document itself — the body an agent DOES get whenever base-server handles the
 * 404 (any path matching no route at all). These four links are the machine-readable recovery set
 * the audit looks for, and three of them are the site's agent entry points, so they are worth
 * pinning independently of the shell bug above.
 */
describe('the /_not-found document keeps its agent recovery links', () => {
  const notFound = readFileSync(join(process.cwd(), 'src/app/not-found.tsx'), 'utf8')

  it.each(['/', '/sitemap.xml', '/llms.txt', '/openapi.json'])('links to %s', (href) => {
    // Both `<Link href>` and a bare `<a href>` server-render as a real `<a href>`; the audit only
    // cares that the anchor is in the HTML without JavaScript, which SSR guarantees for both.
    expect(notFound).toContain(`href="${href}"`)
  })
})

/**
 * ⚠️ THE HTTP HALF IS OPT-IN, AND DELIBERATELY DOES NOT ASSERT THE BODY ON `/docs`.
 *
 * Run it against a live origin with:  AGENT_404_ORIGIN=http://localhost:3000 npx vitest run \
 *   'src/app/[handle]/not-found-contract.test.ts'
 *
 * It pins the two properties that are TRUE today and that a well-meaning "fix the empty body"
 * change would break: every unknown path answers 404 (never 200), and the shape that already
 * renders fully still carries all four recovery anchors. The missing property — anchors on the
 * single-segment shape — is left as an `it.todo` rather than a red assertion, because it is
 * blocked in the framework (see the header) and a permanently failing gate teaches people to
 * ignore the suite.
 */
const ORIGIN = process.env.AGENT_404_ORIGIN
describe.skipIf(!ORIGIN)('live origin', () => {
  const get = async (path: string) => {
    const res = await fetch(`${ORIGIN}${path}`, { redirect: 'manual' })
    return { status: res.status, html: await res.text() }
  }
  const anchors = (html: string) => (html.match(/<a\s[^>]*href=/g) ?? []).length

  // ⚠️ /agents.md, /index.md AND /auth.md WERE IN THIS LIST AND HAVE BEEN REMOVED ON PURPOSE.
  // They were 404s when the scan window in the header comment was recorded; they are now REAL
  // DOCUMENTS, served by rewrites into src/app/md/*. Leaving them here would have asserted that
  // the very documents this change publishes must not exist — a test pinning the bug rather than
  // the contract. agy caught it. The paths kept below are the ones that genuinely match no
  // resource and must keep answering 404 rather than a 200 app shell.
  it.each(['/docs', '/ask'])(
    '%s answers 404, never a 200 app shell',
    async (path) => {
      expect((await get(path)).status).toBe(404)
    },
    20_000,
  )

  // …and the three that now exist must answer 200 markdown, so a future rewrite regression is a
  // failing test rather than a silent 404 on a document /llms.txt and /developers both link.
  it.each(['/agents.md', '/index.md', '/auth.md'])(
    '%s is a real document, not a 404',
    async (path) => {
      expect((await get(path)).status).toBe(200)
    },
    20_000,
  )

  it('a path matching no route renders the full 404 document with its recovery anchors', async () => {
    const { status, html } = await get('/nope/xyz/abc')
    expect(status).toBe(404)
    expect(anchors(html)).toBeGreaterThan(10)
    for (const href of ['href="/"', 'href="/sitemap.xml"', 'href="/llms.txt"', 'href="/openapi.json"']) {
      expect(html).toContain(href)
    }
  }, 20_000)

  it.todo(
    'single-segment 404s should also carry recovery anchors — blocked by Next 16.3.1: the only ' +
      'code path that sets a 404 status on a matched dynamic route also replaces the document ' +
      'with a hardcoded empty <html id="__next_error__"> shell (app-render.js:1251, :2308)',
  )
})
