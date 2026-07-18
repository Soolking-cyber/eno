// Shared, environment-neutral (no 'server-only', no 'use client') visa status
// presentation helpers for the admin queue + case detail. Admin chrome is
// EN-only by convention, so labels here bypass tr().

/** Badge tone per status — mirrors the forum admin queue's mapping. */
export function visaStatusVariant(status: string): 'success' | 'destructive' | 'warning' | 'neutral' {
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'destructive'
  if (status === 'needs_changes') return 'warning'
  return 'neutral'
}

export const visaStatusLabel = (status: string): string => status.replaceAll('_', ' ')

/**
 * Per-status action buttons `[nextStatus, label]` — the forum admin case's action
 * set (apps/forum/src/components/visa/visa-admin-case.tsx) plus the review-stage
 * transitions its "Admin decision" card performed. Every pair MUST be legal under
 * VISA_ADMIN_TRANSITIONS (the server re-validates regardless). The forum's hosted
 * secure-browser prefill, applicant-message editing and result-PDF upload are NOT
 * ported: they live on payload encryption + Browserbase + forum storage routes
 * (see the TODO in src/lib/visa-admin.ts) and stay on the forum operator API.
 */
export const VISA_ADMIN_ACTIONS: Record<string, Array<[string, string]>> = {
  ready_for_review: [['under_review', 'Start review'], ['needs_changes', 'Request changes'], ['applicant_approval', 'Send for applicant approval']],
  under_review: [['needs_changes', 'Request changes'], ['applicant_approval', 'Send for applicant approval']],
  needs_changes: [['under_review', 'Return to review']],
  applicant_approval: [['under_review', 'Return to review'], ['needs_changes', 'Request changes']],
  ready_to_submit: [['applicant_approval', 'Refresh authorization'], ['submitted', 'Mark submitted'], ['payment_required', 'Payment required'], ['processing', 'Mark processing']],
  submitted: [['payment_required', 'Payment required'], ['processing', 'Mark processing'], ['needs_changes', 'Request changes'], ['rejected', 'Reject']],
  payment_required: [['submitted', 'Payment complete'], ['processing', 'Mark processing'], ['rejected', 'Reject']],
  processing: [['approved', 'Approve'], ['needs_changes', 'Action required'], ['rejected', 'Reject']],
}
