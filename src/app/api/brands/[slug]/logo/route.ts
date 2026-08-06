import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { db } from '@/lib/db'
import { brandIconPath } from '@/lib/brand-icons'

export const runtime = 'nodejs'

// Monotone brand logo as a rasterized PNG — for the NATIVE apps (iOS/Android),
// whose image loaders can't render the simple-icons SVG the web masks in CSS.
// The web resolves brand → SVG path server-side (brandIconPath); here we tint it
// to the requested color and rasterize so AsyncImage / Coil just load a PNG.
// Brands with no logo 404 → the native side draws its monogram chip instead.
//   ?w=<px, ≤256>   render width (square). ?c=<hex, no #>  fill color.
//
// ⚠️ WS6 — NOT MIGRATED: this route never emits `{ error }` at all. It answers a PNG with its own
// Content-Type + Cache-Control, or a bodyless 404 (`new NextResponse(null, { status: 404 })`) that the
// native image loaders read as "no logo, draw the monogram". route()'s value is the JSON error
// envelope and the preamble, and there is neither here — public, no limiter, no JSON body, so all four
// options would be empty and every return would still have to be a hand-built Response.
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const w = Math.min(parseInt(req.nextUrl.searchParams.get('w') || '96', 10) || 96, 256)
  const color = '#' + (req.nextUrl.searchParams.get('c') || '111827').replace(/[^0-9a-fA-F]/g, '').slice(0, 6)

  const brand = await db.brand.findUnique({ where: { slug }, select: { iconSlug: true, logoPath: true } })
  const path = brand ? brandIconPath(brand) : null
  if (!path) return new NextResponse(null, { status: 404 })

  // Two shapes come out of brandIconPath: a bare simple-icons path `d` string
  // (24×24 viewBox, single path) or a full admin <svg>. Wrap/fill accordingly.
  const raw = path.trim()
  let svg: string
  if (raw.startsWith('<svg') || raw.includes('<svg')) {
    const at = raw.search(/<svg[\s>]/i)
    // Force every fill to the tint color so the mark reads monotone.
    svg = raw.slice(at).replace(/fill="[^"]*"/gi, `fill="${color}"`)
    if (!/fill=/.test(svg)) svg = svg.replace(/<svg\b/i, `<svg fill="${color}"`)
  } else {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${color}" d="${raw}"/></svg>`
  }

  try {
    const png = await sharp(Buffer.from(svg), { density: 384 })
      .resize(w, w, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
    return new NextResponse(png as unknown as BodyInit, {
      headers: {
        'Content-Type': 'image/png',
        // Brands + their logos change rarely; let the CDN + client hold them long.
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800',
      },
    })
  } catch {
    return new NextResponse(null, { status: 404 })
  }
}
