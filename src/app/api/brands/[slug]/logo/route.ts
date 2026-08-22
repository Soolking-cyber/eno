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

  // ⚠️ iconSlug is belt-and-braces, NOT the vector — measured before writing this.
  // brandIconPath sends it through iconPathForSlug, which is a `bySlug.get(slug)`
  // lookup against a fixed map, so an arbitrary slug yields null rather than
  // attacker-controlled bytes. logoPath is the one returned verbatim.
  // ⛔ AND THE OBVIOUS REGEX IS WRONG HERE: /^[a-z0-9-]+$/ rejects `uniqlo_ja`, a real
  // row in production (1 of 46 iconSlugs), so shipping it would 404 that brand's logo.
  // Underscores are part of the simple-icons slug vocabulary.
  // ⚠️ ONLY WHEN iconSlug IS ACTUALLY THE SOURCE. brandIconPath prefers logoPath, so
  // rejecting on iconSlug alone would 404 a brand whose logo comes from logoPath and
  // whose slug merely happens to be odd — 1 row today has both. A guard that breaks a
  // working path to protect an unused one is a regression wearing a security hat.
  if (!brand?.logoPath?.trim() && brand?.iconSlug && !/^[a-z0-9_-]+$/.test(brand.iconSlug)) {
    return new NextResponse(null, { status: 404 })
  }

  const path = brand ? brandIconPath(brand) : null
  if (!path) return new NextResponse(null, { status: 404 })

  // ⛔ THIS is the interpolated input: logoPath is admin-supplied free text
  // (`String(body.logoPath)` in api/admin/brands) and every one of the 44 populated
  // rows is a full <svg> document, so the raw branch below is the LIVE path, not an
  // edge case. It is handed to sharp/librsvg, which will resolve external references
  // and entities if asked — an SSRF and file-read surface reachable by anyone who can
  // edit a brand.
  // ⚠️ Blocklist chosen against the real rows, not from imagination: all 44 contain
  // `http://` — purely as xmlns namespace declarations (xmlns:dc, xmlns:cc, xmlns:rdf)
  // — so a naive "no URLs" rule would blank every brand logo in the catalogue. What
  // none of them contain, and what is therefore free to reject: doctypes/entities,
  // scripts, event handlers, and href/src/xlink:href pointing anywhere.
  if (/<\s*(!DOCTYPE|!ENTITY|script|foreignObject|image|use)\b/i.test(path)) {
    return new NextResponse(null, { status: 404 })
  }
  if (/\son\w+\s*=/i.test(path) || /(?:xlink:href|href|src)\s*=/i.test(path)) {
    return new NextResponse(null, { status: 404 })
  }
  // ⛔ CSS IS A FETCHING SURFACE TOO, AND THE FIRST VERSION OF THIS GUARD MISSED IT.
  // Three reviewers found the same hole independently: librsvg processes <style> and
  // style="", so `@import url(http://…)` and `fill:url(http://…)` reach the network
  // without ever using href, src or a blocked tag.
  // ⚠️ `url(` CANNOT SIMPLY BE BANNED — 5 real logos use it, and 22 use style="".
  // Measured: every one of those is a same-document paint reference (url(#a),
  // url(#clip0_1253_2900)) and not one is external. So allow url(#…) and reject the
  // rest, which is precise enough to keep the catalogue rendering and still close
  // http/https/data/file.
  if (/<\s*style\b/i.test(path) || /<\?xml-stylesheet/i.test(path) || /@import/i.test(path)) {
    return new NextResponse(null, { status: 404 })
  }
  // ⛔ ENTITY REFERENCES DECODE BEFORE THE PARSER SEES THE TEXT, so every regex here
  // is bypassable by spelling the payload out: style="fill:&#x75;rl(http://evil)" is
  // `url(` to librsvg and something harmless to a raw-string match. No real logo uses
  // a character reference (measured: 0 of 44), so the whole class is refused rather
  // than decoded — decoding first would just move the arms race one step along.
  if (/&#/.test(path)) {
    return new NextResponse(null, { status: 404 })
  }
  // ⚠️ CHECK THE CONTENTS OF url(), DO NOT LOOK AHEAD PAST AN OPTIONAL QUOTE. The
  // previous /url\(\s*['"]?\s*(?!#)/ backtracked: for url('#a) it matched the quote
  // as empty and then saw `'` instead of `#`, so a perfectly valid quoted fragment
  // reference was rejected. Nothing uses quotes today, which is exactly why that would
  // have sat unnoticed until someone uploaded one.
  for (const m of path.matchAll(/url\(([^)]*)\)/gi)) {
    if (!m[1].trim().replace(/^['"]|['"]$/g, '').startsWith('#')) {
      return new NextResponse(null, { status: 404 })
    }
  }

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
    // The bare branch interpolates straight into a `d` attribute. Path data has a
    // narrow grammar, so anything outside it — a quote that would escape the
    // attribute, an angle bracket that would open a tag — is rejected rather than
    // escaped. Nothing legitimate needs those characters.
    // Explicit whitespace, not \s: \s admits U+000C and U+000B, which are illegal in
    // XML 1.0 — a bare `d` could pass validation and still produce a malformed document.
    if (!/^[MmLlHhVvCcSsQqTtAaZz0-9 \t\n\r,.\-+eE]+$/.test(raw)) {
      return new NextResponse(null, { status: 404 })
    }
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
