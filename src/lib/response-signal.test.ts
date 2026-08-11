import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { RANK } from '@/lib/ranking-formula'
// Imported as a namespace as well as by name: one test asserts what the module does NOT export.
import * as responseSignalModule from '@/lib/response-signal'
import {
  RECEIPT_MAX_AGE_DAYS,
  REPLIES_FAST_FACET_KEY,
  REPLIES_FAST_LABEL,
  REPLIES_FAST_NOTE,
  RESPONSE_DAY_FLOOR,
  RESPONSE_FAST_RATE,
  RESPONSE_MIN_CONVOS,
  RESPONSE_RANK_DELTA,
  RESPONSE_RANK_DELTA_FLOOR,
  repliesFastOutcome,
  repliesFastSqlPredicate,
  responseRankDelta,
  responseSignal,
  type ResponseFacts,
} from '@/lib/response-signal'

/**
 * SELLER RESPONSE SIGNAL — the four things that are invisible in a screenshot and expensive to get
 * wrong: whether an UNMEASURED seller can ever produce a label, where each BOUNDARY actually sits,
 * whether the ranking delta can ever be positive, and whether the facet can drag a seller who has
 * never been measured into a bucket named after a failure.
 *
 * The unmeasured case gets the most tests in the file on purpose. Seller.responseRate defaults to
 * 100, so every bug in this module fails in the same direction — toward a confident claim about a
 * shop that has never answered anybody.
 */

// A fixed clock. Every assertion passes `NOW` explicitly, because the module takes `now` as an
// argument precisely so that a test (and an ISR page) can choose it.
const NOW = Date.UTC(2026, 7, 12, 9, 0, 0) // 2026-08-12T09:00:00Z
const DAY_MS = 86_400_000
const daysAgo = (n: number) => new Date(NOW - n * DAY_MS)

/** A seller measured YESTERDAY with a fresh receipt — the base every case perturbs. */
function facts(over: Partial<ResponseFacts> = {}): ResponseFacts {
  return {
    responseRate: 95,
    responseTime: 'within an hour',
    measuredAt: daysAgo(1),
    convoCount: 12,
    ...over,
  }
}

/**
 * ⚠️ THIS BLOCK READS THE OTHER TWO FILES, AND THE FIRST VERSION OF IT DID NOT — WHICH MADE IT A
 * DRIFT GATE THAT COULD NOT DETECT DRIFT.
 *
 * It used to assert `expect(RESPONSE_FAST_RATE).toBe(80)` against a literal, and the module header
 * advertised that as pinning the mirror. An external reviewer pointed out the obvious hole:
 * seller-metrics.ts could move its threshold to 90 and every one of these assertions would still
 * pass, leaving a chip and a trust score quietly disagreeing about what "fast" means.
 *
 * Two of the four constants (RESPONSE_FAST_RATE, RESPONSE_DAY_FLOOR) are module-private over
 * there, so an import cannot reach them even setting aside the Prisma dependency — and the fourth
 * is not a constant at all, it is an interval literal inside a raw SQL string. Reading the source
 * text is the only mechanism that covers all four. It is brittle in the good direction: a rename
 * fails the regex and fails loudly, which is a person looking at both files.
 */
describe('the mirrored constants — three files hold the same numbers and only a test can keep them equal', () => {
  /**
   * ⚠️ THE READS HAPPEN INSIDE EACH `it`, AND THE PATH IS RELATIVE TO THIS FILE, NOT TO cwd. Both
   * were reviewer findings on the first version, which read the files in the describe BODY off
   * `process.cwd()`. That is collection-time work: a rename in seller-metrics.ts would throw
   * before any test registered and red the WHOLE file — including the pure-logic tests that have
   * nothing to do with the mirror — and `npx vitest` run from a subdirectory would fail on a path
   * that has nothing to do with the code under test. A drift gate that takes unrelated tests down
   * with it is a gate people delete.
   */
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
  const sellerMetricsSrc = () => read('./seller-metrics.ts')
  const responseRateSrc = () => read('./response-rate.ts')

  /**
   * Pull `<name> = <number>` out of a source file, failing with a readable message if it moved.
   *
   * ⚠️ ANCHORED TO A LINE-INITIAL DECLARATION (`^(export )?const NAME = 123`), NOT to the name
   * appearing anywhere in the text. A reviewer pointed out that an unanchored regex reads the
   * FILE, comments included — and both of these files are heavily commented, so one sentence of
   * prose containing "RESPONSE_FAST_RATE = 80" (or a commented-out old value) would satisfy the
   * pin while the live constant moved to 90. That is the identical hole this block was rewritten
   * to close; leaving it in the regex would have re-opened it one layer down.
   */
  function constIn(source: string, file: string, name: string): number {
    const m = new RegExp(`^(?:export )?const ${name} = (\\d+)`, 'm').exec(source)
    if (!m) throw new Error(`${name} no longer matches \`${name} = <number>\` in ${file} — the mirror in response-signal.ts must be re-checked by hand`)
    return Number(m[1])
  }

  it('reads RESPONSE_MIN_CONVOS straight out of seller-metrics.ts', () => {
    expect(RESPONSE_MIN_CONVOS).toBe(constIn(sellerMetricsSrc(), 'seller-metrics.ts', 'RESPONSE_MIN_CONVOS'))
  })

  it('reads the private RESPONSE_FAST_RATE and RESPONSE_DAY_FLOOR out of seller-metrics.ts', () => {
    expect(RESPONSE_FAST_RATE).toBe(constIn(sellerMetricsSrc(), 'seller-metrics.ts', 'RESPONSE_FAST_RATE'))
    expect(RESPONSE_DAY_FLOOR).toBe(constIn(sellerMetricsSrc(), 'seller-metrics.ts', 'RESPONSE_DAY_FLOOR'))
  })

  it('reads the receipt window out of the nightly SQL sweep in response-rate.ts', () => {
    // ⚠️ ANCHORED ON THE SWEEP STATEMENT, NOT ON THE FIRST `interval` IN THE FILE. A bare
    // /interval '(\d+) days'/ matches the 90-DAY scoring window three lines earlier and asserted
    // RECEIPT_MAX_AGE_DAYS === 90 — caught by this test failing the first time it ran, which is
    // exactly the argument for reading the source rather than restating a literal.
    const m = /"responseMetricAt" < now\(\) - interval '(\d+) days'/.exec(responseRateSrc())
    expect(m).not.toBeNull()
    expect(RECEIPT_MAX_AGE_DAYS).toBe(Number(m?.[1]))
  })

  it('reads the >= 5 conversation floor out of that same nightly UPDATE', () => {
    const m = /a\.n >= (\d+)/.exec(responseRateSrc())
    expect(m).not.toBeNull()
    expect(RESPONSE_MIN_CONVOS).toBe(Number(m?.[1]))
  })

  it('confirms the three canonical responseTime strings are the ones the job actually writes', () => {
    // The coarse ladder in this module is keyed on these exact strings; a fourth CASE arm, or a
    // reworded one, silently becomes an unrecognised string and suppresses every affected seller.
    for (const arm of ['within an hour', 'within a day', 'within a few days']) {
      expect(responseRateSrc()).toContain(`'${arm}'`)
    }
    expect(responseSignal(facts({ responseTime: 'within an hour' }), NOW).measured).toBe(true)
    expect(responseSignal(facts({ responseTime: 'within a day' }), NOW).measured).toBe(true)
    expect(responseSignal(facts({ responseTime: 'within a few days' }), NOW).measured).toBe(true)
  })

  it('keeps the fast threshold above the day floor, or `ok` would be an empty band', () => {
    expect(RESPONSE_FAST_RATE).toBeGreaterThan(RESPONSE_DAY_FLOOR)
  })
})

describe('the honesty gate — an unmeasured seller produces NOTHING, by every route in', () => {
  const unmeasured: Array<[string, Partial<ResponseFacts>]> = [
    ['a null receipt (the fabricated =100 default is still in the row)', { measuredAt: null }],
    ['an undefined receipt (the column was not selected)', { measuredAt: undefined }],
    ['an empty-string receipt', { measuredAt: '' }],
    ['an unparseable receipt', { measuredAt: 'sometime last week' }],
    ['a receipt one millisecond past the 8-day sweep', { measuredAt: new Date(NOW - RECEIPT_MAX_AGE_DAYS * DAY_MS - 1) }],
    ['a receipt dated in the FUTURE (clock skew between a stale bake and a client)', { measuredAt: new Date(NOW + 60_000) }],
    ['a conversation count below the floor', { convoCount: RESPONSE_MIN_CONVOS - 1 }],
    ['no conversations at all', { convoCount: 0 }],
    ['an unrecognised responseTime string', { responseTime: 'usually pretty quick' }],
    ['a null responseTime', { responseTime: null }],
  ]

  for (const [why, over] of unmeasured) {
    it(`suppresses with ${why}`, () => {
      const s = responseSignal(facts(over), NOW)
      expect(s.measured).toBe(false)
      expect(s.tier).toBeNull()
      expect(s.speed).toBeNull()
      expect(s.repliesFast).toBe(false)
      expect(s.label).toEqual({ en: '', vi: '' })
      expect(s.aria).toEqual({ en: '', vi: '' })
      // ⚠️ THE RANK DELTA FOR "UNMEASURED" IS 0, WHICH IS ALSO THE BEST POSSIBLE VALUE. This is the
      // single assertion that keeps new sellers out of the basement: they are ranked exactly like
      // the fastest measured seller, never penalised for a metric they have had no chance to earn.
      expect(s.rankDelta).toBe(0)
    })
  }

  it('returns the IDENTICAL object for every suppression, so nothing downstream can tell them apart', () => {
    const a = responseSignal(facts({ measuredAt: null }), NOW)
    const b = responseSignal(facts({ convoCount: 0 }), NOW)
    const c = responseSignal(facts({ responseTime: 'nonsense' }), NOW)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('⚠️ FREEZES that shared object — a mutable singleton would poison every unmeasured seller', () => {
    // Found by an external reviewer: because the suppression result is returned BY REFERENCE, one
    // consumer assigning to `signal.label.en` would rewrite the answer for every other unmeasured
    // seller in the process. Strict mode makes the write throw at the call site instead.
    const s = responseSignal(facts({ measuredAt: null }), NOW)
    expect(Object.isFrozen(s)).toBe(true)
    expect(Object.isFrozen(s.label)).toBe(true)
    expect(Object.isFrozen(s.aria)).toBe(true)
    expect(() => {
      ;(s.label as { en: string }).en = 'Replies fast'
    }).toThrow()
    // And the poisoning it prevents: the next caller still gets an empty label.
    expect(responseSignal(facts({ measuredAt: null }), NOW).label.en).toBe('')
  })

  it('does NOT let a high rate rescue a missing receipt — the 100 default is exactly what it looks like', () => {
    const s = responseSignal(facts({ responseRate: 100, responseTime: 'within an hour', measuredAt: null }), NOW)
    expect(s.measured).toBe(false)
  })
})

describe('receipt freshness — the boundary the nightly sweep is supposed to enforce', () => {
  it('honours a receipt at exactly RECEIPT_MAX_AGE_DAYS and drops it one millisecond later', () => {
    const onTheEdge = new Date(NOW - RECEIPT_MAX_AGE_DAYS * DAY_MS)
    expect(responseSignal(facts({ measuredAt: onTheEdge }), NOW).measured).toBe(true)
    expect(responseSignal(facts({ measuredAt: new Date(onTheEdge.getTime() - 1) }), NOW).measured).toBe(false)
  })

  it('expires a stale receipt as the CLOCK moves, not as the data changes — the ISR case', () => {
    // The same baked payload, read on two different days. This is what a 30-day ISR page does.
    const baked = facts({ measuredAt: daysAgo(0) })
    expect(responseSignal(baked, NOW).measured).toBe(true)
    expect(responseSignal(baked, NOW + 7 * DAY_MS).measured).toBe(true)
    expect(responseSignal(baked, NOW + 9 * DAY_MS).measured).toBe(false)
  })

  it('accepts the DAY-COARSE serialization a cacheable route should emit', () => {
    expect(responseSignal(facts({ measuredAt: '2026-08-11' }), NOW).measured).toBe(true)
    expect(responseSignal(facts({ measuredAt: '2026-08-01' }), NOW).measured).toBe(false)
  })
})

describe('the conversation floor — and the explicit admission that replaces it', () => {
  it('requires at least RESPONSE_MIN_CONVOS when the caller can count', () => {
    expect(responseSignal(facts({ convoCount: RESPONSE_MIN_CONVOS }), NOW).measured).toBe(true)
    expect(responseSignal(facts({ convoCount: RESPONSE_MIN_CONVOS - 1 }), NOW).measured).toBe(false)
  })

  it('accepts the literal receipt-only for surfaces that genuinely cannot count (the card projection)', () => {
    const s = responseSignal(facts({ convoCount: 'receipt-only' }), NOW)
    expect(s.measured).toBe(true)
    expect(s.tier).toBe('fast')
  })

  it('still requires the RECEIPT under receipt-only — the string relaxes one gate, not the gate', () => {
    expect(responseSignal(facts({ convoCount: 'receipt-only', measuredAt: null }), NOW).measured).toBe(false)
  })

  it('treats a NaN count as below the floor rather than as unknown', () => {
    expect(responseSignal(facts({ convoCount: Number.NaN }), NOW).measured).toBe(false)
  })
})

describe('speed — the coarse strings the nightly job actually writes', () => {
  it('maps each canonical string to its tier', () => {
    expect(responseSignal(facts({ responseTime: 'within an hour' }), NOW).speed).toBe('under_1h')
    expect(responseSignal(facts({ responseTime: 'within a day' }), NOW).speed).toBe('under_1d')
    expect(responseSignal(facts({ responseTime: 'within a few days' }), NOW).speed).toBe('over_1d')
  })

  it('tolerates case and surrounding whitespace, because a denormalized column drifts', () => {
    expect(responseSignal(facts({ responseTime: '  Within An Hour ' }), NOW).speed).toBe('under_1h')
  })

  it('⚠️ does NOT read a substring — this is where the older includes(hour) test would have lied', () => {
    // seller-metrics.ts asks `time.includes('hour')`, which is true of BOTH of these and would
    // read a multi-hour or over-an-hour seller as sub-hour. Exact matching suppresses instead.
    expect(responseSignal(facts({ responseTime: 'within a few hours' }), NOW).measured).toBe(false)
    expect(responseSignal(facts({ responseTime: 'over an hour' }), NOW).measured).toBe(false)
  })
})

describe('tier — where fast stops being fast, tested one unit either side of every threshold', () => {
  it('needs BOTH a sub-hour median and a rate at RESPONSE_FAST_RATE', () => {
    expect(responseSignal(facts({ responseTime: 'within an hour', responseRate: RESPONSE_FAST_RATE }), NOW).tier).toBe('fast')
    expect(responseSignal(facts({ responseTime: 'within an hour', responseRate: RESPONSE_FAST_RATE - 1 }), NOW).tier).toBe('ok')
  })

  it('never calls a within-a-day seller fast, however perfect their rate', () => {
    expect(responseSignal(facts({ responseTime: 'within a day', responseRate: 100 }), NOW).tier).toBe('ok')
  })

  it('calls an over-a-day seller slow, however perfect their rate', () => {
    expect(responseSignal(facts({ responseTime: 'within a few days', responseRate: 100 }), NOW).tier).toBe('slow')
  })

  it('⚠️ lets the RATE overrule a flattering median — the seller who answers one buyer in three instantly', () => {
    // This is the live shape on prod (measured 2026-08-12: the one seller with a receipt has
    // rate 33). A sub-hour median describes the third who got an answer, not the two who did not.
    expect(responseSignal(facts({ responseTime: 'within an hour', responseRate: 33 }), NOW).tier).toBe('slow')
    expect(responseSignal(facts({ responseTime: 'within an hour', responseRate: RESPONSE_DAY_FLOOR - 1 }), NOW).tier).toBe('slow')
    expect(responseSignal(facts({ responseTime: 'within an hour', responseRate: RESPONSE_DAY_FLOOR }), NOW).tier).toBe('ok')
  })

  it('⚠️ SUPPRESSES a measured row with no rate rather than reading it as 0 OR as the 100 default', () => {
    // Both directions are fabrications. Reading it as 100 flatters the seller; reading it as 0 —
    // which this module did until a reviewer pushed — publishes "often no reply within a day"
    // about a seller whose rate nobody has. Absent evidence is not evidence.
    // ⚠️ -1 AND 101 BELONG IN THIS LIST. A reviewer walked the domain: before this, -1 published
    // "often no reply within a day" AND took the maximum ranking penalty, while 101 was tiered
    // `fast`. Impossible values that `number | null` cannot exclude, turning a corrupt column into
    // a confident claim in whichever direction it happened to be corrupt.
    for (const responseRate of [null, Number.NaN, Number.POSITIVE_INFINITY, -1, 101]) {
      const s = responseSignal(facts({ responseRate }), NOW)
      expect(s.measured).toBe(false)
      expect(s.label.en).toBe('')
      expect(s.rankDelta).toBe(0)
    }
  })
})

describe('display — a relative time, never a score, and never a number nobody measured', () => {
  it('says how long a buyer will wait, in both languages', () => {
    const fast = responseSignal(facts({ responseTime: 'within an hour' }), NOW)
    expect(fast.label).toEqual({ en: 'Replies within an hour', vi: 'Phản hồi trong vòng 1 giờ' })

    const day = responseSignal(facts({ responseTime: 'within a day', responseRate: 90 }), NOW)
    expect(day.label).toEqual({ en: 'Replies within a day', vi: 'Phản hồi trong vòng 1 ngày' })
  })

  it('⚠️ says "a few days" and NOT "~3 days" on the coarse path — 3 is a number nobody measured', () => {
    const slow = responseSignal(facts({ responseTime: 'within a few days', responseRate: 90 }), NOW)
    expect(slow.label.en).toBe('Replies in a few days')
    expect(slow.label.vi).toBe('Phản hồi sau vài ngày')
    expect(slow.label.en).not.toMatch(/\d/)
  })

  it('never emits a percentage or a score — the raw responseRate must not reach a buyer', () => {
    for (const time of ['within an hour', 'within a day', 'within a few days']) {
      for (const responseRate of [0, 33, 50, 79, 80, 100]) {
        const s = responseSignal(facts({ responseTime: time, responseRate }), NOW)
        const words = `${s.label.en} ${s.label.vi} ${s.aria.en} ${s.aria.vi}`
        expect(words).not.toContain('%')
        // The coarse English labels carry no digits at all, so a rate leaking into one would be
        // caught by this alone. (The Vietnamese halves say "1 giờ"/"1 ngày", hence en only.)
        expect(s.label.en).not.toMatch(/\d/)
        expect(s.aria.en).not.toMatch(/\d/)
      }
    }
  })

  /**
   * ⛔ THE REGRESSION TEST FOR THE WORST BUG THIS MODULE SHIPPED. Until an external reviewer caught
   * it, a seller with responseRate 33 and responseTime 'within an hour' — the LIVE state of the one
   * measured seller on prod — was tiered `slow`, penalised correctly in ranking, and then rendered
   * the chip "Replies within an hour". Two thirds of the buyers who message that shop get no answer
   * inside a day. The median describes only the third who did.
   */
  describe('⛔ a seller below the reply-rate floor never quotes a median, precise or coarse', () => {
    const cases: Array<[string, Partial<ResponseFacts>]> = [
      ['a sub-hour median', { responseTime: 'within an hour' }],
      ['a within-a-day median', { responseTime: 'within a day' }],
      ['a multi-day median', { responseTime: 'within a few days' }],
      ['an EXACT four-minute median', { medianReplyMinutes: 4 }],
    ]
    for (const [why, over] of cases) {
      it(`states the rate instead, given ${why}`, () => {
        const s = responseSignal(facts({ responseRate: RESPONSE_DAY_FLOOR - 1, ...over }), NOW)
        expect(s.tier).toBe('slow')
        expect(s.label.en).toBe('Often no reply within a day')
        expect(s.label.vi).toBe('Thường không phản hồi trong ngày')
        // The specific lie: no version of the chip may promise a reply time.
        expect(s.label.en).not.toContain('Replies')
        expect(s.label.vi).not.toContain('Phản hồi trong')
      })
    }

    it('still SHOWS the seller — stating the fact is the point, suppressing it is the old behaviour', () => {
      // seller-metrics.ts suppresses here. This module does not, because suppression makes a
      // measured 33% seller look exactly like a brand-new shop that nobody has messaged.
      const s = responseSignal(facts({ responseRate: 33 }), NOW)
      expect(s.measured).toBe(true)
      expect(s.label.en.length).toBeGreaterThan(0)
    })

    it('quotes the median again the moment the rate reaches the floor', () => {
      const atFloor = responseSignal(facts({ responseRate: RESPONSE_DAY_FLOOR, responseTime: 'within a few days' }), NOW)
      expect(atFloor.tier).toBe('slow')
      expect(atFloor.label.en).toBe('Replies in a few days')
    })
  })

  it('⚠️ freezes every emitted pair — label and aria are the SAME object on the coarse paths', () => {
    const coarse = responseSignal(facts(), NOW)
    expect(coarse.label).toBe(coarse.aria)
    expect(Object.isFrozen(coarse.label)).toBe(true)
    expect(() => {
      ;(coarse.label as { en: string }).en = 'Replies fast'
    }).toThrow()
    // The exact path builds two DIFFERENT pairs; both are frozen too.
    const exact = responseSignal(facts({ medianReplyMinutes: 12 }), NOW)
    expect(exact.label).not.toBe(exact.aria)
    expect(Object.isFrozen(exact.label)).toBe(true)
    expect(Object.isFrozen(exact.aria)).toBe(true)
  })

  it('spells the tilde out for a screen reader, and only there', () => {
    const s = responseSignal(facts({ medianReplyMinutes: 12 }), NOW)
    expect(s.label.en).toContain('~')
    expect(s.aria.en).not.toContain('~')
    expect(s.aria.en).toContain('about')
  })

  it('keeps every English label free of a straight apostrophe (the tr() harvester swallows those)', () => {
    const cases: Partial<ResponseFacts>[] = [
      { responseTime: 'within an hour' },
      { responseTime: 'within a day', responseRate: 90 },
      { responseTime: 'within a few days', responseRate: 90 },
      { medianReplyMinutes: 8 },
      { medianReplyMinutes: 200, responseRate: 90 },
      { medianReplyMinutes: 5000, responseRate: 90 },
      { responseRate: 20 },
    ]
    for (const c of cases) {
      const s = responseSignal(facts(c), NOW)
      expect(s.label.en).not.toContain("'")
      expect(s.aria.en).not.toContain("'")
    }
    expect(REPLIES_FAST_LABEL.en).not.toContain("'")
    expect(REPLIES_FAST_NOTE.en).not.toContain("'")
  })
})

describe('the precise path — unreachable in production today, so the arithmetic is pinned here instead', () => {
  const exact = (medianReplyMinutes: number, rate = 90) => responseSignal(facts({ medianReplyMinutes, responseRate: rate }), NOW)

  it('overrides the coarse string when an exact median is supplied', () => {
    // The stored string says "a few days"; the exact median says eight minutes. The number wins.
    const s = responseSignal(facts({ responseTime: 'within a few days', medianReplyMinutes: 8 }), NOW)
    expect(s.speed).toBe('under_1h')
    expect(s.label.en).toBe('Replies in ~10 min')
  })

  it('rounds sub-hour medians to the nearest 5 minutes and never below 5', () => {
    expect(exact(0).label.en).toBe('Replies in ~5 min')
    expect(exact(2).label.en).toBe('Replies in ~5 min')
    expect(exact(12).label.en).toBe('Replies in ~10 min')
    expect(exact(13).label.en).toBe('Replies in ~15 min')
    expect(exact(57).label.en).toBe('Replies in ~55 min')
  })

  it('⚠️ never says "~60 min" — a median that ROUNDS to an hour is stated as an hour', () => {
    expect(exact(58).label.en).toBe('Replies in ~1 hour')
    expect(exact(59).label.en).toBe('Replies in ~1 hour')
    // Still the sub-hour SPEED tier, because 58 and 59 really are under an hour.
    expect(exact(58).speed).toBe('under_1h')
    expect(exact(58, 100).tier).toBe('fast')
  })

  it('crosses into hours at exactly 60 minutes and stays in the sub-hour SPEED tier there', () => {
    const at60 = exact(60)
    expect(at60.speed).toBe('under_1h')
    expect(at60.label.en).toBe('Replies in ~1 hour')
    const at61 = exact(61)
    expect(at61.speed).toBe('under_1d')
    expect(at61.label.en).toBe('Replies in ~1 hour')
  })

  it('pluralises hours, and reads the 24-hour boundary as hours rather than as a day', () => {
    expect(exact(120).label.en).toBe('Replies in ~2 hours')
    expect(exact(1440).speed).toBe('under_1d')
    expect(exact(1440).label.en).toBe('Replies in ~24 hours')
  })

  it('crosses into days one minute later, and ⚠️ says ~1 day there rather than rounding UP to 2', () => {
    const at1441 = exact(1441)
    expect(at1441.speed).toBe('over_1d')
    // A 24h01m median is about one day. Calling it "~2 days" would overstate a fault, which is the
    // one direction this module is never allowed to err in.
    expect(at1441.label.en).toBe('Replies in ~1 day')
    expect(exact(3 * 1440).label.en).toBe('Replies in ~3 days')
    expect(exact(3 * 1440).label.vi).toBe('Phản hồi trong ~3 ngày')
  })

  it('ignores a negative or non-finite median and falls back to the coarse string', () => {
    const neg = responseSignal(facts({ medianReplyMinutes: -5, responseTime: 'within a day', responseRate: 90 }), NOW)
    expect(neg.label.en).toBe('Replies within a day')
    const inf = responseSignal(facts({ medianReplyMinutes: Number.POSITIVE_INFINITY, responseTime: 'within a day', responseRate: 90 }), NOW)
    expect(inf.label.en).toBe('Replies within a day')
  })

  it('applies the SAME tier rules to an exact median as to a coarse one', () => {
    expect(exact(30, 100).tier).toBe('fast')
    expect(exact(30, 79).tier).toBe('ok')
    expect(exact(30, 49).tier).toBe('slow')
    expect(exact(5000, 100).tier).toBe('slow')
  })
})

describe('the ranking input — bounded, negative-only, and worth exactly what the header claims', () => {
  it('is 0 for fast and for unmeasured, and only ever negative otherwise', () => {
    expect(RESPONSE_RANK_DELTA.fast).toBe(0)
    expect(RESPONSE_RANK_DELTA.ok).toBeLessThan(0)
    expect(RESPONSE_RANK_DELTA.slow).toBeLessThan(RESPONSE_RANK_DELTA.ok)
    expect(RESPONSE_RANK_DELTA_FLOOR).toBe(RESPONSE_RANK_DELTA.slow)
    // ⚠️ FROZEN. One consumer writing RESPONSE_RANK_DELTA.slow would silently re-tune ranking for
    // every subsequent request in the process; the `Readonly<>` on the type stops nobody at runtime.
    expect(Object.isFrozen(RESPONSE_RANK_DELTA)).toBe(true)
  })

  it('⚠️ CANNOT be positive for ANY input — a boost would bury every unmeasured seller', () => {
    const times = ['within an hour', 'within a day', 'within a few days', 'nonsense', '']
    const rates = [null, 0, 33, 49, 50, 79, 80, 100] as Array<number | null>
    const ages = [0, 1, 7, 8, 9, 40]
    for (const responseTime of times) {
      for (const responseRate of rates) {
        for (const age of ages) {
          const d = responseRankDelta(facts({ responseTime, responseRate, measuredAt: daysAgo(age) }), NOW)
          expect(d).toBeLessThanOrEqual(0)
          expect(d).toBeGreaterThanOrEqual(RESPONSE_RANK_DELTA_FLOOR)
        }
      }
    }
  })

  it('matches the tier table exactly, so a scorer and a chip cannot disagree', () => {
    expect(responseRankDelta(facts({ responseTime: 'within an hour', responseRate: 95 }), NOW)).toBe(RESPONSE_RANK_DELTA.fast)
    expect(responseRankDelta(facts({ responseTime: 'within a day', responseRate: 95 }), NOW)).toBe(RESPONSE_RANK_DELTA.ok)
    expect(responseRankDelta(facts({ responseTime: 'within a few days', responseRate: 95 }), NOW)).toBe(RESPONSE_RANK_DELTA.slow)
  })

  /**
   * ⚠️ THESE ASSERT A RELATIONSHIP TO THE LIVE BROWSE WEIGHTS, NOT A CONSTANT. RANK is imported
   * from src/lib/ranking-formula.ts, so re-tuning the ranker — which has already happened once,
   * when TRUST_FLOOR/TRUST_SPAN were recalibrated for Trust v2 — breaks these tests rather than
   * silently changing what the worst case of this signal is worth.
   */
  describe('measured against the live RANK weights', () => {
    const worst = Math.abs(RESPONSE_RANK_DELTA_FLOOR)

    it('is smaller than the featured boost, so it can never sink a featured listing below an unfeatured one', () => {
      expect(worst).toBeLessThan(RANK.FEATURED_BOOST)
    })

    it('is worth under 6 trust points, which is less than a quarter of a trust tier', () => {
      const trustPoints = (worst / RANK.BROWSE_TRUST_W) * RANK.TRUST_SPAN
      expect(trustPoints).toBeGreaterThan(0)
      expect(trustPoints).toBeLessThan(6)
    })

    it('is worth under a week of freshness — a slow seller ranks like a slightly older listing', () => {
      // Solve 0.15 * exp(-d/14) = 0.15 - worst for d.
      const days = -RANK.DECAY_DAYS * Math.log(1 - worst / RANK.BROWSE_RECENCY_W)
      expect(days).toBeGreaterThan(0)
      expect(days).toBeLessThan(7)
    })

    it('is worth under 500 demand units — ordinary interest cancels it', () => {
      const demand = -RANK.DEMAND_REF * Math.log(1 - worst / RANK.BROWSE_RELEVANCE_W)
      expect(demand).toBeLessThan(500)
      // Same figure expressed in buyer contacts, which is how the header quotes it.
      expect(demand / RANK.DEMAND_CONTACT_W).toBeLessThan(16)
    })

    it('stays strictly inside every browse weight, so it can never dominate a term', () => {
      expect(worst).toBeLessThan(RANK.BROWSE_RECENCY_W)
      expect(worst).toBeLessThan(RANK.BROWSE_RELEVANCE_W)
      expect(worst).toBeLessThan(RANK.BROWSE_TRUST_W)
    })
  })
})

describe('the "Replies fast" facet — a positive filter with no complement', () => {
  it('qualifies exactly the fast tier and nothing else', () => {
    expect(repliesFastOutcome(facts({ responseTime: 'within an hour', responseRate: 95 }), NOW)).toBe('qualifies')
    expect(repliesFastOutcome(facts({ responseTime: 'within an hour', responseRate: 79 }), NOW)).toBe('too_slow')
    expect(repliesFastOutcome(facts({ responseTime: 'within a day', responseRate: 100 }), NOW)).toBe('too_slow')
    expect(repliesFastOutcome(facts({ responseTime: 'within a few days', responseRate: 100 }), NOW)).toBe('too_slow')
  })

  it('⚠️ reports an UNMEASURED seller as its own outcome, never as too_slow', () => {
    // The distinction exists so an empty state can say "N sellers have no measured reply time yet"
    // instead of implying they were weighed and found wanting.
    expect(repliesFastOutcome(facts({ measuredAt: null }), NOW)).toBe('unmeasured')
    expect(repliesFastOutcome(facts({ convoCount: 1 }), NOW)).toBe('unmeasured')
    expect(repliesFastOutcome(facts({ measuredAt: daysAgo(30) }), NOW)).toBe('unmeasured')
  })

  it('agrees with the signal it is derived from', () => {
    for (const responseRate of [0, 49, 50, 79, 80, 100]) {
      const f = facts({ responseRate })
      expect(repliesFastOutcome(f, NOW) === 'qualifies').toBe(responseSignal(f, NOW).repliesFast)
    }
  })

  describe('the SQL mirror', () => {
    const sql = repliesFastSqlPredicate('"s"')

    it('carries every constant the JS uses, interpolated rather than retyped', () => {
      expect(sql).toContain(`"s"."responseRate" >= ${RESPONSE_FAST_RATE}`)
      expect(sql).toContain(`interval '${RECEIPT_MAX_AGE_DAYS} days'`)
      expect(sql).toContain(`"s"."responseMetricAt" IS NOT NULL`)
      // The coarse-path spelling of "median under an hour". Kept case/whitespace-tolerant on the
      // SQL side too, so it agrees with medianMinutes()'s trim+lowercase on the JS side.
      expect(sql).toContain(`'within an hour'`)
      expect(sql).toContain('lower(btrim(')
    })

    it('⚠️ never mentions the OTHER two responseTime strings — it must not select a slow seller', () => {
      expect(sql).not.toContain('within a day')
      expect(sql).not.toContain('within a few days')
    })

    /**
     * ⚠️ THE REGRESSION TEST FOR THE ONE DEFECT TWO EXTERNAL REVIEWERS FOUND INDEPENDENTLY.
     * The predicate shipped with only a lower bound on the receipt (`>= now() - 8 days`), which a
     * FUTURE-dated receipt sails through — while responseSignal()'s gate 2 rejects it. Measured
     * against the live database with three synthetic rows: SQL said `fast`, JS said `unmeasured`.
     * That divergence returns sellers from the filter whose card then renders no chip at all.
     */
    it('⚠️ bounds the receipt at BOTH ends, so a future-dated row cannot pass SQL and fail the JS', () => {
      expect(sql).toContain(`"s"."responseMetricAt" <= now()`)
      // And the JS half of the same case, so the two assertions sit together.
      const future = { responseRate: 95, responseTime: 'within an hour', measuredAt: new Date(NOW + DAY_MS), convoCount: 'receipt-only' as const }
      expect(repliesFastOutcome(future, NOW)).toBe('unmeasured')
    })

    it('is a bare expression with no leading AND, and honours the alias it is given', () => {
      expect(sql.trim().startsWith('AND')).toBe(false)
      expect(repliesFastSqlPredicate('seller')).toContain('seller."responseRate"')
      expect(repliesFastSqlPredicate('"Seller"')).toContain('"Seller"."responseRate"')
    })

    it('⚠️ rejects an alias that is not an identifier — it IS caller data and IS interpolated raw', () => {
      // The comment above this function used to claim it interpolated no caller data. It does.
      expect(() => repliesFastSqlPredicate('s" OR 1=1 --')).toThrow(/identifier/)
      expect(() => repliesFastSqlPredicate('')).toThrow(/identifier/)
      expect(() => repliesFastSqlPredicate('a.b')).toThrow(/identifier/)
      // ⚠️ UNBALANCED QUOTES, found by two reviewers in the same round. The natural spelling of
      // this guard makes the opening and closing quote independent, so both of these passed and
      // both produced malformed SQL — a 500 rather than an injection, but from a function whose
      // whole promise is that it emits a valid predicate.
      expect(() => repliesFastSqlPredicate('"s')).toThrow(/identifier/)
      expect(() => repliesFastSqlPredicate('s"')).toThrow(/identifier/)
    })

    it('⛔ exposes NO negative form — the complement would sweep in every unmeasured seller', () => {
      // If a `repliesSlowSqlPredicate` ever appears in this module, it is the bug the facet
      // header is about. This asserts the module surface, not a behaviour.
      expect(Object.keys(responseSignalModule)).not.toContain('repliesSlowSqlPredicate')
      expect(Object.keys(responseSignalModule).filter((k) => /slow/i.test(k))).toEqual([])
    })
  })

  it('⚠️ freezes the exported label and note — Readonly<> is erased at runtime', () => {
    expect(Object.isFrozen(REPLIES_FAST_LABEL)).toBe(true)
    expect(Object.isFrozen(REPLIES_FAST_NOTE)).toBe(true)
  })

  it('ships the facet key, its label and the honest caveat, all non-empty', () => {
    expect(REPLIES_FAST_FACET_KEY).toBe('repliesFast')
    expect(REPLIES_FAST_LABEL.en.length).toBeGreaterThan(0)
    expect(REPLIES_FAST_LABEL.vi.length).toBeGreaterThan(0)
    // The Vietnamese half deliberately matches the 'fast' bucket seller-metrics.ts already ships,
    // so the filter and the badge it filters on do not read as two different claims.
    expect(REPLIES_FAST_LABEL.vi).toBe('Phản hồi nhanh')
    expect(REPLIES_FAST_NOTE.en.length).toBeGreaterThan(0)
    expect(REPLIES_FAST_NOTE.vi.length).toBeGreaterThan(0)
  })
})

describe('the live prod shape, as measured on 2026-08-12', () => {
  /**
   * Read with a read-only SELECT over DIRECT_URL: 11 Seller rows, of which exactly ONE carries a
   * responseMetricAt receipt. That one is the shared services desk (responseRate 33, responseTime
   * 'within a day', 9 conversations in the 90d window); the other ten hold the fabricated
   * responseRate=100 with a NULL receipt. These two cases are therefore the entire live surface of
   * this feature, and they are worth asserting literally.
   */
  it('gives the ten unmeasured sellers no chip and no penalty', () => {
    const untouched = responseSignal(
      { responseRate: 100, responseTime: 'within an hour', measuredAt: null, convoCount: 'receipt-only' },
      NOW,
    )
    expect(untouched.measured).toBe(false)
    expect(untouched.rankDelta).toBe(0)
  })

  it('gives the one measured seller a slow chip and the maximum penalty', () => {
    const desk = responseSignal(
      { responseRate: 33, responseTime: 'within a day', measuredAt: daysAgo(1), convoCount: 9 },
      NOW,
    )
    expect(desk.measured).toBe(true)
    expect(desk.tier).toBe('slow')
    // ⚠️ NOT 'Replies within a day'. Their rate is 33: two of every three buyers got no answer
    // inside 24h, so the stored median is a claim about the third who did.
    expect(desk.label.en).toBe('Often no reply within a day')
    expect(desk.rankDelta).toBe(RESPONSE_RANK_DELTA_FLOOR)
    expect(repliesFastOutcome({ responseRate: 33, responseTime: 'within a day', measuredAt: daysAgo(1), convoCount: 9 }, NOW)).toBe('too_slow')
  })
})
