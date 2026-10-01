import { describe, expect, it } from 'vitest'
import { FRESH_DAYS, freshSetProblem, makeFreshSet } from './apartment-freshness'
import { pdpTombstoneTags } from './job-listing'
import { browseRankScore } from './ranking-formula'
import {
  REVER_MASS_FRESH_MIN, REVER_MASS_FRESH_SHARE, REVER_MIN_ANSWERED, REVER_UNKNOWN_FLOOR, classifyReverLiveness, isrTombstoneSql,
  judgeReverFreshness, massFreshRefusal, massReviveRefusal, parseSavedCheck, planReverApply, readReverPage, rejudgeSaved, reverDayStart,
  reverFreshDecision, reverRepostRank, reverStatusLabels, reverUpdatedText, sqlLiteral, updatedAtGuardSql, verdictFromLabels,
  type ReverApplyRow, type ReverCheckRecord,
} from './rever-liveness'

const page = (badge: string, related = '') =>
  `<html><body><h1>Căn hộ Masteri Lumiere Riverside, diện tích 74m²</h1>
   <ul><li><span class="tooltip verified-tooltip"></span></li></ul>${badge}
   <section class="related">${related}</section></body></html>`
const LIVE_BADGE = '<span class="label-primary label-outline-blue">Sẵn sàng giao dịch</span>'
const RENTED_BADGE = '<span class="label-primary label-outline-blue">Đã thuê</span>'
const RELATED_RENTED = '<h3><a href="/thue/x">X</a></h3> </div> <div class="status rever-color">Đã thuê</div>'

describe('classifyReverLiveness', () => {
  it('reads an available listing from its own badge', () => {
    expect(classifyReverLiveness(200, page(LIVE_BADGE)).verdict).toBe('live')
  })

  it('reads a let listing from its own badge', () => {
    expect(classifyReverLiveness(200, page(RENTED_BADGE))).toEqual({ verdict: 'rented', http: 200, label: 'Đã thuê' })
  })

  it('ignores "Đã thuê" printed by RELATED listing cards — the live page must stay live', () => {
    const html = page(LIVE_BADGE, RELATED_RENTED.repeat(5))
    expect(html.split('Đã thuê').length - 1).toBe(5)
    expect(classifyReverLiveness(200, html).verdict).toBe('live')
  })

  it('sets a price-drop badge aside — live and let pages alike', () => {
    const drop = '<span class="label-danger">giảm 7%</span>'
    expect(classifyReverLiveness(200, page(drop + LIVE_BADGE)).verdict).toBe('live')
    expect(classifyReverLiveness(200, page(drop + RENTED_BADGE)).verdict).toBe('rented')
    expect(verdictFromLabels(200, ['giảm 10%', 'Đã thuê']).verdict).toBe('rented')
    expect(verdictFromLabels(200, ['giảm 10%']).verdict).toBe('unknown') // a drop with no status says nothing
  })

  it('treats 404 and 410 as gone', () => {
    expect(classifyReverLiveness(404, '').verdict).toBe('gone')
    expect(classifyReverLiveness(410, '').verdict).toBe('gone')
  })

  it('hides nothing it does not recognise', () => {
    expect(classifyReverLiveness(200, page('')).verdict).toBe('unknown') // no badge
    expect(classifyReverLiveness(200, page(LIVE_BADGE + RENTED_BADGE)).verdict).toBe('unknown') // two badges
    expect(classifyReverLiveness(200, page('<span class="label-x">Đang đàm phán</span>')).verdict).toBe('unknown')
    expect(classifyReverLiveness(200, `<html>${RENTED_BADGE}</html>`).verdict).toBe('unknown') // no detail header
    expect(classifyReverLiveness(503, page(RENTED_BADGE)).verdict).toBe('unknown')
    expect(classifyReverLiveness(301, page(RENTED_BADGE)).verdict).toBe('unknown')
  })

  it('matches a decomposed (NFD) badge the same as a composed one', () => {
    expect(classifyReverLiveness(200, page(RENTED_BADGE.normalize('NFD'))).verdict).toBe('rented')
    expect(reverStatusLabels(page(LIVE_BADGE.normalize('NFD')))).toEqual(['Sẵn sàng giao dịch'])
  })
})

// ── the 7-day rule ────────────────────────────────────────────────────────────────────────────────────

const SELLER = 'cmub0wead0000zrq418bqq27m'
const DAY = 86_400_000
const NOW = Date.parse('2026-10-01T05:00:00Z') // 12:00 in Ho Chi Minh City
/** The markup as served on 2026-10-01 (whitespace and all). */
const dated = (d: string) => `
                  <div class="listing-date-updated">
                    <span>Cập nhật:</span>
                    <strong>${d}</strong>
                  </div>`

describe('reverUpdatedText', () => {
  it('reads the listing’s own Cập nhật block', () => {
    expect(reverUpdatedText(page(LIVE_BADGE + dated('08/09/2021')))).toBe('08/09/2021')
    expect(reverUpdatedText(page(LIVE_BADGE + dated('28/09/2026').normalize('NFD')))).toBe('28/09/2026')
  })
  it('reads nothing when the block is missing, doubled, relabelled or not a date', () => {
    expect(reverUpdatedText(page(LIVE_BADGE))).toBeNull()
    expect(reverUpdatedText(page(dated('28/09/2026') + dated('01/01/2025')))).toBeNull() // which one is ours?
    expect(reverUpdatedText(page('<div class="listing-date-updated"><span>Đăng:</span><strong>28/09/2026</strong></div>'))).toBeNull()
    expect(reverUpdatedText(page(dated('hôm qua')))).toBeNull()
    expect(reverUpdatedText(page('Cập nhật: 28/09/2026'))).toBeNull() // free text is not the block
  })
})

describe('reverDayStart', () => {
  it('is the START of that day in Ho Chi Minh City (UTC+7) — the worst case', () => {
    expect(reverDayStart('28/09/2026')?.toISOString()).toBe('2026-09-27T17:00:00.000Z')
    expect(reverDayStart('1/9/2026')?.toISOString()).toBe('2026-08-31T17:00:00.000Z')
  })
  it('refuses a day that does not exist and anything not dd/mm/yyyy', () => {
    for (const bad of ['31/02/2026', '00/10/2026', '10/13/2026', '28/09/26', '2026-09-28', '', null, undefined]) expect(reverDayStart(bad)).toBeNull()
  })
})

describe('readReverPage', () => {
  it('reads the date only from an answered detail page', () => {
    expect(readReverPage(200, page(LIVE_BADGE + dated('28/09/2026')))).toEqual({ verdict: 'live', http: 200, label: 'Sẵn sàng giao dịch', updated: '28/09/2026' })
    expect(readReverPage(200, `<html>${LIVE_BADGE}${dated('28/09/2026')}</html>`).updated).toBeNull() // no header: a search page
    expect(readReverPage(503, page(LIVE_BADGE + dated('28/09/2026'))).updated).toBeNull()
  })
})

const rec = (over: Partial<ReverCheckRecord> = {}): ReverCheckRecord => ({
  id: 'l1', externalId: 'rever:1700000000000_1', status: 'expired', url: 'https://rever.vn/thue/x',
  http: 200, label: 'Sẵn sàng giao dịch', verdict: 'live', updated: '28/09/2026', checkedAt: new Date(NOW).toISOString(), ...over,
})

describe('judgeReverFreshness', () => {
  it('fresh = Cập nhật inside the window AND the own badge says available; sourceDate is the day start', () => {
    expect(judgeReverFreshness(rec(), NOW)).toEqual({ kind: 'fresh', sourceDate: new Date('2026-09-27T17:00:00.000Z') })
  })
  it('judges the window at the day START: the 7th day back is in until the clock passes 7×24 h after its midnight', () => {
    // 24/09 00:00 ICT = 23/09 17:00Z; NOW is 01/10 05:00Z → 7 d 12 h old → out, though "7 days ago" by calendar.
    expect(judgeReverFreshness(rec({ updated: '24/09/2026' }), NOW)).toEqual({ kind: 'not-fresh', why: 'old' })
    expect(judgeReverFreshness(rec({ updated: '25/09/2026' }), NOW).kind).toBe('fresh')
  })
  it('an old date is not fresh whatever the badge; a let or gone listing is not fresh whatever the date', () => {
    expect(judgeReverFreshness(rec({ updated: '08/09/2021' }), NOW)).toEqual({ kind: 'not-fresh', why: 'old' })
    expect(judgeReverFreshness(rec({ updated: '08/09/2021', label: 'Đang đàm phán', verdict: 'unknown' }), NOW)).toEqual({ kind: 'not-fresh', why: 'old' })
    expect(judgeReverFreshness(rec({ label: 'Đã thuê', verdict: 'rented' }), NOW)).toEqual({ kind: 'not-fresh', why: 'rented' })
    expect(judgeReverFreshness(rec({ http: 404, label: null, verdict: 'gone', updated: null }), NOW)).toEqual({ kind: 'not-fresh', why: 'gone' })
  })
  it('re-judges the saved badges: a price-drop beside "Sẵn sàng giao dịch" is available', () => {
    expect(judgeReverFreshness(rec({ label: 'giảm 6% | Sẵn sàng giao dịch', verdict: 'unknown' }), NOW).kind).toBe('fresh')
  })
  it('everything it cannot judge is unknown — never fresh, never old', () => {
    expect(judgeReverFreshness(rec({ http: 0, label: null, verdict: 'unknown', updated: null }), NOW).kind).toBe('unknown') // timeout/redirect
    expect(judgeReverFreshness(rec({ http: 503, label: null, verdict: 'unknown', updated: '28/09/2026' }), NOW).kind).toBe('unknown') // a date off a non-answer is no evidence
    expect(judgeReverFreshness(rec({ updated: null }), NOW).kind).toBe('unknown') // live, but no date
    expect(judgeReverFreshness(rec({ label: 'Đang đàm phán', verdict: 'unknown' }), NOW).kind).toBe('unknown') // recent, badge unread
    expect(judgeReverFreshness(rec({ updated: '03/10/2026' }), NOW).kind).toBe('unknown') // the future
  })
})

describe('rejudgeSaved', () => {
  it('never turns "no evidence" into gone, and sharpens a verdict it had badges for', () => {
    expect(rejudgeSaved({ http: 0, label: null, verdict: 'unknown' }).verdict).toBe('unknown')
    expect(rejudgeSaved({ http: 200, label: 'giảm 7% | Đã thuê', verdict: 'unknown' }).verdict).toBe('rented')
    expect(rejudgeSaved({ http: 404, label: null, verdict: 'gone' }).verdict).toBe('gone')
  })
})

describe('parseSavedCheck', () => {
  const line = (o: Partial<ReverCheckRecord>) => JSON.stringify(rec(o))
  it('reads new lines and old ones (no externalId/status/updated → null)', () => {
    const old = JSON.stringify({ id: 'l2', url: 'https://rever.vn/thue/y', verdict: 'live', http: 200, label: 'Sẵn sàng giao dịch', checkedAt: new Date(NOW).toISOString() })
    const out = parseSavedCheck(`${line({})}\n\n${old}\n`, NOW + 3_600_000, 24)
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ id: 'l2', externalId: null, status: null, updated: null })
  })
  it('⛔ refuses the whole file when a line is over the max age, in the future or undated', () => {
    expect(() => parseSavedCheck(line({}), NOW + 25 * 3_600_000, 24)).toThrow(/25\.0 h ago/)
    expect(() => parseSavedCheck(line({}), NOW - 3_600_000, 24)).toThrow(/re-run the check/)
    expect(() => parseSavedCheck(line({ checkedAt: 'yesterday' }), NOW, 24)).toThrow(/no valid time/)
  })
  it('keeps the LATEST check of an id when two runs were appended to one file', () => {
    const out = parseSavedCheck([line({ checkedAt: new Date(NOW).toISOString(), updated: '01/01/2025' }), line({ checkedAt: new Date(NOW - 60_000).toISOString() })].join('\n'), NOW, 24)
    expect(out).toEqual([expect.objectContaining({ updated: '01/01/2025' })])
  })
})

const UNANSWERED: Partial<ReverCheckRecord> = { http: 0, label: null, verdict: 'unknown', updated: null }
const OLD: Partial<ReverCheckRecord> = { updated: '08/09/2021' }
/** n check records; LIVE (`active`) when checked unless `over` says otherwise. */
const recs = (n: number, over: (i: number) => Partial<ReverCheckRecord>, prefix = 'l') =>
  Array.from({ length: n }, (_, i) => rec({ id: `${prefix}${i}`, externalId: `rever:${prefix === 'l' ? '1700000000000' : '1800000000000'}_${i}`, status: 'active', ...over(i) }))

describe('reverFreshDecision', () => {
  const rows = recs

  it('builds a set freshSetProblem accepts: fresh items at their day start, undetermined ids apart', () => {
    const recs = rows(100, (i) => (i < 3 ? {} : i === 3 ? { http: 0, label: null, verdict: 'unknown', updated: null } : { updated: '08/09/2021' }))
    const d = reverFreshDecision(recs, 'every row')
    expect(d.items).toEqual([0, 1, 2].map((i) => ({ externalId: `rever:1700000000000_${i}`, sourceDate: '2026-09-27T17:00:00.000Z', dateKind: 'updated' })))
    expect(d.unknown).toEqual(['rever:1700000000000_3'])
    expect(d.counts).toMatchObject({ checked: 100, fresh: 3, old: 96, unknown: 1 })
    expect(d.complete).toBe(true)
    expect(d.coverage).toMatch(/^every row; one detail GET per row/)
    expect(d.coverage).toMatch(/99\.0% of the 100 rows live when checked answered/)
    expect(freshSetProblem(makeFreshSet(SELLER, d.fetchedAt!, d.coverage, d.items, d.unknown), NOW + 3_600_000, SELLER)).toBeNull()
  })
  it(`is NOT complete over ${REVER_UNKNOWN_FLOOR} undetermined AND under ${REVER_MIN_ANSWERED * 100}% answered, nor with nothing checked`, () => {
    const seven = rows(300, (i) => (i < 7 ? UNANSWERED : OLD))
    expect(reverFreshDecision(seven, 'x').complete).toBe(false) // 7 undetermined, 293 of 300 = 97.67%
    const six = rows(300, (i) => (i < 6 ? UNANSWERED : OLD))
    expect(reverFreshDecision(six, 'x').complete).toBe(true) // 6 undetermined, but 294 of 300 = 98.0%
    expect(reverFreshDecision(six.slice(0, 200), 'x').complete).toBe(false) // 6 undetermined, 194 of 200 = 97%
    expect(reverFreshDecision([], 'x')).toMatchObject({ complete: false, fetchedAt: null })
  })
  it(`⛔ IS complete with ≤ ${REVER_UNKNOWN_FLOOR} live rows undetermined, whatever the share — freshSetProblem's own floor`, () => {
    for (const [n, u] of [[10, 5], [40, 1], [6, 5], [100, 3]] as const) {
      const d = reverFreshDecision(rows(n, (i) => (i < u ? UNANSWERED : OLD)), 'x')
      expect(d.counts.unknown).toBe(u)
      expect(d.answeredShare).toBeLessThan(REVER_MIN_ANSWERED)
      expect(d.complete).toBe(true)
      expect(d.coverage).toMatch(new RegExp(`or ≤ ${REVER_UNKNOWN_FLOOR} undetermined`))
      // …and the set it writes passes the check the expiry runs on it.
      expect(freshSetProblem(makeFreshSet(SELLER, d.fetchedAt!, d.coverage, d.items, d.unknown), NOW, SELLER)).toBeNull()
    }
    // One past the floor fails BOTH here and in freshSetProblem — the two agree at the edge.
    const d = reverFreshDecision(rows(10, (i) => (i < 6 ? UNANSWERED : OLD)), 'x')
    expect(d.complete).toBe(false)
    expect(freshSetProblem(makeFreshSet(SELLER, d.fetchedAt!, d.coverage, d.items, d.unknown), NOW, SELLER)).toMatch(/6 of 6 undetermined/)
  })
  it('judges every row at the LAST check — a row fresh when checked but past the window by the end is left out', () => {
    // Day start 24/09 00:00 ICT = 23/09 17:00Z: in the window until 30/09 17:00Z.
    const recs = [
      rec({ id: 'a', externalId: 'rever:a', updated: '24/09/2026', checkedAt: '2026-09-30T16:50:00.000Z' }),
      rec({ id: 'b', externalId: 'rever:b', updated: '08/09/2021', checkedAt: '2026-09-30T17:10:00.000Z' }),
    ]
    const d = reverFreshDecision(recs, 'x')
    expect(d.fetchedAt?.toISOString()).toBe('2026-09-30T17:10:00.000Z')
    expect(d.items).toEqual([])
    expect(d.byId.get('a')).toEqual({ kind: 'not-fresh', why: 'old' })
  })
  it('leaves out rows outside Rever’s id space (they could never pass freshSetProblem) and reports them', () => {
    const d = reverFreshDecision([rec({ externalId: null }), rec({ id: 'l2', externalId: 'bds:1' })], 'x')
    expect(d.counts).toMatchObject({ checked: 0, noReverId: 2 })
    expect(d.items).toEqual([])
    expect(d.complete).toBe(false)
  })
  it('⛔ ONE row outside Rever’s id space among judged rows still refuses the set — never judged, it would be expired', () => {
    const ok = Array.from({ length: 30 }, (_, i) => rec({ id: `r${i}`, externalId: `rever:${1780000000000 + i}_1` }))
    expect(reverFreshDecision(ok, 'x').complete).toBe(true)
    expect(reverFreshDecision([...ok, rec({ id: 'odd', externalId: 'bds:1' })], 'x').complete).toBe(false)
  })
  it('one id, two checks: the later one decides', () => {
    const d = reverFreshDecision([rec({ checkedAt: new Date(NOW - 1000).toISOString() }), rec({ updated: '08/09/2021' })], 'x')
    expect(d.items).toEqual([])
    expect(d.counts.checked).toBe(1)
  })
  it('⛔ only rows LIVE when checked go to unknown and to the coverage denominator (verifier, 2026-10-01)', () => {
    // ~975 rows all expired after the first forced expiry, Rever having removed 60 of them (redirect → no answer):
    // nothing here can be kept live by `unknown`, so none of it may stall the set.
    const down = recs(975, (i) => ({ status: i % 2 ? 'expired' : 'stale', ...(i < 60 ? UNANSWERED : OLD) }), 'd')
    const d = reverFreshDecision(down, 'x')
    expect(d.unknown).toEqual([])
    expect(d.counts).toMatchObject({ checked: 975, live: 0, unknown: 0, unknownDown: 60, old: 915 })
    expect(d.complete).toBe(true)
    expect(d.answeredShare).toBe(1)
    expect(d.coverage).toMatch(/no row was live when checked/)
    expect(freshSetProblem(makeFreshSet(SELLER, d.fetchedAt!, d.coverage, d.items, d.unknown), NOW, SELLER)).toBeNull()
  })
  it('mixed: the share is over the live rows only, and only their undetermined ids are listed', () => {
    const live = recs(100, (i) => (i < 2 ? UNANSWERED : OLD))
    const down = recs(500, (i) => ({ status: 'expired', ...(i < 100 ? UNANSWERED : OLD) }), 'd')
    const d = reverFreshDecision([...live, ...down], 'x')
    expect(d.unknown).toEqual(['rever:1700000000000_0', 'rever:1700000000000_1'])
    expect(d.counts).toMatchObject({ checked: 600, live: 100, unknown: 2, unknownDown: 100 })
    expect(d.answeredShare).toBe(0.98)
    expect(d.complete).toBe(true)
    // …and 6 of 100 live undetermined is NOT complete, however well the down rows answered.
    const d6 = reverFreshDecision([...recs(100, (i) => (i < 6 ? UNANSWERED : OLD)), ...recs(500, () => ({ status: 'stale', ...OLD }), 'd')], 'x')
    expect(d6.complete).toBe(false)
  })
  it('a fresh expired/stale row IS an item (the apply revives it; the expiry must then keep it)', () => {
    const d = reverFreshDecision([rec({ status: 'stale' }), rec({ id: 'l2', externalId: 'rever:1700000000000_2', status: 'active', ...OLD })], 'x')
    expect(d.items.map((i) => i.externalId)).toEqual(['rever:1700000000000_1'])
    expect(d.byId.get('l1')?.kind).toBe('fresh')
  })
  it('a line with no status (written before the 7-day rule) counts as LIVE — the stricter reading', () => {
    const d = reverFreshDecision([rec({ status: null, ...UNANSWERED })], 'x')
    expect(d.unknown).toEqual(['rever:1700000000000_1'])
    expect(d.counts).toMatchObject({ live: 1, unknown: 1, unknownDown: 0 })
    // Six of them are past the floor (and 0% answered): not complete.
    expect(reverFreshDecision(recs(6, () => ({ status: null, ...UNANSWERED })), 'x').complete).toBe(false)
  })
  it(`the window is FRESH_DAYS (${FRESH_DAYS})`, () => {
    expect(FRESH_DAYS).toBe(7)
  })
})

describe('massFreshRefusal / decision.massFresh', () => {
  it(`refuses at ≥ ${REVER_MASS_FRESH_SHARE * 100}% fresh of ≥ ${REVER_MASS_FRESH_MIN} judged live rows`, () => {
    expect(massFreshRefusal(10, 20)).toMatch(/10\/20 judged live rows \(50%\)/) // exactly half: refused
    expect(massFreshRefusal(9, 20)).toBeNull()
    expect(massFreshRefusal(19, 19)).toBeNull() // too few to tell
    expect(massFreshRefusal(0, 0)).toBeNull()
  })
  it('counts only rows LIVE when checked, and only the judged ones (an undetermined row never dilutes it)', () => {
    // 10 live fresh + 10 live old = 10/20 → refused, however many unanswered live rows sit beside them.
    const live = recs(30, (i) => (i < 10 ? {} : i < 20 ? OLD : UNANSWERED))
    const d = reverFreshDecision(live, 'x')
    expect(d.counts).toMatchObject({ live: 30, liveJudged: 20, liveFresh: 10 })
    expect(d.massFresh).toMatch(/10\/20/)
    // Fresh DOWN rows are massReviveRefusal's, not this guard's: 10 live old + 40 stale fresh → no mass-fresh.
    const mixed = reverFreshDecision([...recs(20, () => OLD), ...recs(40, () => ({ status: 'stale' }), 'd')], 'x')
    expect(mixed.counts).toMatchObject({ liveJudged: 20, liveFresh: 0, fresh: 40 })
    expect(mixed.massFresh).toBeNull()
    // A let/gone live row is judged (not-fresh) — it is in the denominator.
    const let_ = reverFreshDecision(recs(20, (i) => (i < 9 ? {} : i < 15 ? { label: 'Đã thuê', verdict: 'rented' } : OLD)), 'x')
    expect(let_.counts).toMatchObject({ liveJudged: 20, liveFresh: 9 })
    expect(let_.massFresh).toBeNull()
  })
  it('⛔ counts only NEWLY fresh live rows: rows already dated to their current Cập nhật (live because fresh) never trip it', () => {
    // 28/09 = 2026-09-27T17:00Z (day start, ICT). 30 live rows already carry that postedAt → 0 newly fresh.
    const dated = new Date('2026-09-27T17:00:00.000Z').toISOString()
    const settled = reverFreshDecision(recs(30, () => ({ status: 'active', postedAt: dated })), 'x')
    expect(settled.counts).toMatchObject({ liveJudged: 30, liveFresh: 0 })
    expect(settled.massFresh).toBeNull()
    // The same 30 rows with an OLDER postedAt (a site-wide date change moved them all) → refused.
    const moved = reverFreshDecision(recs(30, () => ({ status: 'active', postedAt: new Date('2026-06-01T00:00:00Z').toISOString() })), 'x')
    expect(moved.counts).toMatchObject({ liveJudged: 30, liveFresh: 30 })
    expect(moved.massFresh).toMatch(/30\/30/)
  })
  it('⛔ under mass-fresh nothing is revived either — a revival rests on the same untrusted date', () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `d${i}`, externalId: `rever:${1780000000000 + i}_1`, status: 'expired', affiliateUrl: 'https://rever.vn/thue/x', subcategorySlug: 'apartment-rental', postedAt: new Date('2026-06-01T00:00:00Z') }))
    const records = rows.map((r) => rec({ id: r.id, externalId: r.externalId, status: 'expired' }))
    const decision = reverFreshDecision(records, 'x')
    expect(planReverApply(rows, records, decision).revive).toHaveLength(3)
    const refused = planReverApply(rows, records, { ...decision, massFresh: 'site-wide date change' })
    expect(refused.revive).toHaveLength(0)
    expect(refused.reviveRefused).toBe(3)
  })
  it('⛔ round trip: records → saved JSONL → parseSavedCheck → the SAME decision (postedAt survives the file)', () => {
    const dated = new Date('2026-09-27T17:00:00.000Z').toISOString()
    const live = recs(30, () => ({ status: 'active', postedAt: dated }))
    const fromFile = parseSavedCheck(live.map((r) => JSON.stringify(r)).join('\n'), NOW, 24)
    const a = reverFreshDecision(live, 'x'), b = reverFreshDecision(fromFile, 'x')
    expect(b.counts).toEqual(a.counts)
    expect(b.massFresh).toBe(a.massFresh)
    expect(b.items).toEqual(a.items)
  })
  it('the 2026-10-01 market (every live date 152+ days old) is nowhere near it', () => {
    expect(reverFreshDecision(recs(400, () => OLD), 'x').massFresh).toBeNull()
  })
})

describe('massReviveRefusal', () => {
  it('refuses a revival of more than half the judged down rows, past a sample of 20', () => {
    expect(massReviveRefusal(11, 20)).toMatch(/11\/20/)
    expect(massReviveRefusal(10, 20)).toBeNull()
    expect(massReviveRefusal(19, 19)).toBeNull() // too few to tell
    expect(massReviveRefusal(0, 0)).toBeNull()
  })
})

describe('reverRepostRank', () => {
  it('is browseRankScore at the SOURCE date with the row’s own inputs — what the nightly recompute gives it', () => {
    const row = { sellerTrustScore: 100, featured: false, views: 40, contactCount: 2 }
    const at = new Date(NOW - 3 * DAY)
    expect(reverRepostRank(row, at, NOW)).toBe(browseRankScore({ ...row, postedAt: at }, NOW))
    expect(reverRepostRank(row, at, NOW)).toBeLessThan(reverRepostRank(row, new Date(NOW), NOW)) // never a fresh-post boost
  })
})

// ── the apply plan ────────────────────────────────────────────────────────────────────────────────────

describe('planReverApply', () => {
  const FRESH_DAY = new Date('2026-09-27T17:00:00.000Z') // 28/09/2026 00:00 ICT — rec()'s default Cập nhật
  const URL = 'https://rever.vn/thue/x'
  /** A Listing row as it is NOW, matching rec()'s id/externalId/url unless overridden. */
  const row = (over: Partial<ReverApplyRow> = {}): ReverApplyRow => ({
    id: 'l1', externalId: 'rever:1700000000000_1', status: 'expired', affiliateUrl: URL, subcategorySlug: 'apartment-rental',
    postedAt: new Date('2026-06-01T00:00:00.000Z'), ...over,
  })
  /** One row + its check record, planned through the real decision. */
  const plan1 = (r: Partial<ReverApplyRow>, c: Partial<ReverCheckRecord> = {}) => {
    const records = [rec({ status: r.status ?? 'expired', ...c })]
    return planReverApply([row(r)], records, reverFreshDecision(records, 'x'))
  }

  it('revives a fresh expired or stale row, at the source date', () => {
    for (const status of ['expired', 'stale']) {
      const p = plan1({ status })
      expect(p.revive).toEqual([{ row: expect.objectContaining({ id: 'l1', status }), url: URL, sourceDate: FRESH_DAY }])
      expect(p.down).toEqual({ fresh: 1, 'not-fresh': 0, unknown: 0 })
      expect([p.hide, p.repost]).toEqual([[], []])
    }
  })

  it('⛔ never revives — or touches at all — a hidden, removed or sold row (or any other status), however fresh', () => {
    for (const status of ['hidden', 'removed', 'sold', 'draft', 'pending']) {
      const p = plan1({ status }, { status: 'expired' })
      expect(p.revive).toEqual([])
      expect(p.hide).toEqual([])
      expect(p.repost).toEqual([])
      expect(p.untouched).toBe(1)
      expect(p.down).toEqual({ fresh: 0, 'not-fresh': 0, unknown: 0 })
    }
    // …nor a non-apartment row, a row with no URL, or a row the check has no record for.
    expect(plan1({ subcategorySlug: 'house-rental' }).untouched).toBe(1)
    expect(plan1({ affiliateUrl: null }).untouched).toBe(1)
    expect(planReverApply([row({ id: 'other' })], [rec()], reverFreshDecision([rec()], 'x')).untouched).toBe(1)
  })

  it('⛔ no revive and no re-date when the URL or the externalId moved since the check', () => {
    for (const status of ['expired', 'active']) {
      for (const moved of [{ affiliateUrl: 'https://rever.vn/thue/other' }, { externalId: 'rever:1700000000000_2' }]) {
        const p = plan1({ status, ...moved })
        expect(p.revive).toEqual([])
        expect(p.repost).toEqual([])
      }
    }
    // A record with no externalId (an old line) can retire by URL as before — never revive or re-date.
    expect(plan1({}, { externalId: null }).revive).toEqual([])
    expect(plan1({ status: 'active' }, { externalId: null }).repost).toEqual([])
    expect(plan1({ status: 'active' }, { externalId: null, label: 'Đã thuê', verdict: 'rented' }).hide).toHaveLength(1)
  })

  it('a moved live row is judged by nothing: unknown, never hidden', () => {
    const p = plan1({ status: 'active', affiliateUrl: 'https://rever.vn/thue/other' }, { label: 'Đã thuê', verdict: 'rented' })
    expect(p.hide).toEqual([])
    expect(p.tally).toEqual({ live: 0, rented: 0, gone: 0, unknown: 1 })
    const q = plan1({ status: 'active', externalId: 'rever:1700000000000_2' }, { http: 404, label: null, verdict: 'gone', updated: null })
    expect(q.hide).toEqual([])
  })

  it('re-dates a live row only when the source date is STRICTLY newer than postedAt', () => {
    expect(plan1({ status: 'active', postedAt: new Date(FRESH_DAY.getTime() - 1) }).repost).toEqual([{ row: expect.objectContaining({ id: 'l1' }), url: URL, sourceDate: FRESH_DAY }])
    expect(plan1({ status: 'active', postedAt: FRESH_DAY }).repost).toEqual([]) // equal: nothing to move
    expect(plan1({ status: 'active', postedAt: new Date(FRESH_DAY.getTime() + 1) }).repost).toEqual([]) // never backwards
    expect(plan1({ status: 'active' }, OLD).repost).toEqual([]) // not fresh: postedAt stays
  })

  it('hides a live row Rever shows let or gone; a let/gone DOWN row stays down (and is not hidden again)', () => {
    expect(plan1({ status: 'active' }, { label: 'Đã thuê', verdict: 'rented' }).hide).toEqual([{ row: expect.objectContaining({ id: 'l1' }), url: URL, verdict: 'rented' }])
    expect(plan1({ status: 'active' }, { http: 404, label: null, verdict: 'gone', updated: null }).hide[0]?.verdict).toBe('gone')
    const p = plan1({ status: 'stale' }, { label: 'Đã thuê', verdict: 'rented' })
    expect([p.hide, p.revive]).toEqual([[], []])
    expect(p.down).toEqual({ fresh: 0, 'not-fresh': 1, unknown: 0 })
  })

  it('the mass-revive denominator is the down rows JUDGED (fresh + not-fresh), never the undetermined ones', () => {
    const records = [
      ...Array.from({ length: 13 }, (_, i) => rec({ id: `f${i}`, externalId: `rever:1700000000000_${100 + i}`, url: `${URL}${i}` })),
      ...Array.from({ length: 10 }, (_, i) => rec({ id: `o${i}`, externalId: `rever:1700000000000_${200 + i}`, url: `${URL}o${i}`, ...OLD })),
      ...Array.from({ length: 30 }, (_, i) => rec({ id: `u${i}`, externalId: `rever:1700000000000_${300 + i}`, url: `${URL}u${i}`, ...UNANSWERED })),
    ]
    const rows = records.map((c) => row({ id: c.id, externalId: c.externalId, affiliateUrl: c.url }))
    const p = planReverApply(rows, records, reverFreshDecision(records, 'x'))
    expect(p.down).toEqual({ fresh: 13, 'not-fresh': 10, unknown: 30 })
    expect(p.reviveJudged).toBe(23)
    expect(p.revive).toHaveLength(13)
    expect(massReviveRefusal(p.revive.length, p.reviveJudged)).toMatch(/13\/23/) // 57% of the judged — refused
    expect(massReviveRefusal(p.revive.length, p.reviveJudged + p.down.unknown)).toBeNull() // what counting the unknowns would hide
  })

  it('answered (massRetireRefusal’s denominator) is the live rows with a verdict', () => {
    const records = [
      rec({ id: 'a', externalId: 'rever:1700000000000_11', url: `${URL}a`, status: 'active' }),
      rec({ id: 'b', externalId: 'rever:1700000000000_12', url: `${URL}b`, status: 'active', label: 'Đã thuê', verdict: 'rented' }),
      rec({ id: 'c', externalId: 'rever:1700000000000_13', url: `${URL}c`, status: 'active', ...UNANSWERED }),
    ]
    const rows = records.map((c) => row({ id: c.id, externalId: c.externalId, affiliateUrl: c.url, status: 'active' }))
    const p = planReverApply(rows, records, reverFreshDecision(records, 'x'))
    expect(p.tally).toEqual({ live: 1, rented: 1, gone: 0, unknown: 1 })
    expect(p.answered).toBe(2)
  })

  it('⛔ under MASS-FRESH nothing is re-dated or revived (both counted as refused); retirements are untouched', () => {
    // 20 live rows, all fresh and newer than postedAt → would all re-date; one live row let; one stale row fresh.
    const live = Array.from({ length: 20 }, (_, i) => rec({ id: `a${i}`, externalId: `rever:1700000000000_${400 + i}`, url: `${URL}a${i}`, status: 'active' }))
    const let_ = rec({ id: 'r', externalId: 'rever:1700000000000_500', url: `${URL}r`, status: 'active', label: 'Đã thuê', verdict: 'rented' })
    const down = rec({ id: 's', externalId: 'rever:1700000000000_501', url: `${URL}s`, status: 'stale' })
    const records = [...live, let_, down]
    const rows = records.map((c) => row({ id: c.id, externalId: c.externalId, affiliateUrl: c.url, status: c.status! }))
    const d = reverFreshDecision(records, 'x')
    expect(d.massFresh).toMatch(/20\/21/)
    const p = planReverApply(rows, records, d)
    expect(p.repost).toEqual([])
    expect(p.repostRefused).toBe(20)
    expect(p.hide.map((h) => h.row.id)).toEqual(['r'])
    expect(p.revive).toEqual([])
    expect(p.reviveRefused).toBe(1)
    // The same records without the flag would re-date all 20 — the guard is what stops them.
    const q = planReverApply(rows, records, { ...d, massFresh: null })
    expect([q.repost.length, q.repostRefused]).toEqual([20, 0])
  })

  it('judges by the LATEST record of an id', () => {
    const records = [rec({ checkedAt: new Date(NOW - 60_000).toISOString() }), rec({ ...OLD })]
    expect(planReverApply([row()], records, reverFreshDecision(records, 'x')).revive).toEqual([])
  })
})

describe('rollback SQL helpers', () => {
  it('sqlLiteral doubles quotes', () => {
    expect(sqlLiteral("a'b''c")).toBe("'a''b''''c'")
  })
  it('updatedAtGuardSql pins a rollback line to the write that made it, and refuses an invalid date', () => {
    expect(updatedAtGuardSql(new Date('2026-10-02T03:04:05.678Z'))).toBe(`"updatedAt"<='2026-10-02T03:04:05.678Z'`)
    expect(() => updatedAtGuardSql(new Date(NaN))).toThrow(/unguarded rollback/)
    expect(() => updatedAtGuardSql(undefined as unknown as Date)).toThrow(/unguarded rollback/)
  })
  it('isrTombstoneSql tombstones exactly the PDP tags tombstonePdps writes, quotes escaped', () => {
    const sql = isrTombstoneSql(['abc'])
    expect(sql).toContain(`ARRAY[${pdpTombstoneTags('abc').map((t) => `'${t}'`).join(',')}]`)
    expect(sql).toMatch(/^INSERT INTO next_cache_tag \(tag, stamp, expires_at\) SELECT t, \(extract\(epoch from clock_timestamp\(\)\)\*1000\)::bigint, now\(\) \+ interval '40 days' FROM unnest\(/)
    expect(sql).toMatch(/ON CONFLICT \(tag\) DO UPDATE SET stamp = greatest\(next_cache_tag\.stamp, excluded\.stamp\), expires_at = greatest\(next_cache_tag\.expires_at, excluded\.expires_at\);$/)
    expect(isrTombstoneSql(["x'y"])).toContain("'eno:isrtag:_N_T_/en/listings/x''y'")
  })
})
