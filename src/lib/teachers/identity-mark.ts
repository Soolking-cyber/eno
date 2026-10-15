import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { identityMarkFacts, NO_IDENTITY_MARK_FACTS, type IdentityMarkFacts } from '@/lib/kyc/identity'
import { IDENTITY_MARK_NOTICE_VERSION } from '@/lib/teachers/constants'

// ── "IDENTITY VERIFIED" — WHETHER A TEACHER'S MARK SHOWS, AND WHY NOT (owner, 2026-10-15) ───────────────────────────────
//
// The owner's decision: the mark shows on the teacher's profile, on their card in lists and as a chip to the school or
// member chatting with them — an OPT-IN under its own versioned consent, ONLY while the identity check is LIVE and the
// profile's name is within the name on the ID; only a boolean ever leaves the server.
//
// ⛔ ONE PREDICATE FOR EVERY SURFACE. The profile line, the card's display cache (identity-mark-card.ts), the chat chip
// and the teacher's own form all ask HERE, so "verified" cannot come to mean two things on two surfaces. It is decided
// from three facts (src/lib/kyc/identity.ts identityMarkFacts — the identity rows' one derivation, read uncached) and the
// teacher's own switch; never from Profile.verificationStatus (a cache that lags a lapse by hours), never from a
// request-memoised read (verifiedIdentityFor), never from the card cache itself (it lags a switch-off or a rename).
// ⛔ WHAT LEAVES: `shown` to the public surfaces — a boolean, nothing else. `reason` only to the teacher themself (their
// form, auth 'profile'): it says which of their own states holds the mark back, never anything about the document.
// ⚠️ IT NEVER LOGS ITS INPUT: a caller's row can carry TeacherPrivate (the phone, the email) beside these four fields.

/** The four TeacherProfile columns the mark is decided from — select exactly these where a row is read for it. */
export const IDENTITY_MARK_TP_SELECT = { profileId: true, fullName: true, identityMarkOn: true, identityMarkNoticeVersion: true } as const

/**
 * Why the mark is NOT shown — the teacher's own state lines (C8), in the order they are checked (identityMarkStateOf):
 *   · the identity: `revoked` · `pending` (a first check, or a renewal of an expired one) · `expired` · `unverified`
 *     (none, or only a rejection) — the identity facts come first, because no switch can make them true;
 *   · the name: `no_name` (the verified record carries no name to compare) · `name_mismatch` (the profile's name adds a
 *     word the ID does not carry, or leaves out a surname — identity/verify-decision.ts nameWithinDocument);
 *   · the consent: `off` (switched off, or no profile yet) · `notice_changed` (switched on under older words — it must be
 *     switched on again under today's IDENTITY_MARK_NOTICE_VERSION).
 */
export type IdentityMarkReason =
  | 'unverified' | 'pending' | 'expired' | 'revoked'
  | 'no_name' | 'name_mismatch'
  | 'off' | 'notice_changed'

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
  identityMarkNoticeVersion: string | null
}

/** What a read of the identity facts needs — `db`, or a transaction judging inside itself. */
export type IdentityMarkReader = Pick<Prisma.TransactionClient, 'identityVerification'>

const hide = (reason: IdentityMarkReason): IdentityMarkState => ({ shown: false, reason })

/**
 * THE MATRIX, PURE, IN ITS ORDER. Each step answers only if every step above it passed:
 *   1. revoked → `revoked` (an admin or authority act outranks everything, the switch included);
 *   2. pending, or expired with a renewal in flight → `pending`;
 *   3. expired → `expired`;
 *   4. anything else not verified (none, rejected) → `unverified`;
 *   5. a profile exists (fullName not null): no name on the verified record → `no_name`; not within it → `name_mismatch`;
 *   6. switched off, or no profile → `off`;
 *   7. switched on under another notice version → `notice_changed`;
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
  if (!m.identityMarkOn || m.fullName === null) return hide('off')
  if (m.identityMarkNoticeVersion !== IDENTITY_MARK_NOTICE_VERSION) return hide('notice_changed')
  return { shown: true, reason: null }
}

/** The state, with the one read of the identity facts it needs (on `client` — a transaction passes itself). */
export async function identityMarkState(m: IdentityMarkInput, now: Date = new Date(), client: IdentityMarkReader = db): Promise<IdentityMarkState> {
  const facts = await identityMarkFacts([{ profileId: m.profileId, displayName: m.fullName ?? '' }], now, client)
  return identityMarkStateOf(m, facts.get(m.profileId) ?? NO_IDENTITY_MARK_FACTS)
}

/**
 * Could the mark show at all, on the teacher's side alone: switched on, under today's notice, with a name. When this is
 * false nothing about the identity can make the mark show, so nothing needs to be read.
 */
export const identityMarkSwitchedOn = (m: IdentityMarkInput): boolean =>
  m.identityMarkOn === true && m.identityMarkNoticeVersion === IDENTITY_MARK_NOTICE_VERSION && (m.fullName ?? '').trim() !== ''

/**
 * THE BOOLEAN THE PUBLIC SURFACES GET (the profile line, the chat chip, the full save's card re-derivation).
 * ⛔ ZERO READS UNLESS THE TEACHER SWITCHED IT ON under today's notice with a name: the chat route is the most-polled
 * route in the app, and nearly every teacher has the switch off — so it costs them nothing. For one who switched it on,
 * every call is one indexed identity read (the set is tiny; no memo — a revocation must show on the next poll).
 */
export async function identityMarkShownFor(m: IdentityMarkInput, now: Date = new Date(), client: IdentityMarkReader = db): Promise<boolean> {
  if (!identityMarkSwitchedOn(m)) return false
  return (await identityMarkState(m, now, client)).shown
}
