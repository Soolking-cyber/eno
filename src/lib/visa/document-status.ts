// What a re-analysis is allowed to do to a document's stored verdict.
//
// ⚠️ NEW FILE ON PURPOSE. The natural home for this looks like image-quality.ts, but that file is
// a SYNC-PAIR — src/lib/sync-pairs.test.ts byte-couples it to apps/forum/src/lib/visa/image-quality.ts
// and editing it fails the root suite until the forum copy is mirrored. CLAUDE.md's standing advice
// is to put new visa logic in files that are not paired, so this is one.

export type VisaDocumentStatus = 'pending' | 'passed' | 'failed' | 'unavailable'

/**
 * The status to persist after an analysis run.
 *
 * ⚠️ A DOCUMENT THAT ALREADY PASSED IS NEVER DOWNGRADED, and this is a correctness rule rather
 * than a kindness. `/extract` resolves the NEWEST document of a kind, so calling it again without
 * an explicit documentId re-analyses the SAME row — and that row's bytes cannot have changed,
 * because storage.ts uploads with `upsert: false` and every upload inserts a new row. A different
 * verdict on a second run is therefore MODEL NOISE about identical input. Production data from
 * 2026-07-28 shows this model returning different issue sets for the same subject minutes apart,
 * despite temperature 0.
 *
 * Without the rule, a stray retry, a double-tap or a flaky network re-issuing the POST could
 * revoke a passed portrait. Because `portrait_image_not_verified` is owned by DM step 1, that
 * throws the applicant from wherever they had reached back to Documents with no explanation.
 *
 * Both FAILURE paths in the route already enforce exactly this, via
 * `.neq('validation_status', 'passed')` on their updates. The success path did not, and that
 * asymmetry was the bug — not a style inconsistency.
 *
 * ⚠️ IT ONLY EVER PROTECTS `passed`. A pending/failed/unavailable document takes whatever the new
 * analysis says, including a downgrade from `failed` to `failed` with different issues, so a
 * genuine re-check of an uncertified document still works normally.
 */
export function nextDocumentStatus(
  stored: VisaDocumentStatus | string | null | undefined,
  analysed: 'passed' | 'failed',
): 'passed' | 'failed' {
  return stored === 'passed' ? 'passed' : analysed
}

/** True when the rule suppressed a downgrade — the desk should be able to see that it happened. */
export function suppressedDowngrade(
  stored: VisaDocumentStatus | string | null | undefined,
  analysed: 'passed' | 'failed',
): boolean {
  return nextDocumentStatus(stored, analysed) !== analysed
}
