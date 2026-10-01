import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SiteFacts } from '@/lib/site-facts'

/**
 * /llms.txt is the file agents read to decide who this site is. It used to live in `public/`,
 * which is copied into BOTH builds verbatim — so eno.forum introduced itself to every agent as
 * "eno.vn is a trusted classifieds marketplace". These tests exist so it cannot regress to that.
 *
 * ⚠️ THE MARKETPLACE BODY READS LIVE COUNTS (src/lib/site-facts.ts), mocked here: the tests below
 * fix the shelf and assert what the document may and may not claim about it. The real module is
 * kept for everything but the database read, so CITY_KEYS/inCity are the production ones.
 */
const h = vi.hoisted(() => ({ facts: null as SiteFacts | null, calls: 0 }))
vi.mock('@/lib/site-facts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/site-facts')>()),
  loadSiteFacts: async () => {
    h.calls++
    return h.facts
  },
}))

const load = async () => {
  vi.resetModules()
  return import('./route')
}

// Each test re-imports the route after resetModules, and the marketplace body now pulls in the
// taxonomy and the Prisma client (behind the mocked loader): a cold first import under a loaded full
// suite exceeded the 5s default once. Generous rather than flaky.
vi.setConfig({ testTimeout: 30_000 })

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  h.facts = null
  h.calls = 0
})
afterEach(() => { vi.unstubAllEnvs() })

const bodyOf = async () => {
  const { GET } = await load()
  return await GET().text()
}

/**
 * ⛔ EVERY URL IN THE DOCUMENT, AS AN AGENT OR A LINK CHECKER WOULD CUT IT OUT.
 *
 * "Also at https://eno.vn/api/v1/openapi.json." was harvested as `…/openapi.json.` — with the full
 * stop — and probed as a 404 (2026-09-27). A markdown link's closing `)` is syntax, so link targets
 * are taken from inside `[…](…)`; everything left over that starts with a scheme or a root-relative
 * `/` is a BARE token, cut at whitespace exactly as a naive tokenizer would.
 */
function urlTokens(body: string): { links: string[]; bare: string[] } {
  const links: string[] = []
  const prose = body.replace(/\[[^\]\n]*\]\(([^)\s]*)\)/g, (_m, href: string) => {
    links.push(href)
    return ' '
  })
  const bare = [...prose.matchAll(/(?:^|[\s(])((?:https?:\/\/|\/)[^\s]*)/g)].map((m) => m[1])
  return { links, bare }
}
const GLUED = /[.,;:!?)\]'"]$/

const expectNoGluedPunctuation = (body: string) => {
  const { links, bare } = urlTokens(body)
  expect(links.length, 'no markdown links found — this check has gone vacuous').toBeGreaterThan(10)
  for (const href of links) expect(href, `link target ${href}`).not.toMatch(GLUED)
  for (const token of bare) expect(token, `bare URL "${token}" ends in punctuation`).not.toMatch(GLUED)
}

const cats = (m: Record<string, number>) => m
/**
 * The shelf as measured on 2026-09-27 (public API, `facets.category` / `facets.province`): every
 * rental in Ho Chi Minh City, a handful of listings in Hanoi and Da Nang (jobs), and nothing at all in
 * property, moving-sale or vehicles › motorbike. `tickets-travel` and `services` are in it on purpose:
 * their TAXONOMY descriptions carry services vocabulary, and the body must not borrow them.
 */
const MEASURED: SiteFacts = {
  live: 103_966,
  linked: 101_000,
  motorbikes: 0,
  byCategory: cats({
    electronics: 63_932, rentals: 25_502, 'furniture-appliances': 6_308, sports: 5_591, 'fashion-beauty': 1_184,
    services: 447, 'books-stationery': 422, 'baby-kids': 380, vehicles: 100, jobs: 39, 'hobbies-sports': 26,
    'tickets-travel': 17, 'food-drink': 17, pets: 1,
  }),
  byCity: {
    hcmc: cats({ electronics: 63_900, rentals: 25_502, 'furniture-appliances': 6_308, jobs: 29, services: 447 }),
    hanoi: cats({ electronics: 263, jobs: 6 }),
    daNang: cats({ jobs: 4 }),
  },
}

describe('/llms.txt on the marketplace', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
    h.facts = MEASURED
  })

  it('⛔ NAMES eno.vn, NOT THE OTHER EDITION', async () => {
    const body = await bodyOf()
    expect(body).toContain('# eno.vn')
    expect(body).not.toContain('# eno.forum')
  })

  it('⛔ SERVES NO SERVICES VOCABULARY', async () => {
    // ⚠️ WHAT THIS DOES AND DOES NOT PROVE. It proves the runtime gate picks the marketplace body
    // and that no services word is inlined in this route — both mutation-verified. It does NOT
    // prove the build-time stub works: vitest does not apply next.config.ts's alias, so
    // `@/lib/edition-services-copy` here is the REAL module, not the stub. Only a grep of
    // `.next/static` on a marketplace build shows whether the string reached the artifact, which
    // is why eno-deploy.sh reads the built image rather than trusting a suite.
    const body = (await bodyOf()).toLowerCase()
    // ⚠️ 'paypal' BELONGS HERE AND WAS MISSING. CLAUDE.md's licensing boundary names three
    // surfaces — visa, itinerary AND PayPal — and the first version of this list carried two.
    // A PayPal mention added to MARKETPLACE_BODY would have passed a suite that looks like it
    // guards the boundary.
    for (const word of ['e-visa', 'evisa', 'visa', 'itinerary', 'paypal', 'passport', 'hộ chiếu', 'thị thực']) {
      expect(body, `"${word}" must not appear in the marketplace llms.txt`).not.toContain(word)
    }
  })

  it('answers the audit finding: a when-to-use section exists and is specific', async () => {
    const body = await bodyOf()
    expect(body).toContain('## When to use this site')
    // Generic marketing does not read as guidance — the section must also say when NOT to.
    expect(body).toContain('Do not use eno.vn for:')
  })

  it('points agents at the contact trust anchor', async () => {
    expect(await bodyOf()).toContain('https://eno.vn/contact')
  })

  it('is served as plain text, not HTML', async () => {
    const { GET } = await load()
    expect(GET().headers.get('content-type')).toContain('text/plain')
  })

  it('⛔ glues no punctuation to a URL — with facts and without', async () => {
    const withFacts = await bodyOf()
    // The regression itself, named: the mirror of the spec is a link now, never "…openapi.json."
    expect(withFacts).not.toContain('/api/v1/openapi.json.')
    expect(withFacts).toContain('[/api/v1/openapi.json](https://eno.vn/api/v1/openapi.json)')
    expectNoGluedPunctuation(withFacts)
    h.facts = null
    expectNoGluedPunctuation(await bodyOf())
  })

  it('the URL check catches the defect it exists for (not vacuous)', () => {
    const bad = '- [Spec](https://eno.vn/openapi.json) — also at https://eno.vn/api/v1/openapi.json.\n- see (https://eno.vn/regulations).\n- read /api/v1/status, then'
    const { bare } = urlTokens(bad)
    expect(bare.filter((t) => GLUED.test(t))).toEqual([
      'https://eno.vn/api/v1/openapi.json.',
      'https://eno.vn/regulations).',
      '/api/v1/status,',
    ])
  })

  describe('⛔ the 2026-09-27 false facts stay gone', () => {
    it('sends housing to /c/rentals and never to /c/property', async () => {
      const body = await bodyOf()
      expect(body).toContain('[Rentals](https://eno.vn/c/rentals)')
      expect(body).not.toContain('/c/property')
    })

    it('promises housing only where rentals exist — Ho Chi Minh City, not Hanoi or Da Nang', async () => {
      const body = await bodyOf()
      expect(body).toContain('- Someone needs somewhere to live in Ho Chi Minh City:')
      // Hanoi and Da Nang may be NAMED (with their real counts), but never as places with housing.
      expect(body).not.toMatch(/live in [^\n]*(Hanoi|Da Nang)/)
      expect(body).toContain('Hanoi 269 (rentals: 0)')
      expect(body).toContain('Da Nang 4 (rentals: 0)')
    })

    it('advertises no motorbikes and no moving sales while there are none', async () => {
      const body = await bodyOf()
      // The one exception is the guide index naming the HCMC motorbike-RENTAL hub by its own URL
      // (src/lib/expat-guides.ts, 2026-09-29): a registry line, not a claim about for-sale stock, and
      // the hub itself goes noindex when it has nothing live. Everything else stays banned.
      const claims = body.split('\n').filter((l) => !/\]\(https:\/\/eno\.vn\/(motorbike-rental-ho-chi-minh-city|thue-xe-may-tphcm)\)/.test(l)).join('\n')
      expect(claims).not.toMatch(/motorbike/i)
      expect(body).not.toMatch(/moving[ -]sale/i)
    })

    it('no longer tells agents to avoid new goods (57,074 new electronics were live)', async () => {
      expect(await bodyOf()).not.toMatch(/new-goods retail/)
    })

    it('says posting is currently free, and where that is written down', async () => {
      const body = await bodyOf()
      expect(body).toContain('Browsing and posting are currently free.')
      expect(body).toContain('see Article 8 of the [Operating Regulations](https://eno.vn/regulations).')
    })

    it('says linked listings link to their source instead of implying in-app chat for all', async () => {
      const body = await bodyOf()
      expect(body).toContain('101,000 of 103,966 live listings are linked from source sites')
      // "Partner" means a signed agreement since 2026-10-01; no linked source is called one (review P2).
      expect(body).not.toMatch(/partner sites?\b/i)
      expect(body).toContain('links to the original posting')
    })

    // ⛔ The owner removed "enquiries and viewings are handled there, not by eno" on 2026-09-25: the
    // eno team checks availability on any rental, linked or not, and a linked listing has its own page.
    it('never says a linked listing is handled at, or opens on, its source', async () => {
      const body = await bodyOf()
      expect(body).not.toMatch(/enquiries go there|answered on the site|opens? on the site (it|they) came from/)
      // Not "free" here: the fee-flag test below forbids the word, and agents need the fact, not the price.
      expect(body).toContain('the eno team checks availability on request')
    })

    it('claims no price on every listing, and dates its counts', async () => {
      const body = await bodyOf()
      expect(body).not.toContain('Every listing shows its asking price')
      expect(body).toMatch(/counts are as of \d{4}-\d{2}-\d{2} \(UTC\)/)
    })
  })

  it('lists only categories with stock, with their live counts, largest first', async () => {
    const body = await bodyOf()
    const section = body.split('## Categories')[1].split('## Guides')[0]
    expect(section).toContain('- [Electronics](https://eno.vn/c/electronics): phones, laptops, tablets, audio and accessories — 63,932 live listings.')
    expect(section.indexOf('/c/electronics')).toBeLessThan(section.indexOf('/c/rentals'))
    // One listing is "1 live listing", not "1 live listings" (pets held exactly one on 2026-09-27).
    expect(section).toMatch(/\/c\/pets\)[^\n]* — 1 live listing\.\n?/)
    expect(section).not.toContain(' — 1 live listings')
    expect(section).not.toContain('/c/moving-sale')
    expect(section).not.toContain('/c/community-events')
  })

  it('names the eleven interface languages in English', async () => {
    expect(await bodyOf()).toContain(
      '- Languages: the interface is available in English, Vietnamese, Simplified Chinese, Korean, Japanese, Russian, Khmer, Malay, Thai, French and Hindi.',
    )
  })

  it('states the operator only from the registry, and only once registered', async () => {
    const { COMPANY, OPERATOR_REGISTERED } = await import('@/lib/site-legal')
    const body = await bodyOf()
    if (OPERATOR_REGISTERED) {
      expect(body).toContain(`${COMPANY.nameEn} (${COMPANY.name}), business registration no. ${COMPANY.erc}`)
    } else {
      expect(body).not.toContain(COMPANY.erc)
    }
  })

  it('lists every marketplace and phone guide, marks the Vietnamese ones, and each one has a page', async () => {
    const [{ MARKETPLACE_GUIDES }, { PHONE_GUIDES }] = await Promise.all([import('@/lib/expat-guides'), import('@/lib/phone-guides')])
    const body = await bodyOf()
    const guides = body.split('## Guides')[1].split('## For developers and agents')[0]
    for (const g of [...MARKETPLACE_GUIDES, ...PHONE_GUIDES]) {
      expect(guides).toContain(`[${g.label}](https://eno.vn/${g.slug})${g.lang === 'vi' ? ' (Vietnamese)' : ''}: `)
      // ⛔ A GUIDE ADVERTISED TO AGENTS MUST RESOLVE. The registries have no existence test of their
      // own for marketplace guides, and a page.tsx is what makes the slug a route on this edition.
      expect(existsSync(join(process.cwd(), 'src/app/[lang]', g.slug, 'page.tsx')), `${g.slug} has no page.tsx`).toBe(true)
    }
  })

  it('follows the shelf: a city, a motorbike or a moving sale appears the day stock does', async () => {
    h.facts = {
      ...MEASURED,
      motorbikes: 3,
      byCategory: { ...MEASURED.byCategory, 'moving-sale': 2 },
      byCity: { ...MEASURED.byCity, hanoi: { ...MEASURED.byCity.hanoi, rentals: 12 } },
    }
    const body = await bodyOf()
    expect(body).toContain('- Someone needs somewhere to live in Ho Chi Minh City or Hanoi:')
    expect(body).toContain('a motorbike')
    expect(body).toContain('[Moving sales](https://eno.vn/c/moving-sale)')
  })

  it('⚠️ WITHOUT FACTS IT SAYS LESS, NEVER SOMETHING FALSE', async () => {
    h.facts = null
    const body = await bodyOf()
    expect(h.calls).toBe(1)
    // No count-dependent claim survives an outage…
    expect(body).not.toContain('- Where:')
    expect(body).not.toContain('live listings')
    expect(body).not.toContain('Someone needs somewhere to live')
    expect(body).not.toContain('/c/property')
    expect(body).toContain('- Browse every category from the [home page](https://eno.vn/).')
    // …and the facts that do not depend on stock are all still there.
    expect(body).toContain('Browsing and posting are currently free.')
    expect(body).toContain('## Guides')
    expect(body).toContain('Do not use eno.vn for:')
  })

  it('stops saying "free" the moment the fee flag does', async () => {
    vi.doMock('@/lib/site-identity', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/site-identity')>()),
      POSTING_IS_FREE: false,
    }))
    try {
      const body = await bodyOf()
      expect(body).not.toMatch(/free/i)
    } finally {
      vi.doUnmock('@/lib/site-identity')
    }
  })
})

describe('/llms.txt on the services edition', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.eno.forum')
    h.facts = MEASURED
  })

  it('⛔ INTRODUCES ITSELF AS eno.forum — the bug this route was created to fix', async () => {
    const body = await bodyOf()
    expect(body).toContain('# eno.forum')
    expect(body).not.toContain('# eno.vn')
  })

  it('⛔ LINKS ONLY TO ITS OWN ORIGIN, never the marketplace', async () => {
    // A stale https://eno.vn/... link here would hand agents to the other licensed entity.
    const body = await bodyOf()
    expect(body).not.toMatch(/https:\/\/eno\.vn/)
  })

  it('⛔ glues no punctuation to a URL', async () => {
    expectNoGluedPunctuation(await bodyOf())
  })

  it('makes no stock claim and reads no counts — the marketplace facts are not its facts', async () => {
    const body = await bodyOf()
    expect(h.calls).toBe(0)
    expect(body).not.toContain('live listings')
  })

  it('lists its own guides only — never the forum copies of the marketplace guides', async () => {
    const [{ EXPAT_GUIDES, MARKETPLACE_GUIDES }, { PHONE_GUIDES }] = await Promise.all([import('@/lib/expat-guides'), import('@/lib/phone-guides')])
    const body = await bodyOf()
    for (const g of EXPAT_GUIDES) expect(body).toContain(`[${g.label}](https://www.eno.forum/${g.slug}): ${g.blurb}`)
    for (const g of [...MARKETPLACE_GUIDES, ...PHONE_GUIDES]) expect(body).not.toContain(`/${g.slug})`)
  })

  it('⛔ claims nothing is free — POSTING_IS_FREE is the marketplace\'s rule, not this edition\'s', async () => {
    // eno.forum sells paid services and its /about carries no Cost row (about-page.test.tsx).
    expect(await bodyOf()).not.toMatch(/\bfree\b/i)
  })
})
