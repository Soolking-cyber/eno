import { describe, expect, it } from 'vitest'
import {
  ALERTS,
  alertBudget,
  isQuietHour,
  localHour,
  mayRealert,
  mergeNotified,
  parseNotified,
  preflightAlert,
  planPriceDropAlert,
  planSavedSearchAlert,
  qualifyingDrop,
  quietHoursEnd,
  serializeNotified,
  withAlertSent,
  type AlertCandidate,
  type NotifiedEntry,
  type RecipientAlertHistory,
  type SavedSearchState,
} from './saved-search-alerts'
import { DROP } from './price-drop-rules'

/**
 * SAVED-SEARCH + PRICE-DROP ALERTS.
 *
 * ⚠️ WHY THIS FILE IS LONGER THAN THE MODULE IT TESTS. Every gate in saved-search-alerts.ts is
 * one line away from a "simplification" that makes the channel spam, and none of those
 * simplifications would fail a typecheck or a smoke test — the alerts would still send, just to
 * people at 3am, about drops worth 20.000, twice for the same listing, forever after the person
 * stopped reading. And the failure is invisible: nobody files a bug saying "I muted you". These
 * tests are the record of which behaviours are load-bearing.
 *
 * The clock is ALWAYS injected. No test here reads the wall clock, so none can pass at 11:59 and
 * fail at midnight, and the quiet-hours tests are meaningless unless that holds.
 */

const DAY = 86_400_000
const HOUR = 3_600_000

/** A UTC instant for a given LOCAL (UTC+7) wall-clock hour on 2026-08-12. */
function localTime(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 7, 12, hour, minute) - ALERTS.TZ_OFFSET_MINUTES * 60_000)
}

const NOON = localTime(12) // a safe, non-quiet, mid-day instant used by most tests

function search(over: Partial<SavedSearchState> = {}): SavedSearchState {
  return {
    id: 'ss1',
    profileId: 'p1',
    notify: true,
    // Well outside PER_SEARCH_GAP_MS so the cooldown never fires unless a test wants it.
    lastNotifiedAt: new Date(NOON.getTime() - 3 * DAY),
    ...over,
  }
}

function recipient(over: Partial<RecipientAlertHistory> = {}): RecipientAlertHistory {
  return { sentAt: [], unreadAlerts: 0, ...over }
}

function candidate(id: string, over: Partial<AlertCandidate> = {}): AlertCandidate {
  return {
    listingId: id,
    sellerId: 'seller-normal',
    createdAt: new Date(NOON.getTime() - HOUR),
    price: 1_000_000,
    ...over,
  }
}

const DESK = ['seller-desk']

function plan(over: Partial<Parameters<typeof planSavedSearchAlert>[0]> = {}) {
  return planSavedSearchAlert({
    kind: 'new_match',
    search: search(),
    candidates: [candidate('L1')],
    recipient: recipient(),
    context: { now: NOON, deskSellerIds: DESK },
    ...over,
  })
}

/* ── Clock ─────────────────────────────────────────────────────────────────────────────────── */

describe('quiet hours', () => {
  it('reads the hour in the recipient local zone, not UTC', () => {
    // 12:00 local in UTC+7 is 05:00 UTC — a naive getUTCHours() would call this "quiet".
    expect(localHour(NOON)).toBe(12)
    expect(NOON.getUTCHours()).toBe(5)
    expect(isQuietHour(NOON)).toBe(false)
  })

  it('wraps midnight: quiet from 22:00 through 06:59, awake from 07:00', () => {
    expect(isQuietHour(localTime(21, 59))).toBe(false)
    expect(isQuietHour(localTime(22, 0))).toBe(true)
    expect(isQuietHour(localTime(23, 30))).toBe(true)
    expect(isQuietHour(localTime(0, 1))).toBe(true)
    expect(isQuietHour(localTime(6, 59))).toBe(true)
    expect(isQuietHour(localTime(7, 0))).toBe(false)
  })

  it('protects the Vietnamese evening — 20:00 and 21:00 are prime time, not quiet', () => {
    expect(isQuietHour(localTime(20))).toBe(false)
    expect(isQuietHour(localTime(21))).toBe(false)
  })

  it('resolves to the NEXT 07:00 local from either side of midnight', () => {
    // 23:30 → tomorrow 07:00 (7.5h away).
    expect(quietHoursEnd(localTime(23, 30)).getTime() - localTime(23, 30).getTime()).toBe(7.5 * HOUR)
    // 02:00 → today 07:00 (5h away), NOT tomorrow.
    expect(quietHoursEnd(localTime(2)).getTime() - localTime(2).getTime()).toBe(5 * HOUR)
  })

  it('honours a caller-supplied time zone', () => {
    // Same instant, a zone 7 hours west: local hour drops to 05:00, which IS quiet.
    expect(isQuietHour(NOON, 0)).toBe(true)
    expect(localHour(NOON, 0)).toBe(5)
  })
})

/* ── Budget ────────────────────────────────────────────────────────────────────────────────── */

describe('alertBudget', () => {
  it('counts nothing for a recipient we have never alerted', () => {
    const b = alertBudget([], NOON)
    expect(b).toMatchObject({ day: 0, week: 0, dayCapped: false, weekCapped: false, retryAfter: null })
  })

  it('caps at PER_USER_DAY_CAP and not one alert earlier', () => {
    const sent = (n: number) => Array.from({ length: n }, (_, i) => new Date(NOON.getTime() - (i + 1) * HOUR))
    expect(alertBudget(sent(ALERTS.PER_USER_DAY_CAP - 1), NOON).dayCapped).toBe(false)
    expect(alertBudget(sent(ALERTS.PER_USER_DAY_CAP), NOON).dayCapped).toBe(true)
  })

  it('slides — an alert 25 hours old no longer counts against the day', () => {
    const old = Array.from({ length: ALERTS.PER_USER_DAY_CAP }, () => new Date(NOON.getTime() - 25 * HOUR))
    expect(alertBudget(old, NOON).dayCapped).toBe(false)
  })

  it('frees the next slot when the OLDEST send in the window ages out', () => {
    const oldest = new Date(NOON.getTime() - 20 * HOUR)
    const sent = [oldest, new Date(NOON.getTime() - 2 * HOUR), new Date(NOON.getTime() - HOUR)]
    const b = alertBudget(sent, NOON)
    expect(b.dayCapped).toBe(true)
    expect(b.retryAfter?.getTime()).toBe(oldest.getTime() + DAY)
  })

  it('reports the LATER of the two caps when both bind', () => {
    // Ten sends spread over the week: weekly cap binds, and its retry is further out.
    const sent = Array.from({ length: ALERTS.PER_USER_WEEK_CAP }, (_, i) => new Date(NOON.getTime() - i * HOUR))
    const b = alertBudget(sent, NOON)
    expect(b.dayCapped).toBe(true)
    expect(b.weekCapped).toBe(true)
    const oldest = NOON.getTime() - (ALERTS.PER_USER_WEEK_CAP - 1) * HOUR
    expect(b.retryAfter?.getTime()).toBe(oldest + 7 * DAY)
  })

  it('ignores unparseable timestamps rather than producing NaN windows', () => {
    const b = alertBudget([new Date(NaN), new Date(NOON.getTime() - HOUR)], NOON)
    expect(b.day).toBe(1)
  })

  it('discards a future-dated send rather than letting a bad clock spend the budget', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED. `t - ms` is NEGATIVE for a future date, so `< WEEK_MS` was
    // trivially true: one row stamped 90 days ahead held a cap slot for three months and pushed
    // retryAfter three months out. listing-health already refused to trust a future timestamp.
    const skewed = [new Date(NOON.getTime() + 90 * DAY), new Date(NOON.getTime() + 90 * DAY), new Date(NOON.getTime() + 90 * DAY)]
    const b = alertBudget(skewed, NOON)
    expect(b.day).toBe(0)
    expect(b.dayCapped).toBe(false)
    expect(b.retryAfter).toBeNull()
    // A few minutes of skew is real clock jitter and still counts as a send.
    expect(alertBudget([new Date(NOON.getTime() + 60_000)], NOON).day).toBe(1)
  })

  it('reports a retry time at which a slot ACTUALLY frees, even past the cap', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED. "When the oldest expires" is only correct at exactly the
    // cap. With four sends against a cap of three — reachable from concurrent workers, or from
    // history written before a cap was lowered — the oldest expiring still leaves three, so the
    // advertised time was a moment at which nothing changes.
    const t = [20, 18, 16, 14].map((h) => new Date(NOON.getTime() - h * HOUR)) // 4 sends, cap 3
    const b = alertBudget(t, NOON)
    expect(b.day).toBe(4)
    expect(b.dayCapped).toBe(true)
    // Sorted ascending the freeing send is index length-cap = 1, i.e. the one 18h ago.
    expect(b.retryAfter?.getTime()).toBe(NOON.getTime() - 18 * HOUR + DAY)
    // And at that moment the budget genuinely has room.
    expect(alertBudget(t, b.retryAfter!).dayCapped).toBe(false)
  })

  it('is a TIGHTER shared ceiling than the price-drop engine own per-recipient cap', () => {
    // ⚠️ If this ever inverts, the two caps stop composing and a buyer can receive
    // PER_USER_DAY_CAP search alerts PLUS DROP.RECIPIENT_DAILY_CAP drops in one day.
    expect(ALERTS.PER_USER_DAY_CAP).toBeLessThan(DROP.RECIPIENT_DAILY_CAP)
  })
})

/* ── The price floor ───────────────────────────────────────────────────────────────────────── */

describe('qualifyingDrop', () => {
  it('refuses without a server-anchored reference price', () => {
    expect(qualifyingDrop(null, 900_000).reason).toBe('no_reference')
    expect(qualifyingDrop(undefined, 900_000).reason).toBe('no_reference')
    expect(qualifyingDrop(0, 900_000).reason).toBe('no_reference')
  })

  it('refuses a raise or a flat price', () => {
    expect(qualifyingDrop(1_000_000, 1_000_000).reason).toBe('drop_too_small')
    expect(qualifyingDrop(1_000_000, 1_200_000).reason).toBe('drop_too_small')
  })

  it('accepts EXACTLY the ratchet and rejects a hair under it', () => {
    // The gate is multiplicative on purpose: `1 - 0.9` is 0.09999999999999998 in binary floating
    // point, so a subtracted-fraction gate would decide an exact 10% drop by rounding luck.
    expect(qualifyingDrop(2_000_000, 1_800_000).ok).toBe(true)
    expect(qualifyingDrop(2_000_000, 1_800_001).reason).toBe('drop_too_small')
  })

  it('uses the existing engine ratchet rather than a second definition of "10%"', () => {
    expect(ALERTS.MIN_DROP_RATCHET).toBe(DROP.NOTIFY_RATCHET)
  })

  it('rejects a percentage-qualifying drop that is not worth any money', () => {
    // 50% off a 200.000 listing is 100.000 — exactly the floor, so it passes...
    expect(qualifyingDrop(200_000, 100_000).ok).toBe(true)
    // ...but 20% off a 300.000 listing saves 60.000 and does not.
    const q = qualifyingDrop(300_000, 240_000)
    expect(q.ok).toBe(false)
    expect(q.reason).toBe('saving_too_small')
    expect(q.savingVnd).toBe(60_000)
  })

  it('lets the percentage bind first on a median-priced listing', () => {
    // Measured median active price is 1.890.000; 10% of it is 189.000, above MIN_SAVING_VND,
    // so on the top three quartiles the absolute floor changes nothing.
    expect(qualifyingDrop(1_890_000, 1_701_000).ok).toBe(true)
    expect(qualifyingDrop(1_890_000, 1_800_000).reason).toBe('drop_too_small')
  })

  it('reports the saving and fraction even when it refuses, for logging', () => {
    const q = qualifyingDrop(1_000_000, 950_000)
    expect(q.ok).toBe(false)
    expect(q.savingVnd).toBe(50_000)
    expect(q.fraction).toBeCloseTo(0.05, 6)
  })
})

/* ── Dedup memory ──────────────────────────────────────────────────────────────────────────── */

describe('notified memory', () => {
  const e = (id: string, price: number): NotifiedEntry => ({ id, price })

  it('round-trips through the JSON text column shape', () => {
    expect(parseNotified(serializeNotified([e('a', 100), e('b', 200)]))).toEqual([e('a', 100), e('b', 200)])
  })

  it('survives a null, a non-array, malformed JSON and half-typed rows without throwing', () => {
    expect(parseNotified(null)).toEqual([])
    expect(parseNotified('{"a":1}')).toEqual([])
    expect(parseNotified('not json')).toEqual([])
    expect(parseNotified('[["a"],["b","x"],["c",300],3]')).toEqual([e('c', 300)])
  })

  it('puts the newest entries first, one per listing, so a fresher quote replaces an older one', () => {
    expect(mergeNotified([e('a', 100), e('b', 200)], [e('b', 150), e('c', 300)]))
      .toEqual([e('b', 150), e('c', 300), e('a', 100)])
  })

  it('caps the buffer so the column cannot grow without bound', () => {
    const existing = Array.from({ length: ALERTS.NOTIFIED_ID_MEMORY }, (_, i) => e(`old${i}`, 100))
    const merged = mergeNotified(existing, [e('new', 50)])
    expect(merged.length).toBe(ALERTS.NOTIFIED_ID_MEMORY)
    expect(merged[0]).toEqual(e('new', 50))
    expect(merged.map((x) => x.id)).not.toContain(`old${ALERTS.NOTIFIED_ID_MEMORY - 1}`)
  })

  it('outlasts the sweep exposure window the drop path actually has', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED as a SIZING TARGET. At maximum throughput the buffer covers
    // MAX_RECORDED_PER_RUN x PER_USER_WEEK_CAP per week ~= 9 days. That is comfortable against the
    // badge clock the sweep must follow (DROP.BADGE_MS, 3 days) and NOT against a sweep keyed on
    // `previousPrice != null`, which survives until the next raise. Hence the documented predicate.
    const daysOfMemory = (ALERTS.NOTIFIED_ID_MEMORY / (ALERTS.MAX_RECORDED_PER_RUN * ALERTS.PER_USER_WEEK_CAP)) * 7
    expect(daysOfMemory).toBeGreaterThan(DROP.BADGE_MS / 86_400_000)
  })

  it('holds more than a full week of maximum throughput — the anti-thrash invariant', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED. The first draft recorded EVERY notifiable candidate with no
    // per-run bound against a 200-entry buffer: a broad search matching 300 simultaneous drops
    // evicted 100 of them on the same run, so those re-qualified on the next tick, re-alerted,
    // and evicted the next hundred — a permanent thrash loop the caps merely rate-limited.
    expect(ALERTS.NOTIFIED_ID_MEMORY).toBeGreaterThanOrEqual(ALERTS.MAX_RECORDED_PER_RUN * ALERTS.PER_USER_WEEK_CAP)
  })

  it('remembers the PRICE, so a later genuine drop is not silenced by the earlier alert', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED, from two directions at once. A bare id set meant (a) a
    // listing found as a NEW MATCH could never afterwards alert as a price drop, and (b) a 10%
    // drop already alerted blocked a further 20% cut — silently defeating lowestNotifiedPrice,
    // the ratchet whose entire purpose is to let a genuinely better deal interrupt you twice.
    const memory = [e('L1', 1_000_000)]
    expect(mayRealert(memory, 'price_drop', 'L1', 950_000)).toBe(false) // 5% below the quote
    expect(mayRealert(memory, 'price_drop', 'L1', 900_000)).toBe(true) // a full ratchet below
    expect(mayRealert(memory, 'new_match', 'L1', 100)).toBe(false) // nothing is new twice
    expect(mayRealert(memory, 'price_drop', 'L2', 999_999)).toBe(true) // never told about L2
    expect(mayRealert(undefined, 'price_drop', 'L1', 999_999)).toBe(true)
  })
})

/* ── The saved-search planner: consent ─────────────────────────────────────────────────────── */

describe('planSavedSearchAlert — consent gates come first', () => {
  it('says nothing for a search whose owner turned alerts off', () => {
    const p = plan({ search: search({ notify: false }) })
    expect(p).toMatchObject({ send: false, reason: 'search_muted', cursorTo: null })
  })

  it('says nothing to a globally muted recipient', () => {
    expect(plan({ recipient: recipient({ muted: true }) }).reason).toBe('recipient_muted')
  })

  it('STOPS SENDING once three alerts have gone unread — the anti-mute rule', () => {
    expect(plan({ recipient: recipient({ unreadAlerts: ALERTS.MAX_UNREAD_ALERTS - 1 }) }).send).toBe(true)
    const p = plan({ recipient: recipient({ unreadAlerts: ALERTS.MAX_UNREAD_ALERTS }) })
    expect(p).toMatchObject({ send: false, reason: 'dormant', cursorTo: null })
  })

  it('resumes by itself the moment the recipient reads one', () => {
    // Dormancy is derived from live unread state, not stored, so there is nothing to un-set.
    expect(plan({ recipient: recipient({ unreadAlerts: 0 }) }).send).toBe(true)
  })

  it('reports the CONSENT reason, not a timing one, when both apply', () => {
    const p = plan({
      search: search({ notify: false }),
      context: { now: localTime(3), deskSellerIds: DESK },
    })
    expect(p.reason).toBe('search_muted')
  })
})

/* ── The saved-search planner: the edition boundary ────────────────────────────────────────── */

describe('planSavedSearchAlert — the edition boundary fails CLOSED', () => {
  it('sends nothing at all when the desk could not be resolved', () => {
    // ⚠️ An empty list means "I could not find out", never "there is no desk". Treating it as the
    // latter is exactly the silent leak edition-scope.ts exists to prevent: e-visa and itinerary
    // SKUs are ORDINARY Listing rows and nothing else distinguishes them.
    const p = plan({ context: { now: NOON, deskSellerIds: [] } })
    expect(p).toMatchObject({ send: false, reason: 'edition_unresolved', cursorTo: null })
  })

  it('never lets a desk listing into an alert on the marketplace', () => {
    const p = plan({ candidates: [candidate('visa-sku', { sellerId: 'seller-desk' }), candidate('L1')] })
    expect(p.namedListingIds).toEqual(['L1'])
    expect(p.skipped).toContainEqual({ listingId: 'visa-sku', reason: 'desk_listing' })
  })

  it('suppresses the whole alert when EVERY match is the desk', () => {
    const p = plan({ candidates: [candidate('visa-sku', { sellerId: 'seller-desk' })] })
    expect(p).toMatchObject({ send: false, reason: 'nothing_new' })
  })

  it('allows the desk on the services edition, where it is the merchant', () => {
    const p = plan({
      candidates: [candidate('visa-sku', { sellerId: 'seller-desk' })],
      context: { now: NOON, deskSellerIds: [], servicesEdition: true },
    })
    expect(p.send).toBe(true)
    expect(p.namedListingIds).toEqual(['visa-sku'])
  })
})

/* ── The saved-search planner: what counts as something to say ─────────────────────────────── */

describe('planSavedSearchAlert — candidate filtering', () => {
  it('requires a new match to be strictly newer than the cursor', () => {
    const cursor = search().lastNotifiedAt
    const p = plan({
      candidates: [
        candidate('older', { createdAt: new Date(cursor.getTime() - 1) }),
        candidate('exactly-at-cursor', { createdAt: cursor }),
        candidate('newer', { createdAt: new Date(cursor.getTime() + 1) }),
      ],
    })
    expect(p.namedListingIds).toEqual(['newer'])
    expect(p.skipped.map((s) => s.reason)).toEqual(['not_new', 'not_new'])
  })

  it('never alerts the same listing twice for the same search', () => {
    const p = plan({ search: search({ notified: [{ id: 'L1', price: 1_000_000 }] }) })
    expect(p).toMatchObject({ send: false, reason: 'nothing_new' })
    expect(p.skipped).toEqual([{ listingId: 'L1', reason: 'already_notified' }])
  })

  it('collapses a duplicate id inside one batch', () => {
    const p = plan({ candidates: [candidate('L1'), candidate('L1')] })
    expect(p.matchCount).toBe(1)
    expect(p.recordListingIds).toEqual(['L1'])
  })

  it('holds the cursor when there is nothing to say, so the cooldown keeps its meaning', () => {
    // `lastNotifiedAt` doubles as "when we last SPOKE". Advancing it on a silent run would push
    // the per-search cooldown forward without anyone having been told anything.
    const p = plan({ candidates: [] })
    expect(p).toMatchObject({ send: false, reason: 'nothing_new', cursorTo: null })
  })
})

/* ── The saved-search planner: timing ──────────────────────────────────────────────────────── */

describe('planSavedSearchAlert — timing defers, it does not discard', () => {
  it('holds a 3am match until 07:00 WITHOUT advancing the cursor', () => {
    const now = localTime(3)
    const p = plan({
      search: search({ lastNotifiedAt: new Date(now.getTime() - 3 * DAY) }),
      candidates: [candidate('L1', { createdAt: new Date(now.getTime() - HOUR) })],
      context: { now, deskSellerIds: DESK },
    })
    expect(p).toMatchObject({ send: false, reason: 'quiet_hours', cursorTo: null })
    expect(p.retryAfter?.getTime()).toBe(localTime(7).getTime())
    // The match is still counted, so the caller can log what is waiting.
    expect(p.matchCount).toBe(1)
    // And nothing is recorded as notified — it has not been.
    expect(p.recordListingIds).toEqual([])
    expect(p.notified).toBeNull()
  })

  it('batches the overnight backlog into ONE alert at 07:00', () => {
    const now = localTime(7, 30)
    const overnight = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      candidate(id, { createdAt: new Date(now.getTime() - 5 * HOUR) }),
    )
    const p = plan({
      search: search({ lastNotifiedAt: new Date(now.getTime() - 3 * DAY) }),
      candidates: overnight,
      context: { now, deskSellerIds: DESK },
    })
    expect(p.send).toBe(true)
    expect(p.matchCount).toBe(5)
    // Five rows on a lock screen is five interruptions; the headline carries the number and the
    // body names at most three.
    expect(p.namedListingIds).toHaveLength(ALERTS.MAX_LISTINGS_NAMED)
    expect(p.recordListingIds).toHaveLength(5)
  })

  it('enforces a gap between two alerts for the same search', () => {
    const last = new Date(NOON.getTime() - HOUR)
    const p = plan({
      search: search({ lastNotifiedAt: last }),
      candidates: [candidate('L1', { createdAt: new Date(NOON.getTime() - 30 * 60_000) })],
    })
    expect(p).toMatchObject({ send: false, reason: 'search_cooldown', cursorTo: null })
    expect(p.retryAfter?.getTime()).toBe(last.getTime() + ALERTS.PER_SEARCH_GAP_MS)
  })

  it('holds at the daily cap and says when a slot frees', () => {
    const oldest = new Date(NOON.getTime() - 10 * HOUR)
    const sentAt = [oldest, new Date(NOON.getTime() - 2 * HOUR), new Date(NOON.getTime() - HOUR)]
    const p = plan({ recipient: recipient({ sentAt }) })
    expect(p).toMatchObject({ send: false, reason: 'daily_cap', cursorTo: null })
    expect(p.retryAfter?.getTime()).toBe(oldest.getTime() + DAY)
  })

  it('holds at the weekly cap even when today has spare daily budget', () => {
    // Spread across days 1.0 … 5.5, so NOTHING falls in the trailing 24h — the daily cap has room
    // and only the weekly one binds. Without it, three a day for seven days is twenty-one.
    const sentAt = Array.from({ length: ALERTS.PER_USER_WEEK_CAP }, (_, i) => new Date(NOON.getTime() - ((i + 2) * DAY) / 2))
    const budget = alertBudget(sentAt, NOON)
    expect(budget.dayCapped).toBe(false)
    expect(budget.weekCapped).toBe(true)
    const p = plan({ recipient: recipient({ sentAt }) })
    expect(p).toMatchObject({ send: false, reason: 'weekly_cap', cursorTo: null })
  })

  it('advances past permanently-disqualified matches — but only with a separate alert clock', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED. A search whose only matches are the desk's listings never
    // advanced, so the cron re-fetched and re-rejected the identical rows on every tick forever
    // and the scan window only grew. Advancing WITHOUT a `lastAlertAt` column would be worse: the
    // cooldown reads that same field, so it would move every run and block the search permanently.
    const desk = [candidate('visa-sku', { sellerId: 'seller-desk' })]
    const frozen = plan({ candidates: desk })
    expect(frozen).toMatchObject({ reason: 'nothing_new', cursorTo: null })

    const withClock = plan({ search: search({ lastAlertAt: new Date(NOON.getTime() - 3 * DAY) }), candidates: desk })
    expect(withClock).toMatchObject({ reason: 'nothing_new' })
    expect(withClock.cursorTo).toBe(NOON)
  })

  it('moves a truncated cursor to the NEWEST ROW IT SAW, never to now', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED. Returning null here froze the search forever: a bounded query
    // whose whole batch is unalertable (fifty desk listings, or fifty already-notified ids) skipped
    // them all, held the cursor, and re-fetched the identical batch on every tick — so every newer
    // match queued behind it was never reached. Refusing to advance is right for rows nobody LOOKED
    // at; a row we examined and rejected is a row we are done with.
    const newest = new Date(NOON.getTime() - 2 * HOUR)
    const bounded = plan({
      candidates: [candidate('L1', { createdAt: new Date(NOON.getTime() - 5 * HOUR) }), candidate('L2', { createdAt: newest })],
      candidatesTruncated: true,
    })
    expect(bounded.send).toBe(true)
    expect(bounded.cursorTo?.getTime()).toBe(newest.getTime())

    // The freeze case: a full batch of desk listings still moves the cursor past them.
    const allDesk = plan({
      search: search({ lastAlertAt: new Date(NOON.getTime() - 3 * DAY) }),
      candidates: [candidate('v1', { sellerId: 'seller-desk', createdAt: newest })],
      candidatesTruncated: true,
    })
    expect(allDesk).toMatchObject({ reason: 'nothing_new' })
    expect(allDesk.cursorTo?.getTime()).toBe(newest.getTime())

    // Nothing examined at all → nothing to advance past.
    const empty = plan({ search: search({ lastAlertAt: new Date(NOON.getTime() - 3 * DAY) }), candidates: [], candidatesTruncated: true })
    expect(empty).toMatchObject({ reason: 'nothing_new', cursorTo: null })
  })

  it('checks "is there anything to say" BEFORE timing, so a silent run never logs a deferral', () => {
    const now = localTime(3)
    const p = plan({ candidates: [], context: { now, deskSellerIds: DESK } })
    expect(p.reason).toBe('nothing_new')
    expect(p.retryAfter).toBeNull()
  })
})

/* ── The saved-search planner: the happy path and its side effects ─────────────────────────── */

describe('planSavedSearchAlert — sending', () => {
  it('returns the COMPLETE write set, so no caller has to reconstruct one', () => {
    const p = plan({ candidates: [candidate('L1')] })
    expect(p).toMatchObject({ send: true, cursorTo: NOON, alertedAt: NOON })
    expect(p.notified).toEqual([{ id: 'L1', price: 1_000_000 }])
    // And nothing to write when nothing was said.
    expect(plan({ candidates: [] })).toMatchObject({ cursorTo: null, alertedAt: null, notified: null })
  })

  it('is not muted by a future-dated cooldown clock', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED. `now - lastSpoke` is negative for a future timestamp, so it
    // sat permanently under the six-hour gap and the search went quiet until real time caught up.
    // alertBudget and listing-health already refused to trust a future clock; this one did not.
    const p = plan({ search: search({ lastAlertAt: new Date(NOON.getTime() + 90 * DAY) }) })
    expect(p).toMatchObject({ send: true, reason: 'sent' })
    expect(preflightAlert(search({ lastAlertAt: new Date(NOON.getTime() + 90 * DAY) }), recipient(), { now: NOON, deskSellerIds: DESK })).toBeNull()
  })

  it('advances the cursor to now and records every notifiable id', () => {
    const p = plan({ candidates: [candidate('L1'), candidate('L2')] })
    expect(p).toMatchObject({ send: true, reason: 'sent', matchCount: 2 })
    expect(p.cursorTo).toBe(NOON)
    expect(p.recordListingIds).toEqual(['L1', 'L2'])
    expect(p.notified).toEqual([{ id: 'L1', price: 1_000_000 }, { id: 'L2', price: 1_000_000 }])
  })

  it('merges into existing memory newest-first', () => {
    const p = plan({ search: search({ notified: [{ id: 'old', price: 5_000 }] }), candidates: [candidate('L1')] })
    expect(p.notified).toEqual([{ id: 'L1', price: 1_000_000 }, { id: 'old', price: 5_000 }])
  })

  it('a second run over the same listing is silent — the end-to-end dedup', () => {
    const first = plan({ candidates: [candidate('L1')] })
    expect(first.send).toBe(true)
    const second = planSavedSearchAlert({
      kind: 'new_match',
      search: search({ lastNotifiedAt: first.cursorTo!, notified: first.notified! }),
      candidates: [candidate('L1')],
      recipient: recipient(),
      context: { now: new Date(NOON.getTime() + 7 * HOUR), deskSellerIds: DESK },
    })
    expect(second).toMatchObject({ send: false, reason: 'nothing_new' })
  })

  it('folds the UNREAD count too, or the dormancy ceiling does nothing in one pass', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED — the same immutable-input bug this helper exists to fix, one
    // field over. A buyer at two unread with five matching searches: every plan re-reads 2, clears
    // the dormancy gate every time, and they finish at five unread against a ceiling of three.
    let history = recipient({ unreadAlerts: ALERTS.MAX_UNREAD_ALERTS - 1 })
    let sent = 0
    for (let i = 0; i < 5; i++) {
      const p = planSavedSearchAlert({
        kind: 'new_match',
        search: search({ id: `ss${i}` }),
        candidates: [candidate(`L${i}`)],
        recipient: history,
        context: { now: NOON, deskSellerIds: DESK },
      })
      if (!p.send) continue
      sent++
      history = withAlertSent(history, NOON)
    }
    expect(sent).toBe(1)
    expect(history.unreadAlerts).toBe(ALERTS.MAX_UNREAD_ALERTS)
  })

  it('folds a send back into the recipient budget, or the per-user cap does nothing', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED. RecipientAlertHistory is an immutable input and the caller
    // loops over EVERY saved search a user owns. Without folding, five matching searches each read
    // the same untouched sentAt, each decide they have budget, and the cap of three sends five.
    let history = recipient()
    let sent = 0
    for (let i = 0; i < 5; i++) {
      const p = planSavedSearchAlert({
        kind: 'new_match',
        search: search({ id: `ss${i}` }),
        candidates: [candidate(`L${i}`)],
        recipient: history,
        context: { now: NOON, deskSellerIds: DESK },
      })
      if (!p.send) continue
      sent++
      history = withAlertSent(history, NOON)
    }
    expect(sent).toBe(ALERTS.PER_USER_DAY_CAP)
    // And the un-folded version is the bug, so it must be visibly different.
    expect(alertBudget(history.sentAt, NOON).dayCapped).toBe(true)
  })
})

/* ── The saved-search planner: the price-drop kind ─────────────────────────────────────────── */

describe('planSavedSearchAlert — kind price_drop', () => {
  const old = new Date(NOON.getTime() - 30 * DAY) // created long before the cursor

  it('does NOT require newness — a drop is about a listing that already existed', () => {
    const p = plan({
      kind: 'price_drop',
      candidates: [candidate('L1', { createdAt: old, price: 800_000, referencePrice: 1_000_000 })],
    })
    expect(p).toMatchObject({ send: true, kind: 'price_drop', matchCount: 1 })
  })

  it('applies both price floors to each candidate', () => {
    const p = plan({
      kind: 'price_drop',
      candidates: [
        candidate('no-ref', { createdAt: old, price: 800_000, referencePrice: null }),
        candidate('too-shallow', { createdAt: old, price: 950_000, referencePrice: 1_000_000 }),
        candidate('pennies', { createdAt: old, price: 240_000, referencePrice: 300_000 }),
        candidate('real', { createdAt: old, price: 800_000, referencePrice: 1_000_000 }),
      ],
    })
    expect(p.namedListingIds).toEqual(['real'])
    expect(p.skipped).toEqual([
      { listingId: 'no-ref', reason: 'no_reference' },
      { listingId: 'too-shallow', reason: 'drop_too_small' },
      { listingId: 'pennies', reason: 'saving_too_small' },
    ])
  })

  it('leans on the dedup memory, which the cursor alone cannot provide here', () => {
    // ⚠️ This is the case that makes SavedSearch.notified necessary rather than nice: an old
    // listing is behind the cursor on every run forever, so without memory it re-alerts.
    const p = plan({
      kind: 'price_drop',
      search: search({ notified: [{ id: 'L1', price: 800_000 }] }),
      candidates: [candidate('L1', { createdAt: old, price: 800_000, referencePrice: 1_000_000 })],
    })
    expect(p).toMatchObject({ send: false, reason: 'nothing_new' })
  })

  it('DOES speak again when the price falls a full ratchet below what we last quoted', () => {
    const p = plan({
      kind: 'price_drop',
      search: search({ notified: [{ id: 'L1', price: 800_000 }] }),
      candidates: [candidate('L1', { createdAt: old, price: 700_000, referencePrice: 1_000_000 })],
    })
    expect(p).toMatchObject({ send: true, matchCount: 1 })
    expect(p.notified).toEqual([{ id: 'L1', price: 700_000 }])
  })

  it('NEVER moves the cursor on an EMPTY sweep either — the bug all three reviewers found', () => {
    // ⚠️ A drop sweep almost always finds nothing notifiable, and a drop-running deployment always
    // supplies lastAlertAt, so the `nothing_new` branch missing its `kind` check meant the 09:00
    // sweep set the cursor to 09:00 and every listing posted 07:00–08:59 fell behind it, unexamined
    // and permanently unalertable. The common path, not an edge case.
    const p = plan({
      kind: 'price_drop',
      search: search({ lastAlertAt: new Date(NOON.getTime() - 3 * DAY) }),
      candidates: [candidate('L1', { createdAt: old, price: 950_000, referencePrice: 1_000_000 })],
    })
    expect(p).toMatchObject({ send: false, reason: 'nothing_new', cursorTo: null })
  })

  it('NEVER moves the cursor, even on a successful send', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED. A drop run only ever looks at old listings, so advancing the
    // cursor would push the search past everything posted since the last new-match run — three
    // listings posted 07:00–08:59 vanish behind a 09:00 drop alert, unexamined and unalertable.
    const p = plan({
      kind: 'price_drop',
      candidates: [candidate('L1', { createdAt: old, price: 800_000, referencePrice: 1_000_000 })],
    })
    expect(p.send).toBe(true)
    expect(p.cursorTo).toBeNull()
  })

  it('covers only what it can remember, and leaves the rest for the next run', () => {
    const many = Array.from({ length: ALERTS.MAX_RECORDED_PER_RUN + 10 }, (_, i) =>
      candidate(`L${i}`, { createdAt: old, price: 800_000, referencePrice: 1_000_000 }),
    )
    const p = plan({ kind: 'price_drop', candidates: many })
    // matchCount is what this alert COVERS, not what matched — claiming the rest would be a lie,
    // because nothing records them and they will be alerted again next run.
    expect(p.matchCount).toBe(ALERTS.MAX_RECORDED_PER_RUN)
    expect(p.recordListingIds).toHaveLength(ALERTS.MAX_RECORDED_PER_RUN)
  })

  it('reads the cooldown from lastAlertAt, since the cursor no longer tracks it', () => {
    const spoke = new Date(NOON.getTime() - HOUR)
    const p = plan({
      kind: 'price_drop',
      search: search({ lastAlertAt: spoke }),
      candidates: [candidate('L1', { createdAt: old, price: 800_000, referencePrice: 1_000_000 })],
    })
    expect(p).toMatchObject({ send: false, reason: 'search_cooldown' })
    expect(p.retryAfter?.getTime()).toBe(spoke.getTime() + ALERTS.PER_SEARCH_GAP_MS)
  })
})

/* ── The cheap pre-check ───────────────────────────────────────────────────────────────────── */

describe('preflightAlert — skip the candidate query when it cannot matter', () => {
  it('answers null when the search should be examined', () => {
    expect(preflightAlert(search(), recipient(), { now: NOON, deskSellerIds: DESK })).toBeNull()
  })

  it('short-circuits every state that no candidate could rescue', () => {
    const ctx = { now: NOON, deskSellerIds: DESK }
    expect(preflightAlert(search({ notify: false }), recipient(), ctx)).toBe('search_muted')
    expect(preflightAlert(search(), recipient({ muted: true }), ctx)).toBe('recipient_muted')
    expect(preflightAlert(search(), recipient({ unreadAlerts: ALERTS.MAX_UNREAD_ALERTS }), ctx)).toBe('dormant')
    expect(preflightAlert(search(), recipient(), { now: NOON, deskSellerIds: [] })).toBe('edition_unresolved')
    expect(preflightAlert(search(), recipient(), { now: localTime(3), deskSellerIds: DESK })).toBe('quiet_hours')
    expect(preflightAlert(search({ lastNotifiedAt: new Date(NOON.getTime() - HOUR) }), recipient(), ctx)).toBe('search_cooldown')
    const sentAt = Array.from({ length: ALERTS.PER_USER_DAY_CAP }, () => new Date(NOON.getTime() - HOUR))
    expect(preflightAlert(search(), recipient({ sentAt }), ctx)).toBe('daily_cap')
  })

  it('agrees with the planner wherever the planner would also block', () => {
    // It is an optimisation, so it may never say "go" where the planner says "stop" for a reason
    // no candidate can change. The reverse IS allowed: quiet hours here, nothing_new there.
    const ctx = { now: localTime(3), deskSellerIds: DESK }
    expect(preflightAlert(search(), recipient(), ctx)).toBe('quiet_hours')
    expect(plan({ context: ctx, search: search(), candidates: [candidate('L1')] }).send).toBe(false)
  })
})

/* ── The per-recipient price-drop planner ──────────────────────────────────────────────────── */

describe('planPriceDropAlert', () => {
  const listing = (over: Partial<AlertCandidate> = {}) =>
    candidate('L1', { price: 800_000, referencePrice: 1_000_000, ...over })

  const drop = (over: Partial<Parameters<typeof planPriceDropAlert>[0]> = {}) =>
    planPriceDropAlert({
      listing: listing(),
      recipient: recipient(),
      context: { now: NOON, deskSellerIds: DESK },
      ...over,
    })

  it('sends and pushes a genuine drop in waking hours, and says what to remember', () => {
    expect(drop()).toMatchObject({
      send: true,
      push: true,
      reason: 'sent',
      savingVnd: 200_000,
      record: { id: 'L1', price: 800_000 },
    })
    // A SILENT row is still a thing the buyer can find, so it is still recorded.
    expect(drop({ context: { now: localTime(2), deskSellerIds: DESK } }).record).toEqual({ id: 'L1', price: 800_000 })
    // Nothing sent, nothing to remember.
    expect(drop({ recipient: recipient({ muted: true }) }).record).toBeNull()
  })

  it('WRITES THE BELL ROW BUT DROPS THE PUSH during quiet hours', () => {
    // ⚠️ The asymmetry with saved searches. priceChangeEffects() stamps priceDropNotifiedAt and
    // lowestNotifiedPrice at decision time and never retries, so deferring a drop DESTROYS it.
    // Suppressing only the push loses nothing and wakes nobody.
    const p = drop({ context: { now: localTime(2), deskSellerIds: DESK } })
    expect(p).toMatchObject({ send: true, push: false, reason: 'quiet_hours' })
    expect(p.retryAfter?.getTime()).toBe(localTime(7).getTime())
  })

  it('refuses a desk listing, and refuses everything when the desk is unresolved', () => {
    expect(drop({ listing: listing({ sellerId: 'seller-desk' }) }).reason).toBe('desk_listing')
    expect(drop({ context: { now: NOON, deskSellerIds: [] } }).reason).toBe('edition_unresolved')
  })

  it('applies the floors before the budget, so a worthless drop never burns a retry decision', () => {
    const p = drop({
      listing: listing({ price: 950_000 }),
      recipient: recipient({ sentAt: [NOON, NOON, NOON] }), // already at the daily cap
    })
    expect(p.reason).toBe('drop_too_small')
    expect(p.retryAfter).toBeNull()
  })

  it('never repeats itself to the same person unless the deal got a full ratchet better', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED. Bare-id dedup here contradicted the sibling saved-search
    // path AND `lowestNotifiedPrice`: once a listing had been mentioned, a further 20% cut was
    // silently unmentionable. The two drop paths must agree about when a better deal earns a word.
    expect(drop({ alreadyAlerted: [{ id: 'L1', price: 800_000 }] }).reason).toBe('already_notified')
    expect(drop({ alreadyAlerted: [{ id: 'L1', price: 850_000 }] }).reason).toBe('already_notified')
    expect(drop({ listing: listing({ price: 700_000 }), alreadyAlerted: [{ id: 'L1', price: 800_000 }] }))
      .toMatchObject({ send: true, reason: 'sent' })
    expect(drop({ alreadyAlerted: [{ id: 'other', price: 10 }] }).reason).toBe('sent')
  })

  it('DEGRADES at the cap instead of destroying the drop', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED against this module's own quiet-hours reasoning. The event is
    // irreversible — priceChangeEffects() stamps the ratchet at decision time and never retries —
    // so `send: false` meant a buyer who happened to get three alerts earlier that day lost a
    // 60%-off drop entirely: no bell row, no second chance, no way to learn it happened. A cap that
    // deletes an irreversible event is data loss, not a rate limit. The buzz is the interruption.
    const sentAt = Array.from({ length: ALERTS.PER_USER_DAY_CAP }, () => new Date(NOON.getTime() - HOUR))
    const p = drop({ recipient: recipient({ sentAt }) })
    expect(p).toMatchObject({ send: true, push: false, reason: 'daily_cap' })
    expect(p.retryAfter).not.toBeNull()
  })

  it('still refuses outright where consent or the price floor says no', () => {
    // The split: timing and budget stop the buzz; consent and correctness stop the row.
    expect(drop({ recipient: recipient({ muted: true }) })).toMatchObject({ send: false, push: false })
    expect(drop({ listing: listing({ price: 950_000 }) })).toMatchObject({ send: false })
    expect(drop({ listing: listing({ sellerId: 'seller-desk' }) })).toMatchObject({ send: false })
  })

  it('goes SILENT for a recipient who is not reading, rather than destroying the drop', () => {
    // ⚠️ REVIEWER FINDING, CONFIRMED. Dormancy is an INFERENCE from three unread bell rows, not
    // consent, and an inference must not delete an irreversible event when the caps — which are
    // stricter evidence — only silence it. Explicit `muted` still stops the row.
    const p = drop({ recipient: recipient({ unreadAlerts: ALERTS.MAX_UNREAD_ALERTS }) })
    expect(p).toMatchObject({ send: true, push: false, reason: 'dormant' })
    expect(p.record).toEqual({ id: 'L1', price: 800_000 })
    expect(drop({ recipient: recipient({ muted: true }) })).toMatchObject({ send: false, push: false })
  })
})
