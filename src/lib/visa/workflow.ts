export const ADMIN_PREFILLABLE_STATUSES = ['ready_for_review', 'under_review', 'ready_to_submit'] as const

export function isAdminPrefillableStatus(status: string) {
  return ADMIN_PREFILLABLE_STATUSES.some((candidate) => candidate === status)
}

export function isAdminReviewStatus(status: string) {
  return status === 'ready_for_review' || status === 'under_review'
}
