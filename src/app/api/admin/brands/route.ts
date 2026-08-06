import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { normalizeBrand } from '@/lib/brand-normalize'
import { brandIconPath } from '@/lib/brand-icons'
import { ApiError, route } from '@/lib/api/handler'

export const dynamic = 'force-dynamic'

// Admin brand curation. Every action re-checks the session via getAdmin().
//   GET                      → all brands (newest-created / least-curated first)
//   PATCH {id, ...fields}    → edit name / iconSlug / logoPath / status / aliases
//   POST  {action:'merge', sourceId, targetId} → fold one brand into another
//
// ⚠️ WS6 MIGRATION — ALL THREE METHODS, THE AUTH PREAMBLE ONLY. `auth: 'admin'` is the same
// getAdmin() each method opened with ("every action re-checks the session" above is still literally
// true — route() runs it per request), and it emits the same `{"error":"Forbidden"}` 403, capital F.
// ⚠️ `'admin'` RESOLVES NO PROFILE. An earlier draft of this header said it follows getAdmin()
// with getCurrentProfile() and called the extra Profile read an accepted cost. It did, and the
// cost turned out not to be acceptable anywhere: no admin handler reads ctx.profile or
// ctx.userId, the call made read-only admin GETs perform a presence-heartbeat WRITE, and on a
// first-ever call it runs ensureProfile()'s irreversible guest-Seller auto-claim. It was removed
// from the wrapper in this same commit; getAdmin() is Supabase-auth only and touches no DB.
//
// ⚠️ NO `body:` SCHEMA ON PATCH OR POST. Both hand-coerce (`String(body.name)`, `String(a)` over
// `aliases`, `body.logoPath ? String(body.logoPath) : ''`), so they accept a number, a boolean or
// null where zod would 400 — a schema would tighten validation, which is a wire change. Both also
// distinguish unparseable JSON from a missing field with DIFFERENT codes (PATCH: `bad_request` vs
// `missing_id`), and `invalidBodyCode` is a single code. GET has no body at all.
//
// ⚠️ NO `rateLimit:` — none of the three had one, and adding one would invent a 429 branch.
//
// Branches. GET: non-admin → 403 `Forbidden` · success → 200 `{brands:[…]}`.
// PATCH: non-admin → 403 · malformed JSON → 400 `bad_request` · no id → 400 `missing_id` · success
// → 200 `{"ok":true}`.
// POST: non-admin → 403 · malformed JSON → 400 `bad_request` · action ≠ 'merge', a missing
// source/target id, or source === target → 400 `bad_request` · either brand missing → 404
// `not_found` · success → 200 `{"ok":true}`.
//
// ⚠️ ONE BRANCH PER METHOD IS NOT BYTE-IDENTICAL: no DB call in this file was wrapped, so a
// rejection used to reach Next's default 500 — including the common one, `db.brand.update` /
// `db.brand.delete` throwing P2025 for an id that no longer exists (PATCH does NOT pre-check
// existence the way POST does). Those now return `{"error":"internal_error"}` 500, logged with an
// `op`. An improvement, and a wire change on the failure path.

export const GET = route({ auth: 'admin' }, async () => {
  const rows = await db.brand.findMany({
    select: { id: true, slug: true, name: true, normalized: true, aliases: true, iconSlug: true, logoPath: true, listingCount: true, status: true, curatedAt: true },
    orderBy: [{ curatedAt: 'asc' }, { listingCount: 'desc' }, { name: 'asc' }], // uncurated (null) first
    take: 1000,
  })
  // Resolve the effective preview path server-side (simple-icons stays off the client).
  const brands = rows.map((b) => ({ ...b, iconPath: brandIconPath(b), curatedAt: b.curatedAt?.toISOString() ?? null }))
  return { brands }
})

export const PATCH = route({ auth: 'admin' }, async ({ req }) => {
  let body: { id?: string; name?: string; iconSlug?: string | null; logoPath?: string | null; status?: string; aliases?: string[] }
  try { body = await req.json() } catch { throw new ApiError('bad_request', 400) }
  if (!body.id) throw new ApiError('missing_id', 400)

  const data: Record<string, unknown> = { curatedAt: new Date() }
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 60)
    if (name) data.name = name
  }
  if (body.iconSlug !== undefined) data.iconSlug = body.iconSlug ? String(body.iconSlug).trim().slice(0, 80) : null
  if (body.logoPath !== undefined) {
    let raw = body.logoPath ? String(body.logoPath).trim() : ''
    // Drop any leading XML prolog / comments so "<?xml …?><svg>" files are detected.
    const svgAt = raw.search(/<svg[\s>]/i)
    if (svgAt > 0) raw = raw.slice(svgAt)
    let clean = ''
    if (raw.startsWith('<svg')) {
      // Full SVG (rendered via an <img> data-URI, so already script-sandboxed) — still
      // strip script/handlers/foreignObject defensively, and require a well-formed <svg>.
      const stripped = raw
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
        .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/javascript:/gi, '')
        // Force the correct SVG namespace (pasted/AI svgs often mangle it → won't
        // render in an <img>).
        .replace(/<svg\b[^>]*>/i, (tag) =>
          tag.replace(/\s+xmlns\s*=\s*("[^"]*"|'[^']*')/i, '').replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"'),
        )
        .slice(0, 20000)
      if (/^<svg[\s\S]*<\/svg>\s*$/i.test(stripped)) clean = stripped
    } else {
      // Bare monotone path data — keep only path-data characters.
      clean = raw.replace(/[^0-9A-Za-z.,\-\s]/g, '').slice(0, 20000)
    }
    data.logoPath = clean || null
  }
  if (body.status === 'active' || body.status === 'hidden') data.status = body.status
  if (Array.isArray(body.aliases)) {
    const aliases = Array.from(new Set(body.aliases.map((a) => normalizeBrand(String(a))).filter(Boolean)))
    data.aliases = JSON.stringify(aliases)
  }

  await db.brand.update({ where: { id: body.id }, data })
  revalidatePath('/brands')
  return { ok: true }
})

export const POST = route({ auth: 'admin' }, async ({ req }) => {
  let body: { action?: string; sourceId?: string; targetId?: string }
  try { body = await req.json() } catch { throw new ApiError('bad_request', 400) }
  if (body.action !== 'merge' || !body.sourceId || !body.targetId || body.sourceId === body.targetId) {
    throw new ApiError('bad_request', 400)
  }

  const [source, target] = await Promise.all([
    db.brand.findUnique({ where: { id: body.sourceId }, select: { slug: true, normalized: true, aliases: true } }),
    db.brand.findUnique({ where: { id: body.targetId }, select: { id: true, slug: true, aliases: true } }),
  ])
  if (!source || !target) throw new ApiError('not_found', 404)

  // Move the source's listings onto the target brand.
  await db.listing.updateMany({ where: { brandSlug: source.slug }, data: { brandSlug: target.slug } })

  // Fold the source's normalized key + aliases into the target so future posts of the
  // old name resolve to the target.
  let tAliases: string[] = []
  let sAliases: string[] = []
  try { tAliases = JSON.parse(target.aliases) } catch {}
  try { sAliases = JSON.parse(source.aliases) } catch {}
  const merged = Array.from(new Set([...tAliases, ...sAliases, source.normalized].filter(Boolean)))

  const liveCount = await db.listing.count({ where: { brandSlug: target.slug, verified: true, status: 'active' } })
  await db.brand.update({ where: { id: target.id }, data: { aliases: JSON.stringify(merged), listingCount: liveCount, curatedAt: new Date() } })
  await db.brand.delete({ where: { id: body.sourceId } })

  revalidatePath('/brands')
  return { ok: true }
})
