/**
 * THE PURE HALF OF scripts/reorder-import-covers.ts: the scratch-database guard, a stored gallery's
 * new order, the SQL that writes it and undoes it, and the before/after contact sheet. No fetch, no
 * DB, no sharp — unit-tested in cover-reorder.test.ts.
 */
import { coverByMark, type CoverMove } from './import-photo-mark'

/**
 * ⛔ A LOOPBACK SCRATCH DATABASE — NEVER THE PRODUCTION TUNNEL, which is ALSO on loopback, at :5433.
 * The test scripts/import-jobs.ts applies to --preview-covers, plus two holes closed: anything that
 * does not parse, a socket path, or any other host is refused (fails closed). `[::1]` is how URL spells
 * IPv6 loopback.
 * ⛔ THE URL'S HOST IS NOT ALWAYS THE HOST pg DIALS. pg-connection-string lets `?host=` and `?port=`
 * override the authority, so `…@127.0.0.1:5432/db?host=prod&port=5433` reaches production; `hostaddr`
 * does the same in libpq (psql). Any of them, in any case, is refused rather than interpreted. And only
 * postgres(ql): — pg reads a `socket:` URL's path as a Unix socket whatever its host says.
 */
const HOST_OVERRIDES = new Set(['host', 'hostaddr', 'port'])
export function isScratchDbUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return false
    if ([...u.searchParams.keys()].some((k) => HOST_OVERRIDES.has(k.toLowerCase()))) return false
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname) && (u.port || '5432') !== '5433'
  } catch {
    return false
  }
}

/**
 * ⛔ THE PRODUCTION DATABASE, AS FAR AS THIS MACHINE KNOWS IT: the (database name, port) of every URL
 * in the repo's .env (DATABASE_URL / DIRECT_URL — today both 127.0.0.1:5433/postgres), plus the tunnel
 * port and Supabase's database name, which are refused even when .env is missing or rewritten.
 */
export type ProdIdentity = { names: readonly string[]; ports: readonly string[] }
export const PROD_TUNNEL_PORT = '5433'
export const PROD_DB_NAME = 'postgres'
export function prodIdentityFrom(urls: readonly (string | null | undefined)[]): ProdIdentity {
  const names = new Set([PROD_DB_NAME]), ports = new Set([PROD_TUNNEL_PORT])
  for (const url of urls) {
    if (!url) continue
    try {
      const u = new URL(url)
      const name = decodeURIComponent(u.pathname.replace(/^\//, ''))
      if (name) names.add(name)
      ports.add(u.port || '5432')
    } catch { /* not a URL: nothing to learn from it */ }
  }
  return { names: [...names], ports: [...ports] }
}

/**
 * Why (database, port) may be production — or null. The same rule for the URL (before connecting) and
 * for what the server itself reports (current_database(), inet_server_port() — after connecting,
 * which no URL trick can fake): a production port is refused whatever the name; the default port
 * 5432 is refused with a production database name (a local copy of prod, or a tunnel moved to 5432);
 * any port is refused with a production name AND port.
 */
export function prodLikeRefusal(database: string, port: string, prod: ProdIdentity): string | null {
  if (prod.ports.includes(port)) return `port ${port} is the production database's`
  // ⛔ ANY PORT (codex, gate 2026-09-29): a new tunnel to production on a fresh loopback port would carry the
  // production NAME with an unknown port. A scratch copy must be named differently (the recipe uses `eno`).
  if (prod.names.includes(database)) return `database "${database}" has the production database's name — name the scratch copy differently`
  return null
}

/**
 * ⛔ EVERY CONDITION FOR scripts/reorder-import-covers.ts --apply, BEFORE CONNECTING — null means go on.
 * An explicit opt-in (COVER_REORDER_SCRATCH=1, so a pasted command cannot write by accident), a
 * loopback URL that nothing overrides (isScratchDbUrl), and a (name, port) that is not production's.
 * After connecting, the script checks the SERVER's own answer with prodLikeRefusal again.
 */
export function scratchRefusal(url: string | null | undefined, optIn: string | null | undefined, prod: ProdIdentity): string | null {
  if (optIn !== '1') return 'set COVER_REORDER_SCRATCH=1 to confirm the database is a scratch copy'
  if (!url || !isScratchDbUrl(url)) return 'the URL is not a loopback scratch database (or a ?host=/?port=/?hostaddr= parameter moves it)'
  const u = new URL(url)
  return prodLikeRefusal(decodeURIComponent(u.pathname.replace(/^\//, '')), u.port || '5432', prod)
}

/**
 * A stored `images` JSON as its URLs — or null when it is anything but an array of strings.
 * ⛔ A GALLERY HOLDING ANYTHING ELSE (an object, a null, a number) IS LEFT ALONE, never "cleaned":
 * rewriting it from its strings would delete the rest, and the UPDATE's old-value guard cannot see that.
 */
export function parseGallery(json: string): string[] | null {
  let a: unknown
  try { a = JSON.parse(json) } catch { return null }
  return Array.isArray(a) && a.every((u) => typeof u === 'string') ? a : null
}

/** A stored gallery in its new order: the photo the stamp shows least among the first three leads. */
export function reorderedGallery(images: readonly string[], scores: readonly (number | null | undefined)[]): { after: string[]; move: CoverMove | null; why: string } {
  const c = coverByMark(images.map((_, i) => i), scores)
  return { after: c.keep.map((i) => images[i]), move: c.moved, why: c.why }
}

export type ReorderChange = { id: string; oldJson: string; newJson: string }

/**
 * ⛔ WHAT MAY BE WRITTEN: only plans whose row is in scope (`--seller`, then `--limit` per seller).
 * Rows planned only so the contact sheet shows the /c/rentals head are displayed, never written.
 */
export function reorderChanges(
  plans: Iterable<{ id: string; oldJson: string; after: readonly string[]; moved: boolean }>,
  inScope: ReadonlySet<string>,
): { changes: ReorderChange[]; outOfScope: number } {
  const changes: ReorderChange[] = []
  let outOfScope = 0
  for (const p of plans) {
    if (!p.moved) continue
    if (!inScope.has(p.id)) { outOfScope++; continue }
    changes.push({ id: p.id, oldJson: p.oldJson, newJson: JSON.stringify(p.after) })
  }
  return { changes, outOfScope }
}

/** ⛔ Every UPDATE is also scoped to the rentals category, so a row outside it can never be written. */
// Re-checked AT EXECUTION TIME, not only when planning: a row that left rentals or stopped being active
// between the dry run and the owner's apply is not rewritten (codex, gate 2026-09-29).
export const RENTALS_GUARD = `"categoryId" = (SELECT id FROM "Category" WHERE slug = 'rentals') AND status = 'active'`

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`

/**
 * The statements, for review and for psql — the same guarded UPDATE the scratch --apply runs.
 * ⛔ RAW SQL, SO `updatedAt` STAYS PUT: it is Prisma's @updatedAt, only the Prisma client bumps it,
 * and sitemap.xml orders a 45,000-row window by it — a Prisma update would tell Google that thousands
 * of rentals just changed. ⛔ EACH UPDATE MATCHES THE OLD VALUE, so a row whose photos changed since
 * the plan was made is skipped (UPDATE 0) instead of overwritten; the rollback matches the new value
 * for the same reason. One transaction each, ON_ERROR_STOP: all or nothing.
 */
export function reorderSql(changes: readonly ReorderChange[], note: string): { apply: string; rollback: string } {
  const head = (what: string) => [
    `-- ${what} — scripts/reorder-import-covers.ts, ${note}`,
    `-- ${changes.length} rows. Run: psql -v ON_ERROR_STOP=1 "$DIRECT_URL" -f <this file>`,
    `-- Raw SQL: "updatedAt" is NOT touched. Each UPDATE matches the value it replaces and the rentals category; a row changed since is skipped.`,
    '\\set ON_ERROR_STOP on',
    'BEGIN;',
  ]
  const apply = [...head('Cover reorder'), ...changes.map((c) => `UPDATE "Listing" SET images = ${lit(c.newJson)} WHERE id = ${lit(c.id)} AND images = ${lit(c.oldJson)} AND ${RENTALS_GUARD};`), 'COMMIT;', '']
  const rollback = [...head('ROLLBACK of the cover reorder'), ...changes.map((c) => `UPDATE "Listing" SET images = ${lit(c.oldJson)} WHERE id = ${lit(c.id)} AND images = ${lit(c.newJson)} AND ${RENTALS_GUARD};`), 'COMMIT;', '']
  return { apply: apply.join('\n'), rollback: rollback.join('\n') }
}

export type SheetEntry = {
  id: string
  sellerId: string
  title: string | null
  before: string | null
  after: string | null
  move: CoverMove | null
  why: string
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The review page: each card's cover BEFORE and AFTER, cropped square the way a card crops it, in
 * feed order. A local file for the owner's eyes, not a page of the app — no tokens, no i18n.
 */
export function contactSheetHtml(entries: readonly SheetEntry[], meta: { title: string; lines: readonly string[] }): string {
  const moved = entries.filter((e) => e.move).length
  const img = (src: string | null, label: string) => src
    ? `<figure><img src="${esc(src)}" alt="${esc(label)}" loading="lazy" width="180" height="180"><figcaption>${esc(label)}</figcaption></figure>`
    : `<figure><div class="none">no photo</div><figcaption>${esc(label)}</figcaption></figure>`
  const cards = entries.map((e, i) => `
  <li class="${e.move ? 'moved' : ''}">
    <p class="meta">${i + 1}. <a href="https://eno.vn/listings/${esc(e.id)}">${esc(e.id)}</a> · ${esc(e.sellerId)}</p>
    ${e.title ? `<p class="t">${esc(e.title)}</p>` : ''}
    <div class="pair">${img(e.before, 'before')}${img(e.after, e.move ? `after — photo ${e.move.from + 1}` : 'after (same)')}</div>
    <p class="why">${e.move ? `stamp ${e.move.was.toFixed(2)} → ${e.move.now.toFixed(2)}` : esc(e.why)}</p>
  </li>`).join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)}</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; margin: 16px; color: #1a1a1a; background: #fff; }
  ul { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 16px; }
  li { border: 1px solid #ddd; border-radius: 8px; padding: 8px; }
  li.moved { border-color: #c2410c; box-shadow: 0 0 0 1px #c2410c; }
  .pair { display: flex; gap: 8px; }
  figure { margin: 0; }
  img, .none { width: 180px; height: 180px; object-fit: cover; border-radius: 6px; display: block; background: #eee; }
  .none { display: grid; place-items: center; color: #666; }
  figcaption, .meta, .why { font-size: 12px; color: #555; margin: 4px 0 0; }
  .t { margin: 2px 0 6px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style></head>
<body>
<h1>${esc(meta.title)}</h1>
${meta.lines.map((l) => `<p>${esc(l)}</p>`).join('\n')}
<p><strong>${moved}</strong> of ${entries.length} covers would change (outlined).</p>
<ul>${cards}
</ul>
</body></html>
`
}
