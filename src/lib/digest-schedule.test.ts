import { describe, expect, it } from 'vitest'
import { DIGEST_DAILY_CAP, DIGEST_START_DAY, digestSlot, ictDay, ictDayLabel, isOwnDomainEmail, planDigestDay } from './digest-schedule'

/**
 * Owner, 2026-11-19: "every day we send up to 90 for a week so 7x90 when we max that out we will do once in 10 days and then
 * 2ce a month after that we will upgrade", and never to a partner's address.
 */
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `profile-${i}` }))
/** 09:00 in Saigon on the given day (02:00 UTC), the timer's hour. */
const at = (day: number) => new Date(day * 86_400_000 + 2 * 3_600_000)

/** Run every day of one cycle and collect who was sent. */
function cycle(rows: { id: string }[], startDay = DIGEST_START_DAY) {
  const first = planDigestDay(rows, at(startDay))
  if (!first.started) throw new Error('not started')
  const sent: string[] = []
  const perDay: number[] = []
  for (let d = 0; d < first.cycleDays; d++) {
    const p = planDigestDay(rows, at(startDay + d))
    if (!p.started) throw new Error('not started')
    perDay.push(p.due.length)
    sent.push(...p.due.map((r) => r.id))
  }
  return { cycleDays: first.cycleDays, overCapacity: first.overCapacity, sent, perDay }
}

describe('ictDay', () => {
  it('is the calendar date in Saigon: 17:00 UTC is already the next day there', () => {
    const d = Date.UTC(2026, 10, 26)
    expect(ictDay(new Date(d + 2 * 3_600_000))).toBe(d / 86_400_000)
    expect(ictDay(new Date(d - 7 * 3_600_000))).toBe(d / 86_400_000) // 00:00 in Saigon
    expect(ictDay(new Date(d - 7 * 3_600_000 - 1))).toBe(d / 86_400_000 - 1)
    expect(ictDayLabel(ictDay(new Date(d + 2 * 3_600_000)))).toBe('2026-11-26')
  })
})

describe('planDigestDay', () => {
  it('sends nothing before 2026-11-26, a week after the last one-shot run', () => {
    expect(planDigestDay(people(10), at(DIGEST_START_DAY - 1))).toEqual({ started: false, startsOn: '2026-11-26' })
    expect(planDigestDay(people(10), at(DIGEST_START_DAY)).started).toBe(true)
  })

  it("today's list (384 people): a 7-day cycle, every person exactly once, never more than 90 a day", () => {
    const rows = people(384)
    const c = cycle(rows)
    expect(c.cycleDays).toBe(7)
    expect(c.overCapacity).toBe(false)
    expect([...c.sent].sort()).toEqual(rows.map((r) => r.id).sort())
    expect(Math.max(...c.perDay)).toBeLessThanOrEqual(DIGEST_DAILY_CAP)
  })

  it('a list too big for a week moves to every 10 days, still once each and at most 90 a day', () => {
    const rows = people(750)
    const c = cycle(rows)
    expect(c.cycleDays).toBe(10)
    expect([...c.sent].sort()).toEqual(rows.map((r) => r.id).sort())
    expect(Math.max(...c.perDay)).toBeLessThanOrEqual(DIGEST_DAILY_CAP)
  })

  it('then twice a month (every 15 days)', () => {
    const rows = people(1150)
    const c = cycle(rows)
    expect(c.cycleDays).toBe(15)
    expect(c.overCapacity).toBe(false)
    expect(new Set(c.sent).size).toBe(rows.length)
  })

  it('past that it still sends only 90 a day and says so (time to upgrade); who waits rotates between cycles', () => {
    const rows = people(2000)
    const p = planDigestDay(rows, at(DIGEST_START_DAY))
    if (!p.started) throw new Error('not started')
    expect(p.overCapacity).toBe(true)
    expect(p.cycleDays).toBe(15)
    expect(p.due).toHaveLength(DIGEST_DAILY_CAP)
    expect(p.skippedOverCapacity).toBeGreaterThan(0)
    const next = planDigestDay(rows, at(DIGEST_START_DAY + 15)) // the same slot, the next cycle
    if (!next.started) throw new Error('not started')
    expect(next.due.map((r) => r.id)).not.toEqual(p.due.map((r) => r.id))
  })

  it("a sign-up or an unsubscribe never moves anyone else's day", () => {
    const rows = people(300)
    const before = rows.map((r) => digestSlot(r.id, 7))
    const after = [...rows.slice(1), { id: 'someone-new' }].map((r) => digestSlot(r.id, 7))
    expect(after.slice(0, 299)).toEqual(before.slice(1))
  })

  it('the same day asked twice gives the same people (a rerun is recognised by its key)', () => {
    const a = planDigestDay(people(384), at(DIGEST_START_DAY + 3))
    const b = planDigestDay(people(384), new Date(at(DIGEST_START_DAY + 3).getTime() + 3_600_000))
    expect(a).toEqual(b)
  })
})

describe('isOwnDomainEmail', () => {
  it("our own domains, including the partner storefronts' placeholder logins", () => {
    for (const e of ['support+dienthoaivui@eno.vn', 'support@eno.forum', 'x@mail.eno.vn', ' SUPPORT@ENO.VN ']) expect(isOwnDomainEmail(e)).toBe(true)
  })
  it('never anyone else, even with eno in the name', () => {
    for (const e of ['minh@gmail.com', 'eno.vn@gmail.com', 'a@noteno.vn', 'a@eno.vn.example.com', 'a@xeno.forum']) expect(isOwnDomainEmail(e)).toBe(false)
  })
})
