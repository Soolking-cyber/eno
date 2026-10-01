import type { RangeMeta } from '@/lib/taxonomy'

/**
 * The precise numeric specs (range facets → their dedicated columns: year, mileageKm, engineL, areaM2,
 * salaryM…) a post-wizard submit sends. Pure, so the rule below is tested rather than re-derived.
 *
 * ⚠️ ON AN EDIT, A SPEC THE SELLER CLEARED IS SENT AS null — the edit path is sparse (an omitted
 * column is left alone), so dropping it kept the old value: clearing a job's salary to "Negotiable"
 * left the stored 45 tr/tháng, and the price derived from it, in place. Only a column the listing HAD
 * at open is nulled, never one this form simply did not load.
 * ⛔ …EXCEPT A JOB'S SALARY (`alwaysOnEdit`), WHICH AN EDIT ALWAYS SENDS (null = "Negotiable"). The
 * salary IS the job's pay, and the server re-derives the price only from an edit that sends it: an
 * older job stored at a typed price with no salary (e.g. "20,000 đ / month") opened as "Negotiable",
 * was saved as "Negotiable", and kept printing its old price (review, 2026-10-01).
 * ⚠️ NEVER A null ON CREATE: the create path reads every declared range column (non-sparse), where a
 * null is Number(null) = 0 — a "Negotiable" job would be stored with a 0 salary instead of none.
 */
export function rangeColumnsPayload(
  facets: readonly { key: string; range: RangeMeta }[],
  ranges: Record<string, number | null | undefined>,
  edit: Record<string, unknown> | null | undefined,
  alwaysOnEdit?: RangeMeta['column'],
): Record<string, number | null> {
  return Object.fromEntries(
    facets
      .filter((f) => ranges[f.key] != null || (!!edit && (f.range.column === alwaysOnEdit || edit[f.range.column] != null)))
      .map((f) => [f.range.column, ranges[f.key] ?? null]),
  )
}
