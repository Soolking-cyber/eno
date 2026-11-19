import { createHash } from 'node:crypto'

/**
 * WHO GETS THE DIGEST TODAY. Owner, 2026-11-19, with a partner storefront's copy in the inbox: "dont send these to partner
 * emails also divide the load so that every day we send up to 90 for a week so 7x90 when we max that out we will do once in
 * 10 days and then 2ce a month after that we will upgrade."
 *
 * ⛔ WHY: every Thursday since 2026-10-29 the one-shot send hit Resend's daily quota (`daily_quota_exceeded`): 200–300 sent,
 * 106–171 failed every week, and always the same people, the end of a list ordered by id.
 *
 * So the timer runs DAILY. Each person has a fixed day in a cycle (a hash of their profile id), and a day sends only its own
 * people, never more than DIGEST_DAILY_CAP. The cycle is the shortest of DIGEST_CYCLES whose busiest day fits under the cap:
 * a week while the list fits, then every 10 days, then twice a month (every 15). Past that the cap still holds and the
 * excess is SKIPPED for that cycle, not delayed (`overCapacity`, `skippedOverCapacity`): the owner's signal to upgrade the
 * mail plan. Who is skipped rotates between cycles.
 * ⚠️ A HASH SLOT, NOT A RANK: a sign-up or an unsubscribe never moves anyone else's day. Only a cycle change (7 → 10 → 15)
 * re-deals the days, once.
 * ⚠️ The hash spreads days unevenly (a few percent either side of the mean), so the switch to 10 days comes before the
 * list reaches 630, when the busiest day would pass 90.
 * ⚠️ KNOWN LIMIT, STATELESS BY CHOICE: the cycle is read from today's list, so a list that SHRINKS back across a switch point
 * (an unsubscribe in the busiest day) re-deals the days again, and a few people can get two digests a few days apart around
 * that day. Growth only moves one way. Removing it needs a per-person "last sent" date, which is a Profile migration
 * (built and removed once, 2026-09-29, see the route).
 * Pure, and no clock of its own: the route passes `now`.
 */
export const DIGEST_DAILY_CAP = 90
/** Days between one person's digests, shortest first. */
export const DIGEST_CYCLES = [7, 10, 15] as const
/**
 * The first daily send, 2026-11-26 in Saigon. The old one-shot run went to everyone on 2026-11-19, so starting the cycle
 * a week later means nobody gets a second digest within seven days of that one.
 */
export const DIGEST_START_DAY = Date.UTC(2026, 10, 26) / 86_400_000
const ICT_OFFSET_MS = 7 * 3_600_000

/** The day number (days since 1970-01-01) of `now`'s calendar date in Saigon. The timer fires at 09:00 there. */
export function ictDay(now: Date): number {
  return Math.floor((now.getTime() + ICT_OFFSET_MS) / 86_400_000)
}

/** "2026-11-26" for an ictDay() number. */
export function ictDayLabel(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10)
}

const hashNum = (s: string) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16)

/** A person's fixed day in a `cycle`-day cycle: 0 … cycle − 1. */
export function digestSlot(profileId: string, cycle: number): number {
  return hashNum(profileId) % cycle
}

/**
 * Our own domains, which include the partner storefronts' placeholder logins (support+<handle>@eno.vn). Never marketing
 * mail. Subdomains count too.
 */
export function isOwnDomainEmail(email: string): boolean {
  return /@(?:[a-z0-9-]+\.)*eno\.(?:vn|forum)$/i.test(email.trim())
}

export type DigestDayPlan<T> =
  | { started: false; startsOn: string }
  | { started: true; cycleDays: number; slot: number; due: T[]; skippedOverCapacity: number; overCapacity: boolean }

/** Today's share of the eligible list (already filtered: opted in, a real address, not a partner, not our own domain). */
export function planDigestDay<T extends { id: string }>(rows: readonly T[], now: Date): DigestDayPlan<T> {
  const day = ictDay(now)
  if (day < DIGEST_START_DAY) return { started: false, startsOn: ictDayLabel(DIGEST_START_DAY) }
  let cycleDays: number = DIGEST_CYCLES[DIGEST_CYCLES.length - 1]
  let overCapacity = true
  for (const c of DIGEST_CYCLES) {
    const perDay = new Array<number>(c).fill(0)
    for (const r of rows) perDay[digestSlot(r.id, c)] += 1
    if (Math.max(0, ...perDay) <= DIGEST_DAILY_CAP) {
      cycleDays = c
      overCapacity = false
      break
    }
  }
  const sinceStart = day - DIGEST_START_DAY
  const slot = sinceStart % cycleDays
  let today = rows.filter((r) => digestSlot(r.id, cycleDays) === slot)
  if (today.length > DIGEST_DAILY_CAP) {
    // Over capacity: who waits rotates with the cycle, so the same people are not the ones left out every time.
    const round = Math.floor(sinceStart / cycleDays)
    today = [...today].sort((a, b) => hashNum(`${a.id}:${round}`) - hashNum(`${b.id}:${round}`) || (a.id < b.id ? -1 : 1))
  }
  const due = today.slice(0, DIGEST_DAILY_CAP)
  return { started: true, cycleDays, slot, due, skippedOverCapacity: today.length - due.length, overCapacity }
}
