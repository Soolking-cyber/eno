// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * EVERY PATH OF `POST /api/report`, THROUGH THE REAL ROUTE AND THE REAL REPORT DIALOG.
 *
 * ⛔ WHAT THIS PINS. The route answers "ok" on four paths and only one of them creates a case:
 *   · created: 201 `{ok, id}`, a new case, bell + push to both sides;
 *   · duplicate (or a double tap that lost the race): 200 `{ok, id}` of the reporter's OWN open case;
 *   · cap: the listing already has 50 open reports → 200 `{ok}`, nothing created (route.ts:149);
 *   · refile: within 24h of this reporter's rejected report on the same surface → 200 `{ok}`,
 *     nothing created (route.ts:228).
 * The last two are silent ON PURPOSE (route.ts:148, :219-221): telling the reporter a cap or a
 * cooldown exists tells a harasser how long to wait. The dialog used to say "Dispute case opened" on
 * all four, which was false on two of them, and showed a case link only when an id came back, so the
 * button's presence told which path was taken. Two contracts, one per describe:
 *   1. the WIRE: cap and refile are byte-identical, so the network tab never says WHICH rule held;
 *   2. the DIALOG: every success path renders byte-identical DOM, in English and in Vietnamese.
 * ⚠️ NOT A CLAIM THAT CASE EXISTENCE IS SECRET. The reporter's own Disputes list shows their cases,
 * the created path alone rings their bell, and created/duplicate carry an id. What stays hidden is
 * the rule and its window; what this pins is that the dialog adds no signal and asserts no case.
 *
 * ⚠️ THE DIALOG IS FED THE REAL ROUTE'S RESPONSE, not a hand-written fixture: `fetch` is stubbed to
 * call `POST` itself, so a change to either side's shape cannot leave this test agreeing with a copy.
 *
 * ⚠️ DATA SAFETY: `@/lib/db` is replaced BY NAME with the in-memory store below, and `@/lib/dispute`
 * (the only other module here that writes: bell rows and push) with a recorder. Nothing reaches
 * Postgres or a device.
 *
 * ⚠️ EXPLICIT CLEANUP: no vitest `globals`, so Testing Library registers no afterEach of its own.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => {
  const state = {
    /** The signed-in reporter; `null` = guest. */
    me: null as null | { id: string; falseReportStrikes: number; reportCooldownUntil: Date | null },
    listings: new Map<string, Row>(),
    sellers: new Map<string, Row>(),
    conversations: new Map<string, Row>(),
    reports: [] as Row[],
    seq: 0,
    rlAllow: true,
    /** When set, the next report.create inserts this winner row first, then throws P2002. */
    raceWinner: null as Row | null,
    creates: [] as Row[],
    notifies: [] as unknown[][],
  }
  /** Equality and `{ in: [...] }`, which is every predicate the route builds. */
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' && Array.isArray((v as { in?: unknown[] }).in)
        ? (v as { in: unknown[] }).in.includes(row[k])
        : row[k] === v,
    )
  return { state, matches }
})

vi.mock('@/lib/db', () => ({
  db: {
    listing: { findUnique: async ({ where }: Row) => h.state.listings.get(where.id) ?? null },
    seller: { findUnique: async ({ where }: Row) => h.state.sellers.get(where.id) ?? null },
    conversation: { findUnique: async ({ where }: Row) => h.state.conversations.get(where.id) ?? null },
    report: {
      count: async ({ where }: Row) => h.state.reports.filter((r) => h.matches(r, where)).length,
      findFirst: async ({ where }: Row) => h.state.reports.find((r) => h.matches(r, where)) ?? null,
      findMany: async ({ where, take }: Row) => h.state.reports.filter((r) => h.matches(r, where)).slice(0, take),
      create: async ({ data }: Row) => {
        if (h.state.raceWinner) {
          h.state.reports.push(h.state.raceWinner)
          h.state.raceWinner = null
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
        }
        const row = { id: `case-${++h.state.seq}`, createdAt: new Date(), resolvedAt: null, ...data }
        h.state.reports.push(row)
        h.state.creates.push(data)
        return { id: row.id, targetProfileId: row.targetProfileId, targetSellerId: row.targetSellerId }
      },
    },
    $executeRaw: async () => 1,
  },
}))
vi.mock('@/lib/admin', () => ({
  getAdmin: async () => null,
  getCurrentProfile: async () => h.state.me,
  getCurrentProfileId: async () => h.state.me?.id ?? null,
}))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => ({ success: h.state.rlAllow, resetSec: 60 }),
}))
vi.mock('@/lib/dispute', () => ({
  DISPUTE_WINDOW_MS: 72 * 3600_000,
  notifyDispute: async (...a: unknown[]) => { h.state.notifies.push(a) },
  respondentProfileId: async (c: Row) => c.targetProfileId ?? null,
}))
vi.mock('@/lib/trust', () => ({ severityForReason: () => 2 }))
vi.mock('@/lib/log', () => ({ logError: () => {}, logWarn: () => {}, logInfo: () => {} }))

// ── The dialog's client context. Every hook returns a STABLE identity, like the real providers. ──
const ui = vi.hoisted(() => {
  const s = { lang: 'en' as 'en' | 'vi', signIns: 0 }
  const tr = (en: string, vi: string) => (s.lang === 'vi' ? vi : en)
  return {
    s,
    lang: { get lang() { return s.lang }, tr, t: (k: string) => k, setLang: () => {} },
    auth: { user: { id: 'rep1' }, loading: false, openSignIn: () => { s.signIns++ } },
  }
})
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ui.lang,
  useTr: () => ui.lang.tr,
  Tr: ({ en }: { en: string }) => en,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ui.auth, preloadSignIn: () => {} }))

import { POST } from './route'
import { ReportButton } from '@/components/marketplace/report-button'

const HOUR = 3600_000
const ME = 'rep1'

function seed() {
  h.state.me = { id: ME, falseReportStrikes: 0, reportCooldownUntil: null }
  h.state.listings = new Map([['L1', { id: 'L1', sellerId: 's1', seller: { ownerId: 'owner1' } }]])
  h.state.sellers = new Map([['s1', { id: 's1', ownerId: 'owner1' }]])
  h.state.conversations = new Map([['C1', { id: 'C1', buyerProfileId: ME, sellerProfileId: 'owner1', sellerId: 's1' }]])
  h.state.reports = []
  h.state.seq = 0
  h.state.rlAllow = true
  h.state.raceWinner = null
  h.state.creates = []
  h.state.notifies = []
}

const report = (over: Row): Row => ({
  id: `r-${Math.random().toString(36).slice(2)}`,
  reporterProfileId: ME,
  listingId: null,
  conversationId: null,
  targetProfileId: null,
  targetSellerId: null,
  status: 'open',
  createdAt: new Date(Date.now() - 2 * HOUR),
  resolvedAt: null,
  ...over,
})

type Surface = { listingId?: string; sellerId?: string; conversationId?: string }

/**
 * The state each success path needs, per surface. Every one of them is reached by the SAME request.
 * `surfaceRow` is how the route keys a report on that surface (its dupeWhere), so a duplicate and a
 * rejected earlier report are seeded exactly where the route looks for them.
 */
const SURFACES: Record<string, { body: Surface; surfaceRow: Row }> = {
  listing: { body: { listingId: 'L1' }, surfaceRow: { listingId: 'L1' } },
  seller: { body: { sellerId: 's1' }, surfaceRow: { targetProfileId: 'owner1' } },
  chat: { body: { conversationId: 'C1' }, surfaceRow: { conversationId: 'C1' } },
}
const PATHS: Record<string, (surfaceRow: Row) => void> = {
  created: () => {},
  duplicate: (at) => { h.state.reports.push(report({ id: 'my-open-case', ...at })) },
  'double-tap race': (at) => { h.state.raceWinner = report({ id: 'race-winner', ...at }) },
  refile: (at) => { h.state.reports.push(report({ ...at, status: 'dismissed', resolvedAt: new Date(Date.now() - 60_000) })) },
}
/** The cap exists only for listings (route.ts:147-149). Others' reports, not mine. */
const seedCap = () => {
  for (let i = 0; i < 50; i++) h.state.reports.push(report({ reporterProfileId: `other${i}`, listingId: 'L1' }))
}

async function callRoute(body: Row) {
  const res = await POST(new Request('https://eno.vn/api/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
  return { status: res.status, type: res.headers.get('content-type'), text: await res.text() }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('POST /api/report — the wire, path by path', () => {
  beforeEach(seed)

  it('created → 201 with the new case id, and both sides are notified', async () => {
    const r = await callRoute({ listingId: 'L1', reason: 'scam' })
    expect(r.status).toBe(201)
    expect(r.text).toBe('{"ok":true,"id":"case-1"}')
    expect(h.state.creates).toHaveLength(1)
    expect(h.state.notifies.map((n) => n[2])).toEqual(['opened_reporter', 'opened_respondent'])
  })

  it('duplicate → 200 with the reporter\'s OWN open case, nothing created, nobody notified', async () => {
    PATHS.duplicate({ listingId: 'L1' })
    const r = await callRoute({ listingId: 'L1', reason: 'scam' })
    expect(r.status).toBe(200)
    expect(r.text).toBe('{"ok":true,"id":"my-open-case"}')
    expect(h.state.creates).toHaveLength(0)
    expect(h.state.notifies).toHaveLength(0)
  })

  it('double tap that lost the race → 200 with the winner\'s id, and this request notifies nobody', async () => {
    PATHS['double-tap race']({ listingId: 'L1' })
    const r = await callRoute({ listingId: 'L1', reason: 'scam' })
    expect(r.status).toBe(200)
    expect(r.text).toBe('{"ok":true,"id":"race-winner"}')
    expect(h.state.creates).toHaveLength(0)
    expect(h.state.notifies).toHaveLength(0)
  })

  it('cap → 200 {"ok":true}: nothing created, nobody notified, no id', async () => {
    seedCap()
    const r = await callRoute({ listingId: 'L1', reason: 'scam' })
    expect(r.status).toBe(200)
    expect(r.text).toBe('{"ok":true}')
    expect(h.state.creates).toHaveLength(0)
    expect(h.state.notifies).toHaveLength(0)
  })

  it('refile within 24h of a rejected report → 200 {"ok":true}: nothing created, nobody notified', async () => {
    PATHS.refile({ listingId: 'L1' })
    const r = await callRoute({ listingId: 'L1', reason: 'scam' })
    expect(r.status).toBe(200)
    expect(r.text).toBe('{"ok":true}')
    expect(h.state.creates).toHaveLength(0)
    expect(h.state.notifies).toHaveLength(0)
  })

  it('⛔ cap and refile are BYTE-IDENTICAL on the wire, so not even the network tab says which rule held', async () => {
    seedCap()
    const cap = await callRoute({ listingId: 'L1', reason: 'scam' })
    seed()
    PATHS.refile({ listingId: 'L1' })
    const refile = await callRoute({ listingId: 'L1', reason: 'scam' })
    expect(refile).toEqual(cap)
  })

  it('the errors keep their codes (the dialog branches on them)', async () => {
    const cases: [string, () => void, Row, number, string][] = [
      ['guest', () => { h.state.me = null }, { listingId: 'L1', reason: 'scam' }, 401, 'auth_required'],
      ['≥3 strikes', () => { h.state.me!.falseReportStrikes = 3 }, { listingId: 'L1', reason: 'scam' }, 403, 'reporting_blocked'],
      ['cooldown', () => { h.state.me!.reportCooldownUntil = new Date(Date.now() + HOUR) }, { listingId: 'L1', reason: 'scam' }, 429, 'report_cooldown'],
      ['rate limit', () => { h.state.rlAllow = false }, { listingId: 'L1', reason: 'scam' }, 429, 'rate_limited'],
      ['own listing', () => { h.state.me!.id = 'owner1' }, { listingId: 'L1', reason: 'scam' }, 400, 'cannot_report_self'],
      ['not in the chat', () => { h.state.me!.id = 'stranger' }, { conversationId: 'C1', reason: 'scam' }, 403, 'not_participant'],
      ['no such listing', () => {}, { listingId: 'nope', reason: 'scam' }, 404, 'Listing not found'],
      ['bad reason', () => {}, { listingId: 'L1', reason: 'meh' }, 400, 'Invalid reason'],
    ]
    for (const [name, arrange, body, status, code] of cases) {
      seed()
      arrange()
      const r = await callRoute(body)
      expect({ name, status: r.status, error: JSON.parse(r.text).error }).toEqual({ name, status, error: code })
      expect(h.state.creates).toHaveLength(0)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────────
class NoopObserver { observe() {} unobserve() {} disconnect() {} }

describe('<ReportButton> — the same confirmation on every success path', () => {
  beforeEach(() => {
    seed()
    ui.s.lang = 'en'
    ui.s.signIns = 0
    vi.stubGlobal('ResizeObserver', NoopObserver)
    if (!window.matchMedia) {
      vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
    }
    // The dialog's request goes to the REAL route handler.
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      expect(url).toBe('/api/report')
      return POST(new Request(`https://eno.vn${url}`, init))
    })
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

    /**
   * The copy in the reader's language. ⚠️ NOT NAMED `tr`: scripts/gen-ui-strings.mjs harvests the
   * first literal of every tr/t call under src/, test files and comments included, so calling it that
   * here would put the test's own "Scam" into the catalogue every browser downloads.
   */
  const say = (en: string, vi: string) => ui.lang.tr(en, vi)

  /** Opens the dialog, picks "Scam", submits, and returns the dialog once the request settled. */
  async function submit(surface: Surface) {
    render(<ReportButton {...surface} />)
    fireEvent.click(screen.getByRole('button', { name: say('Report', 'Báo cáo') }))
    fireEvent.click(await screen.findByRole('radio', { name: say('Scam', 'Lừa đảo') }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: say('Submit report', 'Gửi báo cáo') }))
    })
    return screen.getByRole('dialog')
  }

  /** The dialog as markup, with generated ids blanked: they count renders, not paths. */
  const markup = (el: HTMLElement) => el.outerHTML.replace(/(\s(?:id|aria-labelledby|aria-describedby|aria-controls))="[^"]*"/g, '$1=""')

  for (const lang of ['en', 'vi'] as const) {
    for (const [surfaceName, { body, surfaceRow }] of Object.entries(SURFACES)) {
      it(`${lang}, ${surfaceName}: created, duplicate, race${surfaceName === 'listing' ? ', cap' : ''} and refile render the same dialog`, async () => {
        const arrangements: [string, () => void][] = Object.entries(PATHS).map(([name, arrange]) => [name, () => arrange(surfaceRow)])
        // The cap is a listing rule only (route.ts:147-149).
        if (surfaceName === 'listing') arrangements.push(['cap', seedCap])

        const seen: Record<string, string> = {}
        for (const [name, arrange] of arrangements) {
          seed()
          ui.s.lang = lang
          arrange()
          const before = h.state.creates.length
          const dialog = await submit(body)
          // The path really was the one named: only "created" (and nothing else) writes a case.
          expect({ name, created: h.state.creates.length - before }).toEqual({ name, created: name === 'created' ? 1 : 0 })
          seen[name] = markup(dialog)
          cleanup()
        }

        const first = Object.values(seen)[0]
        for (const [name, html] of Object.entries(seen)) expect({ name, html }).toEqual({ name, html: first })

        // And what that one dialog says is true on every path.
        document.body.innerHTML = first
        const dialog = document.body.firstElementChild as HTMLElement
        expect(dialog.textContent).toContain(say('Report sent', 'Đã gửi báo cáo'))
        expect(dialog.textContent).toContain(say('You can follow your dispute cases in Disputes.', 'Bạn có thể theo dõi các hồ sơ khiếu nại của mình trong mục Khiếu nại.'))
        expect(dialog.textContent).toContain(say('Any case still in its evidence window shows how long is left to send a statement and photos.', 'Hồ sơ nào còn trong thời hạn nộp bằng chứng sẽ hiển thị thời gian còn lại để gửi phần trình bày và ảnh.'))
        const hrefs = [...dialog.querySelectorAll('a')].map((a) => a.getAttribute('href'))
        expect(hrefs).toEqual(['/disputes'])
        for (const claim of ['Dispute case opened', 'Đã mở hồ sơ', 'review and decide', 'xem xét và quyết định', 'add evidence', 'bổ sung bằng chứng', 'case-1', 'my-open-case', 'race-winner']) {
          expect(dialog.outerHTML).not.toContain(claim)
        }
        document.body.innerHTML = ''
      })
    }
  }

  it('an error is never the confirmation: cooldown, rate limit and a missing listing keep their own words', async () => {
    const cases: [() => void, Surface, string][] = [
      [() => { h.state.me!.reportCooldownUntil = new Date(Date.now() + HOUR) }, { listingId: 'L1' }, 'Reporting is paused on your account'],
      [() => { h.state.rlAllow = false }, { listingId: 'L1' }, 'Too many reports'],
      [() => {}, { listingId: 'nope' }, 'Could not send. Try again.'],
      [() => { h.state.me!.falseReportStrikes = 3 }, { listingId: 'L1' }, 'Reporting is currently unavailable for your account'],
    ]
    for (const [arrange, surface, words] of cases) {
      seed()
      arrange()
      const dialog = await submit(surface)
      expect(dialog.textContent).toContain(words)
      expect(dialog.textContent).not.toContain('Report sent')
      cleanup()
    }
  })

  it('a guest is sent to sign in, not told anything was sent', async () => {
    seed()
    h.state.me = null
    // The dialog never reads `user` (it posts, and a 401 opens sign-in); null it anyway, as a guest is.
    const signedIn = ui.auth.user
    ui.auth.user = null as unknown as typeof signedIn
    try {
      await submit({ listingId: 'L1' }).catch(() => null)
      expect(ui.s.signIns).toBe(1)
      expect(screen.queryByText('Report sent')).toBeNull()
    } finally {
      ui.auth.user = signedIn
    }
  })
})
