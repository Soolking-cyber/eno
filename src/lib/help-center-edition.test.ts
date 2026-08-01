import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * THE HELP-ARTICLE LEAK, PINNED FROM BOTH ENDS.
 *
 * ⚠️ THIS IS A REGRESSION TEST FOR SOMETHING THAT WAS LIVE, NOT A HYPOTHETICAL. On 2026-08-01
 * `https://eno.vn/sitemap.xml` contained
 *
 *     <loc>https://eno.vn/help/help-vietnam-evisa-entry-basics</loc>
 *
 * and that URL returned 200. eno.vn is a licensed Vietnamese marketplace (sàn TMĐT) that may not
 * surface, describe, index or advertise e-visa services — so the licensed company was both ASKING
 * Google to index an e-visa article and serving it.
 *
 * ⚠️ WHY THE REPO'S TWO NORMAL MECHANISMS COULD NOT BE USED, because that is what shapes this file:
 * the article is a `ForumPost` ROW in the database that both deployments share. `pageExtensions` +
 * `.svc.` removes a ROUTE (there is one shared `/help/[id]` route and it must keep working);
 * `turbopack.resolveAlias` removes a MODULE'S VOCABULARY (the title and body are in no module). The
 * only lever the code owns is the TOPIC — `ForumPost.communitySlug` — declared in
 * `src/lib/help-center.ts`.
 *
 * ⚠️ SO THESE TESTS ARE BEHAVIOURAL, NOT DECLARATIVE. Asserting "the constant excludes the slug"
 * would pass forever while somebody changed the query that uses it. Instead the real
 * `loadHelpThread` and the real sitemap `GET` are executed against a fake database that HONOURS the
 * `communitySlug: { in: … }` predicate it is handed, exactly as Postgres would. What is measured is
 * therefore reachability and sitemap membership, which is what the licence turns on.
 */

/** The article measured live on eno.vn. Hard-coded so the test names the thing that leaked. */
const LEAKED_ARTICLE = 'help-vietnam-evisa-entry-basics'
/** A marketplace-safe neighbour, so "nothing is listed" can never be mistaken for a pass. */
const MARKETPLACE_ARTICLE = 'help-how-offers-work'

const h = vi.hoisted(() => ({ edition: 'services' as 'marketplace' | 'services' }))

vi.mock('@/lib/edition', () => ({
  get EDITION() { return h.edition },
  get IS_SERVICES() { return h.edition === 'services' },
  get IS_MARKETPLACE() { return h.edition === 'marketplace' },
  get SITE_NAME() { return h.edition === 'services' ? 'eno.forum' : 'eno.vn' },
}))

/** `loadHelpCenter`/`loadHelpThread` resolve the viewer for their per-viewer vote columns. */
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => null }))

/** The sitemap's listing predicate is exercised by src/lib/edition-scope.test.ts, not here. */
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (where: unknown) => where }))

/** One published ForumPost row, shaped for `serializeForumPost`. */
function post(id: string, communitySlug: string, official = true) {
  return {
    id,
    communitySlug,
    kind: 'guide',
    flair: 'Official answer',
    flairVi: 'Câu trả lời chính thức',
    title: `Title of ${id}`,
    body: `Body of ${id}`,
    authorName: 'eno team',
    authorRole: null,
    author: null,
    location: 'all',
    locationLabel: null,
    pinned: false,
    official,
    status: 'published',
    score: 0,
    commentCount: 0,
    viewCount: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-02T00:00:00.000Z'),
    media: [],
    votes: [],
    bookmarks: [],
  }
}

const POSTS = [post(MARKETPLACE_ARTICLE, 'help-buying'), post(LEAKED_ARTICLE, 'vietnam-travel')]

/**
 * ⚠️ THE FAKE DB APPLIES THE PREDICATE INSTEAD OF RECORDING IT. A mock that returned every fixture
 * row regardless of `where` would make both editions look identical and every assertion below
 * vacuous — the test would pass with the guard deleted. Emulating `in`/equality is what turns these
 * into measurements of what a user or Googlebot would receive.
 */
type Where = Record<string, unknown>
const matches = (row: Record<string, unknown>, where: Where = {}): boolean =>
  Object.entries(where).every(([key, cond]) => {
    const value = row[key]
    if (cond && typeof cond === 'object' && 'in' in (cond as object)) {
      return (cond as { in: unknown[] }).in.includes(value)
    }
    return value === cond
  })

vi.mock('@/lib/db', () => ({
  db: {
    forumPost: {
      findMany: async ({ where }: { where?: Where } = {}) => POSTS.filter((p) => matches(p, where)),
      findFirst: async ({ where }: { where?: Where } = {}) => POSTS.find((p) => matches(p, where)) ?? null,
    },
    forumComment: { findMany: async () => [] },
    // The sitemap's other four reads. Empty is fine: this file is about the help block, and the
    // listing/seller scoping has its own suite in src/lib/edition-scope.test.ts.
    listing: { findMany: async () => [] },
    category: { findMany: async () => [] },
    seller: { findMany: async () => [] },
    review: { findMany: async () => [] },
  },
}))

/**
 * Re-import the whole chain under one edition.
 *
 * ⚠️ `resetModules()` IS LOAD-BEARING. `HELP_TOPICS` is filtered at MODULE INIT, so a getter on the
 * mocked `EDITION` is read exactly once per module instance — without the reset, whichever edition
 * ran first would silently decide every later assertion.
 */
async function underEdition(edition: 'marketplace' | 'services') {
  h.edition = edition
  vi.resetModules()
  const helpCenter = await import('@/lib/help-center')
  const helpData = await import('@/lib/help-center-data')
  const sitemap = await import('@/app/sitemap.xml/route')
  const xml = await (await sitemap.GET()).text()
  return { ...helpCenter, ...helpData, xml }
}

beforeEach(() => {
  h.edition = 'services'
})

describe('the topic declaration', () => {
  it('every topic declares its editions, and none is declared for nothing', async () => {
    const { ALL_HELP_TOPICS } = await underEdition('services')
    for (const topic of ALL_HELP_TOPICS) {
      expect(topic.editions.length, `${topic.slug} is declared for no edition at all`).toBeGreaterThan(0)
      for (const edition of topic.editions) {
        expect(['marketplace', 'services'], `${topic.slug} declares an unknown edition`).toContain(edition)
      }
    }
  })

  it('at least one topic is services-only (or every assertion below is vacuous)', async () => {
    const { ALL_HELP_TOPICS } = await underEdition('services')
    const servicesOnly = ALL_HELP_TOPICS.filter((t) => !t.editions.includes('marketplace'))
    expect(
      servicesOnly.length,
      'no help topic is withheld from the licensed marketplace, so this whole file proves nothing — ' +
        'if that is genuinely intended, the leak fix has been reverted',
    ).toBeGreaterThan(0)
  })

  /**
   * ⚠️ THE VOCABULARY RULE, ENFORCED RATHER THAN DOCUMENTED. A marketplace build COMPILES
   * help-center.ts — it has to, because that module is what tells eno.vn which topics to withhold —
   * so an alias is not available here and a gate could not remove strings anyway. The module is
   * therefore held to the same standard as src/lib/expat-guides.ts: its VALUES name no service.
   * Comments are stripped first; the warnings in that file are the point of it.
   */
  it('help-center.ts carries no services vocabulary in its values', () => {
    const body = readFileSync('src/lib/help-center.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(body, 'src/lib/help-center.ts leaks services vocabulary outside its comments').not.toMatch(
      /visa|thị thực|hộ chiếu|passport|immigration|PayPal|itinerary/i,
    )
  })
})

describe('/help/[id] on the licensed marketplace', () => {
  /**
   * ⚠️ THE TEST THIS FILE EXISTS FOR. `loadHelpThread` returning null is precisely what makes
   * src/app/help/[id]/page.tsx call `notFound()` — a real 404 status, not a redirect and not an
   * empty page that Google would keep in its index as a soft-404.
   */
  it('does not resolve a services-only article — the route 404s', async () => {
    const { loadHelpThread } = await underEdition('marketplace')
    expect(await loadHelpThread(LEAKED_ARTICLE)).toBeNull()
  })

  it('still resolves the marketplace own answers', async () => {
    const { loadHelpThread } = await underEdition('marketplace')
    expect((await loadHelpThread(MARKETPLACE_ARTICLE))?.post.id).toBe(MARKETPLACE_ARTICLE)
  })

  it('resolves both on the services edition — eno.forum loses nothing', async () => {
    const { loadHelpThread } = await underEdition('services')
    expect((await loadHelpThread(LEAKED_ARTICLE))?.post.id).toBe(LEAKED_ARTICLE)
    expect((await loadHelpThread(MARKETPLACE_ARTICLE))?.post.id).toBe(MARKETPLACE_ARTICLE)
  })
})

describe('the /help index on the licensed marketplace', () => {
  it('lists no services-only answer and no services-only topic chip', async () => {
    const { loadHelpCenter, HELP_TOPIC_SLUGS } = await underEdition('marketplace')
    const { answers } = await loadHelpCenter()
    expect(answers.map((a) => a.id)).toEqual([MARKETPLACE_ARTICLE])
    expect(HELP_TOPIC_SLUGS).not.toContain('vietnam-travel')
  })
})

describe('sitemap.xml', () => {
  /**
   * The exact string that was live on eno.vn. Asserted against the GENERATED XML rather than
   * against the query, because a sitemap is not a passive document — it is the site actively asking
   * Google to index a URL, which on a licensed sàn TMĐT is the most active way to advertise a
   * service it may not sell.
   */
  it('does not submit a services-only help article on the marketplace edition', async () => {
    const { xml } = await underEdition('marketplace')
    expect(xml).not.toContain(`/help/${LEAKED_ARTICLE}`)
  })

  it('still submits the marketplace own help answers', async () => {
    const { xml } = await underEdition('marketplace')
    expect(xml).toContain(`/help/${MARKETPLACE_ARTICLE}`)
  })

  it('submits both on the services edition', async () => {
    const { xml } = await underEdition('services')
    expect(xml).toContain(`/help/${LEAKED_ARTICLE}`)
    expect(xml).toContain(`/help/${MARKETPLACE_ARTICLE}`)
  })

  /**
   * ⚠️ THE COUPLING, STATED AS ITS OWN INVARIANT. A sitemap-only filter would have been cosmetic:
   * the page still resolves for anyone holding the link, and Google had already crawled it. What
   * makes this fix real is that both halves read the SAME constant, so the sitemap cannot advertise
   * a URL the route refuses to serve. This test fails if a future change filters one and not the
   * other.
   */
  it('never lists a help URL the route would 404', async () => {
    const { xml, loadHelpThread } = await underEdition('marketplace')
    const listed = [...xml.matchAll(/<loc>[^<]*\/help\/([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(listed.length, 'no help URLs in the sitemap at all — the check would be vacuous').toBeGreaterThan(0)
    for (const id of listed) {
      expect(await loadHelpThread(id), `${id} is in the sitemap but /help/${id} would 404`).not.toBeNull()
    }
  })
})
