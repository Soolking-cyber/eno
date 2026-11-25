/**
 * THE RENTAL DESK'S OPERATOR ADDRESS.
 *
 * The renters' availability check (removed 2026-11-25, owner: "remove the check availability feature entirely") sent its
 * requests to an unowned rental desk (desk-ids.ts) answered by this operator. The desk threads it opened stay readable, and
 * other jobs still need to know who the operator is (the teacher-schools ask and the Trustpilot invite leave them out), so
 * this one function stays.
 *
 * ⚠️ READ PER CALL, NOT AT MODULE SCOPE, so a test (or an env edit picked up on restart) cannot be
 * defeated by an import that happened first. Set it in BOTH env files (eno-root-env and
 * eno-services-env) if it ever changes — the two deployments are separate processes.
 */
export function rentalOperatorEmail(): string {
  return (process.env.RENTAL_CHECK_OPERATOR_EMAIL || 'support@eno.forum').trim().toLowerCase()
}
