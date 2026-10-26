/**
 * The identity-check queue's filter, shared by the queue (review.ts listKycQueue) and every count of it (the admin
 * Overview tile, the Verification tab badge). A pending case whose account was erased is kept as proof a submission
 * happened, but nobody can decide it (decideOnce pins the profile), so it is not waiting: counted with a bare
 * `status: 'pending'`, it showed "1 Identity checks waiting" forever over an empty queue (sweep 2026-10-22).
 */
export const KYC_QUEUE_WHERE = { status: 'pending', profileId: { not: null } } as const
