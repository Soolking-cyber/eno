import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { normalizeBrand } from '@/lib/brand-normalize'
import { brandIconPath } from '@/lib/brand-icons'

export const dynamic = 'force-dynamic'

// Admin brand curation. Every action re-checks the session via getAdmin().
//   GET                      → all brands (newest-created / least-curated first)
//   PATCH {id, ...fields}    → edit name / iconSlug / logoPath / status / aliases
//   POST  {action:'merge', sourceId, targetId} → fold one brand into another

export async function GET() {
  if (!(await getAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const rows = await db.brand.findMany({
    select: { id: true, slug: true, name: true, normalized: true, aliases: true, iconSlug: true, logoPath: true, listingCount: true, status: true, curatedAt: true },
    orderBy: [{ curatedAt: 'asc' }, { listingCount: 'desc' }, { name: 'asc' }], // uncurated (null) first
    take: 1000,
  })
  // Resolve the effective preview path server-side (simple-icons stays off the client).
  const brands = rows.map((b) => ({ ...b, iconPath: brandIconPath(b), curatedAt: b.curatedAt?.toISOString() ?? null }))
  return NextResponse.json({ brands })
}

export async function PATCH(req: NextRequest) {
  if (!(await getAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  let body: { id?: string; name?: string; iconSlug?: string | null; logoPath?: string | null; status?: string; aliases?: string[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  if (!body.id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  const data: Record<string, unknown> = { curatedAt: new Date() }
  if (body.name !== undefined) {
    const name = String(body.name).trim().slice(0, 60)
    if (name) data.name = name
  }
  if (body.iconSlug !== undefined) data.iconSlug = body.iconSlug ? String(body.iconSlug).trim().slice(0, 80) : null
  if (body.logoPath !== undefined) {
    const raw = body.logoPath ? String(body.logoPath).trim() : ''
    let clean = ''
    if (raw.startsWith('<svg')) {
      // Full SVG (rendered via an <img> data-URI, so already script-sandboxed) — still
      // strip script/handlers/foreignObject defensively, and require a well-formed <svg>.
      const stripped = raw
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
        .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/javascript:/gi, '')
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
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  if (!(await getAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  let body: { action?: string; sourceId?: string; targetId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  if (body.action !== 'merge' || !body.sourceId || !body.targetId || body.sourceId === body.targetId) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const [source, target] = await Promise.all([
    db.brand.findUnique({ where: { id: body.sourceId }, select: { slug: true, normalized: true, aliases: true } }),
    db.brand.findUnique({ where: { id: body.targetId }, select: { id: true, slug: true, aliases: true } }),
  ])
  if (!source || !target) return NextResponse.json({ error: 'not_found' }, { status: 404 })

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
  return NextResponse.json({ ok: true })
}
