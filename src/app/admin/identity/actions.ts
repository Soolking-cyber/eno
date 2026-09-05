'use server'

import { revalidatePath } from 'next/cache'
import { getAdmin } from '@/lib/admin'
import { reviewKycCase, type ReviewResult } from '@/lib/kyc/review'

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

export async function approveIdentityAction(verificationId: string): Promise<ReviewResult> {
  const admin = await getAdmin()
  if (!admin) return { ok: false, code: 'not_found' }
  const result = await reviewKycCase({ verificationId, admin, decision: 'approve' })
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
