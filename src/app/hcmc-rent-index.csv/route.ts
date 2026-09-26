import { IS_SERVICES } from '@/lib/edition'
import { rentIndexCsv } from '@/lib/rent-index'
import { loadRentIndex } from '@/app/[lang]/hcmc-rent-index/load-rent-index'

/**
 * /hcmc-rent-index.csv — the table on /hcmc-rent-index as a file, on the same terms: free to cite and
 * quote, crediting eno.vn with a link to the page (the terms live in the page's cite box, #cite). No
 * open licence is claimed here or anywhere (owner, 2026-09-27).
 *
 * ⛔ THE SAME SNAPSHOT AS THE PAGE, NOT A SECOND QUERY. Both call `loadRentIndex()`, which reads one
 * cached daily computation; neither route keeps an ISR copy of its own, so there is no second clock
 * for the file to drift on. Every row carries `snapshot_utc`, the same instant the page prints as its
 * snapshot date.
 *
 * ⚠️ OUTSIDE `[lang]` ON PURPOSE: a data file has no language, and src/proxy.ts never rewrites a
 * dotted path, so this is served at exactly the URL the page and the Dataset JSON-LD advertise.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  // Marketplace only, like the page (see the note there).
  if (IS_SERVICES) return new Response('Not found', { status: 404 })
  const lookup = await loadRentIndex()
  // ⚠️ 503 + no-store, never an empty 200: a scraper or a newsroom script must not save a header-only
  // file as "the data", and a CDN must not keep the failure.
  if (!lookup.known) {
    return new Response('The rent index could not be computed just now. Please try again shortly.\n', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '300' },
    })
  }
  return new Response(rentIndexCsv(lookup.index), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'inline; filename="hcmc-rent-index.csv"',
      // ⚠️ no-cache, not a max-age: Cloudflare caches `.csv` by extension, and an edge copy an hour
      // older than the page is exactly the disagreement this route exists to rule out. The body is
      // served from the cached snapshot, so revalidating costs one cache read, not a query.
      'Cache-Control': 'no-cache',
      // Points a script that fetched only the file at the page that states the citation terms.
      Link: '<https://eno.vn/hcmc-rent-index#cite>; rel="describedby"',
    },
  })
}
