import { NextRequest, NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { containsPhoneNumber } from '@/lib/phone'
import { buildSearchText } from '@/lib/fold'
import { warmTranslations } from '@/lib/translate'
import { getSupabaseAdmin, LISTINGS_BUCKET } from '@/lib/supabase-admin'
import { isListingImageUrl } from '@/lib/listing-image'
import { safeFetch } from '@/lib/ssrf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_ROWS = 200
const MAX_IMG_BYTES = 5 * 1024 * 1024
const IMG_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

type Row = { category_slug?: string; title?: string; description?: string; price?: unknown; district?: string; condition?: string; image_urls?: string }
type RowResult = { row: number; id?: string; error?: string }

// Server-fetch a remote image and re-host it in our Storage bucket (so bulk image
// URLs become first-party, validated assets — never hotlinks). Already-hosted
// Supabase URLs pass through. Returns null on any failure (bad type/size/fetch).
async function rehost(url: string): Promise<string | null> {
  if (isListingImageUrl(url)) return url
  try {
    // SSRF-guarded: https-only, re-validates the host at every redirect hop and
    // rejects any URL that resolves to a private/loopback/link-local address.
    const res = await safeFetch(url, { timeoutMs: 8000 })
    if (!res.ok) return null
    const type = (res.headers.get('content-type') || '').split(';')[0].trim()
    const ext = IMG_EXT[type]
    if (!ext) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMG_BYTES) return null
    const path = `bulk/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const admin = getSupabaseAdmin()
    const { error } = await admin.storage.from(LISTINGS_BUCKET).upload(path, buf, { contentType: type, upsert: false })
    if (error) return null
    return admin.storage.from(LISTINGS_BUCKET).getPublicUrl(path).data.publicUrl
  } catch { return null }
}

// Bulk listing upload (business tier). Each row is RE-VALIDATED server-side
// (never trust the client preview); image URLs are re-hosted; listings are
// created under the caller's OWN storefront with the same auto-publish gate as
// single posts. Returns per-row results so the UI can show exactly what imported.
export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  if (profile.accountType !== 'business') return NextResponse.json({ error: 'business_only' }, { status: 403 })

  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true, name: true, trustTier: true } })
  if (!seller) return NextResponse.json({ error: 'no_storefront' }, { status: 403 })

  let body: { rows?: Row[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, MAX_ROWS) : []
  if (rows.length === 0) return NextResponse.json({ error: 'no_rows' }, { status: 400 })
  if (Array.isArray(body.rows) && body.rows.length > MAX_ROWS) {
    // Surface the cap rather than silently dropping the tail.
    return NextResponse.json({ error: 'too_many_rows', max: MAX_ROWS }, { status: 400 })
  }

  // Resolve all referenced categories once.
  const slugs = [...new Set(rows.map((r) => String(r.category_slug || '').trim()).filter(Boolean))]
  const cats = await db.category.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true, name: true, nameVi: true } })
  const catBySlug = new Map(cats.map((c) => [c.slug, c]))

  const results: RowResult[] = []
  const warm: string[] = []

  // Process sequentially (image re-hosting is network-bound; pacing avoids a
  // burst of fetches/uploads). Each row is independent — one bad row never aborts
  // the batch.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const rowNo = i + 1
    try {
      const categorySlug = String(r.category_slug || '').trim()
      const title = String(r.title || '').trim().slice(0, 140)
      const description = String(r.description || '').trim().slice(0, 5000)
      const district = r.district ? String(r.district).trim().slice(0, 80) : null
      const condition = r.condition ? String(r.condition).trim().slice(0, 60) : null
      const price = Number(r.price)
      const cat = catBySlug.get(categorySlug)

      if (!cat) { results.push({ row: rowNo, error: `Unknown category "${categorySlug}"` }); continue }
      if (title.length < 3) { results.push({ row: rowNo, error: 'Title too short (min 3 chars)' }); continue }
      if (!Number.isFinite(price) || price < 0 || price > 1e12) { results.push({ row: rowNo, error: 'Invalid price' }); continue }
      if (containsPhoneNumber(title) || containsPhoneNumber(description)) { results.push({ row: rowNo, error: 'Phone numbers not allowed in title/description' }); continue }

      // Re-host up to 8 images from the pipe/comma-separated URL list.
      const rawUrls = String(r.image_urls || '').split(/[|,\n]/).map((u) => u.trim()).filter(Boolean).slice(0, 8)
      const hosted: string[] = []
      for (const u of rawUrls) { const h = await rehost(u); if (h) hosted.push(h) }

      const autoPublish = hosted.length >= 1 && seller.trustTier !== 'restricted'
      const listing = await db.listing.create({
        data: {
          title, description, price, priceUnit: 'VND', currency: '₫', negotiable: false,
          location: district || 'Ho Chi Minh City', district, city: 'Ho Chi Minh City',
          condition, images: JSON.stringify(hosted),
          searchText: buildSearchText([title, description, district, cat.name, cat.nameVi]),
          categoryId: cat.id, sellerId: seller.id, verified: autoPublish,
        },
        select: { id: true },
      })
      results.push({ row: rowNo, id: listing.id })
      warm.push(title, description)
    } catch {
      results.push({ row: rowNo, error: 'Failed to create' })
    }
  }

  if (warm.length) after(() => warmTranslations(warm.filter(Boolean)))

  const created = results.filter((r) => r.id).length
  return NextResponse.json({ created, failed: results.length - created, results })
}
