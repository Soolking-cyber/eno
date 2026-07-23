'use server'

import { revalidatePath } from 'next/cache'
import { getAdmin } from '@/lib/admin'
import { approveVerification, rejectVerification, type ReviewResult } from '@/lib/core/business-verification-service'
import { signVerificationDoc } from '@/lib/business-verification-store'

// Server actions for the business-verification review. Each RE-CHECKS getAdmin() — a
// server action is a public endpoint, so the page's gate proves nothing about who calls
// THIS function (the visa-admin discipline).

export async function approveVerificationAction(caseId: string): Promise<ReviewResult> {
  const admin = await getAdmin()
  if (!admin) return { ok: false, error: 'not_found' } // never leak that the id exists to a non-admin
  const result = await approveVerification(caseId, admin)
  if (result.ok) {
    revalidatePath('/admin/business-verification')
    revalidatePath(`/admin/business-verification/${caseId}`)
  }
  return result
}

export async function rejectVerificationAction(caseId: string, note: string): Promise<ReviewResult> {
  const admin = await getAdmin()
  if (!admin) return { ok: false, error: 'not_found' }
  const reason = (note || '').trim()
  if (!reason) return { ok: false, error: 'not_pending' }
  const result = await rejectVerification(caseId, admin, reason)
  if (result.ok) {
    revalidatePath('/admin/business-verification')
    revalidatePath(`/admin/business-verification/${caseId}`)
  }
  return result
}

/** Mint a fresh 10-minute signed URL for one document (admin re-checked). */
export async function signVerificationDocAction(caseId: string, path: string): Promise<{ url: string } | { error: string }> {
  const admin = await getAdmin()
  if (!admin) return { error: 'not_found' }
  // The path is namespaced <profileId>/<uuid>.<ext>; a reviewer can only reach it through
  // this admin-gated action, and the bucket is service-role-only.
  const url = await signVerificationDoc(path)
  return url ? { url } : { error: 'sign_failed' }
}
