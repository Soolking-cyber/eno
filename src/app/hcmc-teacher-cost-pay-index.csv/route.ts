import { IS_SERVICES } from '@/lib/edition'
import { TEACHER_COST_INDEX_PATH, teacherCostIndexCsv } from '@/lib/teacher-cost-index'
import { EDITIONS, ERRATA } from '@/lib/teacher-cost-index-editions'

/**
 * /hcmc-teacher-cost-pay-index.csv — every edition of the HCMC Teacher Cost & Pay Index as one long table, on the page's
 * terms: free to cite and quote, crediting eno.vn; a link is welcome and may be nofollow, never required (owner decision
 * 9 — the terms live in the page's cite box, #cite). No open licence is claimed here or anywhere.
 *
 * ⛔ THE FROZEN EDITIONS, NOT A COMPUTATION: the same files the page renders (teacher-cost-index-editions.ts), so the
 * download and the page cannot disagree; a new edition only appends rows (`teacherCostIndexCsv`).
 * ⚠️ OUTSIDE `[lang]` ON PURPOSE, like /hcmc-rent-index.csv: a data file has no language, and src/proxy.ts never
 * rewrites a dotted path. ⚠️ MARKETPLACE ONLY, like the page.
 */
export const dynamic = 'force-dynamic'

const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'

export function GET() {
  if (IS_SERVICES) return new Response('Not found', { status: 404 })
  return new Response(teacherCostIndexCsv(EDITIONS, ERRATA), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'inline; filename="hcmc-teacher-cost-pay-index.csv"',
      // ⚠️ no-cache, as on the Rent Index CSV: Cloudflare caches `.csv` by extension, and a file a deploy behind the page
      // is the disagreement this route exists to rule out.
      'Cache-Control': 'no-cache',
      // Points a script that fetched only the file at the page that states the citation terms.
      Link: `<${ORIGIN}${TEACHER_COST_INDEX_PATH}#cite>; rel="describedby"`,
    },
  })
}
