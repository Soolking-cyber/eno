import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { identityMarkFacts, NO_IDENTITY_MARK_FACTS, type IdentityMarkFacts } from '@/lib/kyc/identity'
import { IDENTITY_MARK_NOTICE_VERSION } from '@/lib/teachers/constants'

// ── "IDENTITY VERIFIED" — WHETHER A TEACHER'S MARK SHOWS, AND WHY NOT (owner, 2026-10-15; AUTOMATIC since 2026-10-16) ────
//
// The owner's decision: the mark shows on the teacher's profile, on their card in lists and as a chip to the school or
// member chatting with them — ONLY while the identity check is LIVE and the profile's name is within the name on the ID;
// only a boolean ever leaves the server.
// ⛔ AUTOMATIC, NOT AN OPT-IN (owner, 2026-10-16: "if they verify it should be auto not need to ask they consent by
// uploading kyc" / "so show if kyc passed"). The consent is the identity declaration a teacher affirms before uploading
// (src/lib/compliance/declaration-text.ts — identity-v2's clause 5); for the identities verified under identity-v1, which
// never mentioned it, the owner chose to show them too, risk accepted (docs/compliance/pdpl-dossier-draft.md). What is
// left to the teacher is to HIDE it — at any time, before or after publishing — and to show it again.
//
// ⛔ "HIDDEN" IS THE TEACHER'S LAST ACT, READ FROM THE TWO SWITCH COLUMNS — NO NEW COLUMN, NO BACKFILL:
//   · identityMarkOn = true      — the teacher's last act was SHOW (switched on under the old opt-in, or shown again);
//   · identityMarkWithdrawnAt    — the last HIDE (an opt-in switch-off carries over as a hide);
//   · hidden ⇔ !identityMarkOn && identityMarkWithdrawnAt !== null. A row nobody ever touched (false, null) is NOT
//     hidden: the default is shown. Every hide writes (false, now) and every show writes true (publish.ts
//     saveTeacherIdentityMark), so the rule always reads the last act — and no row ever claims an act nobody made.
//
// ⛔ ONE PREDICATE FOR EVERY SURFACE. The profile line, the card's display cache (identity-mark-card.ts), the chat chip
// and the teacher's own form all ask HERE, so "verified" cannot come to mean two things on two surfaces. It is decided
// from three facts (src/lib/kyc/identity.ts identityMarkFacts — the identity rows' one derivation, read uncached) and the
// teacher's own hide; never from Profile.verificationStatus (a cache that lags a lapse by hours), never from a
// request-memoised read (verifiedIdentityFor). The card cache may only SKIP the read on a public surface
// (identityMarkShownOnCard) — it never decides a tick on its own, and a writer never consults it.
// ⛔ WHAT LEAVES: `shown` to the public surfaces — a boolean, nothing else. `reason` only to the teacher themself (their
// form, auth 'profile'): it says which of their own states holds the mark back, never anything about the document.
// ⚠️ IT NEVER LOGS ITS INPUT: a caller's row can carry TeacherPrivate (the phone, the email) beside these four fields.

/** The four TeacherProfile columns the mark is decided from — select exactly these where a row is read for it. */
export const IDENTITY_MARK_TP_SELECT = { profileId: true, fullName: true, identityMarkOn: true, identityMarkWithdrawnAt: true } as const

/**
 * Why the mark is NOT shown — the teacher's own state lines (C8), in the order they are checked (identityMarkStateOf):
 *   · the identity: `revoked` · `pending` (a first check, or a renewal of an expired one) · `expired` · `unverified`
 *     (none, or only a rejection) — the identity facts come first, because nothing the teacher switches can make them true;
 *   · the name: `no_name` (the verified record carries no name to compare) · `name_mismatch` (the profile's name adds a
 *     word the ID does not carry, or leaves out a surname — identity/verify-decision.ts nameWithinDocument);
 *   · the profile: `no_profile` (no TeacherProfile yet — the join form's read; nothing is published to carry it);
 *   · the teacher's choice: `hidden` (they hid it — see the header).
 */
export type IdentityMarkReason =
  | 'unverified' | 'pending' | 'expired' | 'revoked'
  | 'no_name' | 'name_mismatch'
  | 'no_profile' | 'hidden'

/** Shown with no reason, or not shown with exactly one. */
export type IdentityMarkState = { shown: true; reason: null } | { shown: false; reason: IdentityMarkReason }

/**
 * What the mark is decided from on the teacher's side. `fullName: null` = there is no TeacherProfile (the join form's
 * read): never shown, and no name to judge.
 */
export type IdentityMarkInput = {
  profileId: string
  fullName: string | null
  identityMarkOn: boolean
  identityMarkWithdrawnAt: Date | null
}

/** What a read of the identity facts needs — `db`, or a transaction judging inside itself. */
export type IdentityMarkReader = Pick<Prisma.TransactionClient, 'identityVerification'>

/** The teacher hid the mark: their last act on the switch was a hide (header). Untouched = not hidden. */
export const identityMarkHidden = (m: Pick<IdentityMarkInput, 'identityMarkOn' | 'identityMarkWithdrawnAt'>): boolean =>
  m.identityMarkOn !== true && m.identityMarkWithdrawnAt !== null

const hide = (reason: IdentityMarkReason): IdentityMarkState => ({ shown: false, reason })

/**
 * THE MATRIX, PURE, IN ITS ORDER. Each step answers only if every step above it passed:
 *   1. revoked → `revoked` (an admin or authority act outranks everything);
 *   2. pending, or expired with a renewal in flight → `pending`;
 *   3. expired → `expired`;
 *   4. anything else not verified (none, rejected) → `unverified`;
 *   5. a profile exists (fullName not null): no name on the verified record → `no_name`; not within it → `name_mismatch`;
 *   6. no profile → `no_profile`;
 *   7. hidden by the teacher → `hidden`;
 *   8. otherwise SHOWN.
 */
export function identityMarkStateOf(m: IdentityMarkInput, f: IdentityMarkFacts): IdentityMarkState {
  if (f.status === 'revoked') return hide('revoked')
  if (f.status === 'pending' || (f.status === 'expired' && f.resubmitted)) return hide('pending')
  if (f.status === 'expired') return hide('expired')
  if (f.status !== 'verified') return hide('unverified')
  if (m.fullName !== null) {
    if (f.name === 'none') return hide('no_name')
    if (f.name === 'mismatch') return hide('name_mismatch')
  }
  if (m.fullName === null) return hide('no_profile')
  if (identityMarkHidden(m)) return hide('hidden')
  return { shown: true, reason: null }
}

/** The state, with the one read of the identity facts it needs (on `client` — a transaction passes itself). */
export async function identityMarkState(m: IdentityMarkInput, now: Date = new Date(), client: IdentityMarkReader = db): Promise<IdentityMarkState> {
  const facts = await identityMarkFacts([{ profileId: m.profileId, displayName: m.fullName ?? '' }], now, client)
  return identityMarkStateOf(m, facts.get(m.profileId) ?? NO_IDENTITY_MARK_FACTS)
}

/**
 * Could the mark show at all, on the teacher's side alone: a profile with a name, and not hidden. When this is false
 * nothing about the identity can make the mark show, so nothing needs to be read.
 */
export const identityMarkMayShow = (m: IdentityMarkInput): boolean =>
  !identityMarkHidden(m) && (m.fullName ?? '').trim() !== ''

/**
 * THE BOOLEAN, JUDGED LIVE — for a WRITER (the full save's card re-derivation) and any reader with no card cache in hand.
 * Zero reads for a hidden mark or a nameless row; otherwise one indexed identity read, no memo (an approval or a
 * revocation must be seen by the very next call).
 */
export async function identityMarkShownFor(m: IdentityMarkInput, now: Date = new Date(), client: IdentityMarkReader = db): Promise<boolean> {
  if (!identityMarkMayShow(m)) return false
  return (await identityMarkState(m, now, client)).shown
}

/**
 * THE BOOLEAN FOR A PUBLIC SURFACE THAT ALREADY HOLDS THE CARD CACHE (the profile page, the chat chip): `card` is the
 * teacher listing's Listing.identityMarkNotice as loaded with it. ⛔ THE CACHE ONLY SKIPS, NEVER DECIDES: unless it
 * carries today's value the answer is false with ZERO reads — the chat route is the most-polled route in the app, and
 * nearly every teacher has no tick — and when it does, the mark is judged LIVE (a lapse or a revocation since the cache
 * was written shows on the very next call). Fails closed: a cache that is wrongly empty (a sync that failed) hides the
 * mark until the next card pass re-derives it; it can never show a tick the live rule refuses. ⛔ NEVER IN A WRITER:
 * the card cache is written FROM this predicate (identity-mark-card.ts, publish.ts) — gating that on the cache would
 * be circular, and a teacher whose cache is empty could never get the tick.
 */
export async function identityMarkShownOnCard(
  m: IdentityMarkInput,
  card: string | null | undefined,
  now: Date = new Date(),
  client: IdentityMarkReader = db,
): Promise<boolean> {
  if (card !== IDENTITY_MARK_NOTICE_VERSION) return false
  return identityMarkShownFor(m, now, client)
}
