'use server'

import { revalidatePath } from 'next/cache'
import { getAdmin } from '@/lib/admin'
import { correctVerifiedIdentity, resignKycCaptures, reviewKycCase, type ReviewResult } from '@/lib/kyc/review'

/**
 * SERVER ACTIONS FOR THE IDENTITY REVIEW QUEUE.
 *
 * ⛔ EACH ONE RE-CHECKS `getAdmin()`, AND THE PAGE'S OWN GATE PROVES NOTHING ABOUT WHO CALLS THESE.
 * A server action is a public endpoint with a generated name — it is reachable by POST from anywhere
 * once the id is known, whether or not the caller ever rendered the page. This is the same discipline
 * `admin/business-verification/[id]/actions.ts` follows, and both plan reviewers named it
 * independently as the thing most likely to be got wrong on a screen that renders identity documents.
 *
 * ⛔ AND A NON-ADMIN GETS `not_found`, NEVER `forbidden`. `forbidden` confirms the case id is real,
 * which turns this into an oracle for enumerating people who have submitted a passport.
 */

/**
 * ⚠️ `nationality` IS OPTIONAL AND IS THE REVIEWER'S OWN READ OF THE DOCUMENT. It exists because the
 * MRZ nationality field carries no check digit (mrz.ts:74 steps over it), so a case can arrive with
 * that column blank or quietly wrong while every checksummed field passed.
 *
 * ⛔ OMITTED AND EMPTY ARE DIFFERENT REQUESTS AND THE FIRST CUT MADE THEM THE SAME. `undefined` is
 * "no opinion, leave it"; `''` is "this document gives no assessable nationality — clear it". An
 * earlier version of this comment claimed that distinction while the line below destroyed it.
 */
export async function approveIdentityAction(verificationId: string, nationality?: string): Promise<ReviewResult> {
  const admin = await getAdmin()
  if (!admin) return { ok: false, code: 'not_found' }
  // ⛔ `''` IS FORWARDED, NOT SWALLOWED. Emptying the box is the reviewer saying "this document
  // gives no assessable nationality" — the only way to clear a wrong one, since the stateless codes
  // are deliberately unmapped. Folding it into `undefined` made that correction impossible.
  const nat = nationality === undefined ? undefined : nationality.trim().toUpperCase()
  const result = await reviewKycCase({ verificationId, admin, decision: 'approve', nationality: nat })
  if (result.ok) revalidatePath('/admin/verification')
  return result
}

export async function rejectIdentityAction(verificationId: string, note: string): Promise<ReviewResult> {
  const admin = await getAdmin()
  if (!admin) return { ok: false, code: 'not_found' }
  /**
   * ⚠️ A REJECTION NEEDS A REASON, AND THE SERVER IS WHERE THAT IS ENFORCED. The sibling business
   * queue requires one for the same reason: a refusal with no recorded ground is unappealable and
   * indefensible, and a disabled button in the UI is a courtesy, not a control.
   */
  const reason = (note || '').trim()
  if (!reason) return { ok: false, code: 'not_pending' }
  const result = await reviewKycCase({ verificationId, admin, decision: 'reject', note: reason })
  if (result.ok) revalidatePath('/admin/verification')
  return result
}

/**
 * Hand the panel a fresh pair of signed capture links for one case.
 *
 * ⛔ SAME GATE, SAME SILENCE AS ITS SIBLINGS. `getAdmin()` is re-checked because a server action is
 * a public endpoint, and a non-admin gets nulls rather than a distinguishable refusal — a
 * `forbidden` here would confirm a case id is real and turn this into an enumeration oracle for
 * people who have submitted a passport, which is precisely what the note at the top of this file
 * forbids. Read-only: it mints links, it never touches the case.
 */
export async function refreshIdentityCapturesAction(verificationId: string): Promise<{ documentUrl: string | null; selfieUrl: string | null }> {
  const admin = await getAdmin()
  if (!admin) return { documentUrl: null, selfieUrl: null }
  return resignKycCaptures(verificationId)
}

/**
 * CORRECT A FIELD ON AN ALREADY-VERIFIED IDENTITY. Separate from approve on purpose — see
 * `correctVerifiedIdentity`. Same admin re-check and same `not_found`-not-`forbidden` discipline as
 * every other action in this file: confirming an id is real turns this into an enumerator for people
 * who have submitted a passport.
 *
 * ⚠️ `''` REACHES THE DOMAIN AND MEANS "CLEAR IT"; `undefined` means "leave it alone". Collapsing
 * those made a WRONG value unfixable in the review path, and the same trap applies here.
 */
export async function correctIdentityAction(input: {
  verificationId: string
  nationality?: string
  residenceCountry?: string
  note: string
}) {
  const admin = await getAdmin()
  if (!admin) return { ok: false as const, code: 'not_found' as const }
  const result = await correctVerifiedIdentity({
    verificationId: input.verificationId,
    admin,
    nationality: input.nationality === undefined ? undefined : input.nationality.trim().toUpperCase(),
    residenceCountry: input.residenceCountry === undefined ? undefined : input.residenceCountry.trim().toUpperCase(),
    note: input.note,
  })
  /**
   * ⚠️ THE DYNAMIC ROUTE, NOT THE LIST. The corrected values render on `/admin/users/[id]`, and
   * `revalidatePath('/admin/users')` revalidates the LIST path only — the detail page it was meant
   * to refresh kept serving the old value (antigravity, on the finished diff, 2026-09-09). Passing
   * the route pattern with `'page'` invalidates every instance of it, which is what is wanted here:
   * the action holds a verification id, not the profile id the URL is keyed by.
   */
  if (result.ok) revalidatePath('/admin/users/[id]', 'page')
  return result
}
