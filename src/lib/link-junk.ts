/**
 * ⛔ A LINK A CHAT APP CUT OUT OF A SENTENCE KEEPS THE SENTENCE'S PUNCTUATION — AND THAT WAS A 404 (2026-10-21).
 * "Make your free profile at teacher.eno.vn, …" — Zalo's link detection takes the comma into the link and opens
 * `https://teacher.eno.vn/,?zarsrc=30&utm_source=zalo…`; teacher.<base> 301s every path but `/` to the apex
 * (src/proxy.ts), and `eno.vn/,` is no page. Measured on the box's nginx logs, 2026-10-14 → 10-21: 24 visits to
 * `teacher.eno.vn/,` (Zalo groups and chats, about nine people, one of whom wrote "tried many times, always the same"),
 * every one ending on "We can't find that page"; beside them `eno.vn/teachers/join,`, `/teachers/join.` and guide links
 * closed by `):` (a markdown link read as text).
 * ⛔ NO PAGE OF OURS ENDS IN PUNCTUATION — handles end [a-z0-9] (handle-format.ts HANDLE_RE), slugs are [a-z0-9-] with
 * no edge dash (slug.ts, schools/import-entries.ts — 0 of the 172 live school slugs differ), ids are cuids — so such a
 * tail is never part of an address, and the proxy sends the page request to the same path without it. Measured too,
 * 2026-10-21 (read-only): no stored URL value ends in one — Handle.handle 0/250, Brand.slug 0/623, School.slug 0/172,
 * Category.slug 0/18, ForumCommunity.slug 0/17, Seller.id 0/215, Listing.id 0/143,951 — nor does any of the 5,897
 * URLs in both editions' live sitemaps; and in the box's logs for 2026-09-21 → 10-21, on every host of both editions,
 * 191 GETs ended in one and not one answered 200 (154 × 404, the rest redirects).
 * ⚠️ THE PROXY'S MATCHER SPELLS THESE MARKS OUT A SECOND TIME (its last entry — Next reads `config` statically, so it
 * cannot import them); src/proxy.test.ts runs Next's own matcher over every mark here, so a mark added to one list and
 * not the other fails there.
 * ⚠️ A BACKWARD SCAN, NOT ONE `…+$` REGEX: run over a path of thousands of commas ending in a letter, that regex
 * backtracks from every position (quadratic) on a function every page request passes through.
 */

/** The marks as the URL parser leaves them in a path: ASCII punctuation raw (a raw `"` or `>` is encoded first)… */
export const RAW_MARKS: ReadonlySet<string> = new Set([',', '.', ';', ':', '!', "'", '"', ')', ']', '}', '>'])
/** …and percent-encoded, matched in either case: ! " ' ) , . : ; > ] } ‘ ’ “ ” … 、 。 ， */
export const ENCODED_MARKS: readonly string[] = [
  '%21', '%22', '%27', '%29', '%2C', '%2E', '%3A', '%3B', '%3E', '%5D', '%7D',
  '%E2%80%98', '%E2%80%99', '%E2%80%9C', '%E2%80%9D', '%E2%80%A6', '%E3%80%81', '%E3%80%82', '%EF%BC%8C',
]
const LONGEST = Math.max(...ENCODED_MARKS.map((m) => m.length))

/**
 * The path without the punctuation a link picked up from its sentence — `/,` → `/`, `/teachers/join.` →
 * `/teachers/join`, `/c/teachers):` → `/c/teachers` — or null when its last character is already part of an address.
 * A slash left at the end goes too, so `/c/teachers/,` lands in one redirect rather than two (Next 308s a trailing slash
 * away); a mark before a slash (`/a,/,`) or a slash after the marks (`/a./`) still takes two — finite, never a loop,
 * since every answer is shorter than its path. ⛔ ONE leading slash,
 * always: Next hands a same-host redirect to the browser as a RELATIVE Location (server/web/adapter.js), and a
 * relative `//host/x` is another site.
 */
export function linkJunkFreePath(pathname: string): string | null {
  let end = pathname.length
  for (;;) {
    if (end > 0 && RAW_MARKS.has(pathname[end - 1])) { end--; continue }
    const tail = pathname.slice(Math.max(0, end - LONGEST), end).toUpperCase()
    const mark = ENCODED_MARKS.find((m) => tail.endsWith(m))
    if (!mark) break
    end -= mark.length
  }
  if (end === pathname.length) return null
  while (end > 0 && pathname[end - 1] === '/') end--
  let start = 0
  while (start < end && (pathname[start] === '/' || pathname[start] === '\\')) start++
  return `/${pathname.slice(start, end)}`
}
