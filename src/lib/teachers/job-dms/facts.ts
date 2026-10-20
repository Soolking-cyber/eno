/**
 * ONE JOB POST → READY | HELD | DROPPED. The rules' reading (extract.ts) and Laya's (laya.ts) meet here; a post becomes
 * READY — offered to matching teachers — only when nothing makes it unsafe or unactionable. Pure, unit-tested.
 *
 *   DROPPED (never matched): refused whole (gender, nationality, age, race, fees, adult venues, visa-only, abroad), not a
 *     job (a seeker, or anything else), no place in Vietnam and not online, or too old.
 *   HELD (kept, never sent, counted in the run's answer): a person-directed nationality/gender/age/looks word the
 *     refusals could not place (extract.ts demographicMention); in LAYA_ROLE 'veto' only, Laya confidently contradicts
 *     the rules on what the post is or who wrote it; a cover request from anyone but a school/centre/agency (eno's cover rule: cover work is for the
 *     employer); an HCMC cover request with no district (it could be anywhere in a 2,000 km² city); a Facebook post in a
 *     group not known to be PUBLIC (the teacher could not open it to apply); a forwarded post with no "Apply:" line.
 *
 * ⛔ "CONFIDENT" IS THIS LIST, NOT A SCORE. Every hold is a reason a message would mislead or dead-end; the evaluation
 * (~/eno-jobmatch-2026-10) measures the precision of what remains before live sends.
 */
import { JOB_DM_RULES, type JobSource } from './constants'
import type { LayaAnswers } from './laya'
import { top } from './laya-top'
import type { RuleFacts } from './extract'

export type PostMeta = {
  source: JobSource
  postedAt: Date | null
  receivedAt: Date
  groupPublic: boolean | null
  url: string | null
  applyText: string | null
}

export type Decision = {
  status: 'ready' | 'held' | 'dropped'
  reason: string | null
  /** after this the post is no longer offered (a cover lesson's day, else posted + jobFreshDays) */
  expiresAt: Date
}

/** Laya "contradicts" only at this confidence — it is over-confident by design, so the bar is high. */
export const LAYA_VETO_P = 0.7

/**
 * ⛔ LAYA RECORDS, IT DOES NOT DECIDE — measured, not assumed (2026-10-20, the 270 blind-labelled posts, ~/eno-jobmatch-2026-10/
 * eval/metrics.py): as a veto it held 32 good posts and 0 bad ones (recall 0.82 → 0.47, precision 0.99 → 0.98), and its
 * reading of what a post is was right 40 % of the time. So every run still asks it and stores its answers beside the
 * rules' (ExternalJobPost.facts.laya) — the record a calibration needs — and nothing waits on it: engine down or slow
 * holds nothing. 'veto' restores the hold below; switch only after a re-measure on labelled posts shows it removes bad
 * posts and not good ones.
 */
export const LAYA_ROLE: 'record' | 'veto' = 'record'

const DAY_MS = 86_400_000

/** End of a Vietnam calendar day ('2026-10-22' → 2026-10-22T16:59:59.999Z). */
export function endOfVnDay(isoDate: string): Date {
  return new Date(new Date(`${isoDate}T00:00:00.000Z`).getTime() + DAY_MS - 7 * 3_600_000 - 1)
}

/** When a part of a Vietnam day BEGINS — morning 07:00, afternoon 12:00, evening 17:00. */
const PART_START_H = { am: 7, pm: 12, eve: 17 } as const
export function partStartVn(isoDate: string, part: keyof typeof PART_START_H): Date {
  return new Date(new Date(`${isoDate}T00:00:00.000Z`).getTime() + (PART_START_H[part] - 7) * 3_600_000)
}

export function expiryOf(f: RuleFacts, meta: PostMeta): Date {
  const posted = meta.postedAt ?? meta.receivedAt
  if (f.kind === 'cover_request') {
    // A cover is worth offering only before its lesson: "tonight 6–7:30pm" stops at 17:00, not at midnight (opus, gate 1c).
    if (f.schedule?.date && f.schedule.part) return partStartVn(f.schedule.date, f.schedule.part)
    if (f.schedule?.date) return endOfVnDay(f.schedule.date)
    return new Date(posted.getTime() + JOB_DM_RULES.coverUndatedHours * 3_600_000)
  }
  return new Date(posted.getTime() + JOB_DM_RULES.jobFreshDays * DAY_MS)
}

export function decide(f: RuleFacts, meta: PostMeta, laya: LayaAnswers | null, now: Date, layaRole: 'record' | 'veto' = LAYA_ROLE): Decision {
  const expiresAt = expiryOf(f, meta)
  const drop = (reason: string): Decision => ({ status: 'dropped', reason, expiresAt })
  const hold = (reason: string): Decision => ({ status: 'held', reason, expiresAt })

  if (f.deny) return drop(`deny:${f.deny}`)
  // A LinkedIn alert or a team forward is read as a listing (readPost { listing }): no hiring words needed, every role
  // screen kept — so 'other' is dropped for every source (a "Sales Executive" alert is not a teaching job).
  if (f.kind === 'job_seeker' || f.kind === 'other') return drop(`kind:${f.kind}`)
  if (!f.places.length) return drop('no-place')
  if (expiresAt.getTime() <= now.getTime()) return drop('expired')
  if (meta.postedAt && now.getTime() - meta.postedAt.getTime() > 14 * DAY_MS) return drop('too-old')
  // A Facebook post with no date could be months old and look new (codex, opus — gate 1b). The Mac ships only dated
  // posts; this keeps it so. A team forward is dated by its email, a LinkedIn alert by its send.
  if (meta.source === 'fb' && !meta.postedAt) return hold('undated')

  const kind = f.kind
  if (f.mention) return hold(`mention:${f.mention}`)

  // Laya as a veto (LAYA_ROLE 'veto' only). Without Laya (engine down) a Facebook/forwarded post is then held unless the
  // rules' reading is the unambiguous kind: a school/agency poster for a job offer. LinkedIn needs no second reader.
  if (layaRole === 'veto' && meta.source !== 'linkedin') {
    if (laya) {
      const k = top(laya.kind)
      const layaKind = k.option === 'hiring' ? 'job_offer' : k.option === 'cover' ? 'cover_request' : k.option
      const contradicts = k.p >= LAYA_VETO_P && (layaKind === 'seeker' || layaKind === 'other' || (kind === 'job_offer' && layaKind === 'cover_request' && f.poster === 'teacher'))
      if (contradicts) return hold(`laya-kind:${String(k.option)}@${k.p.toFixed(2)}`)
      const w = top(laya.poster)
      if (kind === 'cover_request' && w.option === 'teacher' && w.p >= LAYA_VETO_P) return hold(`laya-poster:teacher@${w.p.toFixed(2)}`)
    } else if (!(kind === 'job_offer' && (f.poster === 'school' || f.poster === 'agency'))) {
      return hold('laya-unavailable')
    }
  }

  if (kind === 'cover_request') {
    if (f.poster !== 'school' && f.poster !== 'agency') return hold(`cover-poster:${f.poster}`)
    if (f.cityOnly) return hold('cover-hcmc-no-district')
  }
  if (meta.source === 'fb') {
    if (!meta.url) return hold('no-link')
    if (meta.groupPublic !== true) return hold(meta.groupPublic === false ? 'group-private' : 'group-privacy-unknown')
  }
  if (meta.source === 'intake' && !meta.applyText) return hold('no-apply-path')
  if (meta.source === 'linkedin' && !meta.url) return hold('no-link')
  return { status: 'ready', reason: null, expiresAt }
}
