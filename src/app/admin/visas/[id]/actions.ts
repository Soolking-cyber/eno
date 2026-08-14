'use server'

import { revalidatePath } from 'next/cache'
import { getVisaDeskScope } from '@/lib/desk-operator'
import { transitionVisaCase, visaCaseInScope, type VisaTransitionResult } from '@/lib/visa-admin'

/**
 * Status-transition server action for the admin visa case. Re-checks entitlement itself — a server
 * action is a public endpoint; the page's gate proves nothing about the caller of THIS function.
 *
 * ⛔ TWO CHECKS, NOT ONE. `getVisaDeskScope()` proves the caller operates a visa desk;
 * `visaCaseInScope()` proves THIS case is theirs. Without the second, a partner desk could advance,
 * approve or reject any case in a table shared with eno.forum by naming its uuid — this action is
 * what moves a case to `approved`, which is what closes it.
 */
export async function transitionVisaStatus(id: string, next: string): Promise<VisaTransitionResult> {
  const scope = await getVisaDeskScope()
  if (!scope) return { ok: false, error: 'admin_required' }
  // Same wording as an unknown case, deliberately: out-of-scope must not read as "exists, denied".
  if (!(await visaCaseInScope(id, scope))) return { ok: false, error: 'not_found' }
  const result = await transitionVisaCase(id, next, scope.operator, scope)
  if (result.ok) {
    revalidatePath('/admin/visas')
    revalidatePath(`/admin/visas/${id}`)
  }
  return result
}
