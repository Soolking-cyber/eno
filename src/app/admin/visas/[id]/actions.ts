'use server'

import { revalidatePath } from 'next/cache'
import { getAdmin } from '@/lib/admin'
import { transitionVisaCase, type VisaTransitionResult } from '@/lib/visa-admin'

/**
 * Status-transition server action for the admin visa case. Re-checks getAdmin()
 * itself — a server action is a public endpoint; the page's gate proves nothing
 * about the caller of THIS function.
 */
export async function transitionVisaStatus(id: string, next: string): Promise<VisaTransitionResult> {
  const admin = await getAdmin()
  if (!admin) return { ok: false, error: 'admin_required' }
  const result = await transitionVisaCase(id, next, admin)
  if (result.ok) {
    revalidatePath('/admin/visas')
    revalidatePath(`/admin/visas/${id}`)
  }
  return result
}
