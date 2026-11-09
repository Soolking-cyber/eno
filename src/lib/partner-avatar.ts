/**
 * A partner's published logo → its storefront avatar: a 512² WebP with the mark fitted INSIDE the circle ui/avatar crops
 * to, flattened onto white, and how much of it is visible on that white.
 *
 * Shared by scripts/set-partner-avatar.ts (ownerless affiliate storefronts) and the partner importers that set the logo of
 * an OWNED storefront, which set-partner-avatar.ts refuses by design (scripts/import-saigonmoving.ts) — so both draw the
 * same avatar and apply the same floor. Server-only in practice (sharp), imported only by scripts.
 *
 * ⚠️ NO WATERMARK, and that is not an oversight: the eno mark goes on LISTING photos (src/lib/core/media.ts), never on a
 * shop's logo — stamping it across a partner's own mark would alter someone else's trademark.
 */

export const PARTNER_AVATAR_SIZE = 512
/**
 * ⛔ THE FLOOR UNDER WHICH THE MARK IS INVISIBLE ON THE WHITE IT WAS FLATTENED ONTO. A brand usually publishes TWO marks, a
 * colour one and a WHITE one for dark grounds; both decode and upload, and the white one flattened onto white is an empty
 * circle. That shipped once for CellphoneS (`Logo-CPS-m.png`: 3.7% non-white pixels, an empty ring on the storefront); its
 * colour asset measures 81% against the same ground. The check is on the OUTPUT, the artefact people see.
 */
export const PARTNER_AVATAR_MIN_VISIBLE_PCT = 8

export type PartnerAvatar = {
  /** The WebP to upload. */
  out: Buffer
  /** The source as decoded. */
  width: number | undefined
  height: number | undefined
  format: string | undefined
  /** The SVG rasterising density, when the source is an SVG. */
  density: number | undefined
  /** The edge of the square the mark is fitted into, inside the SIZE² canvas. */
  inner: number
  /** Share of the output's pixels darker than near-white, in percent. */
  visiblePct: number
}

export async function renderPartnerAvatar(src: Buffer): Promise<PartnerAvatar> {
  const SIZE = PARTNER_AVATAR_SIZE
  const sharp = (await import('sharp')).default
  const meta = await sharp(src).metadata()
  /**
   * ⚠️ AN SVG RASTERISES AT ITS INTRINSIC SIZE — a carrier's header logo is typically ~120x30 — and resizing that up to 512
   * is a blur. Render it at the density that already reaches SIZE instead.
   */
  const w = meta.width ?? SIZE, h = meta.height ?? SIZE
  const density = meta.format === 'svg' ? Math.min(2400, Math.ceil((72 * SIZE) / Math.max(w, h))) : undefined
  /**
   * ⚠️ THE AVATAR IS A CIRCLE (ui/avatar: rounded-full). A square mark fills it; a WIDE wordmark fitted edge to edge loses
   * both ends to the mask. So a non-square mark is fitted inside the circle — its box's half-diagonal no more than the
   * radius — and padded back out to SIZE.
   */
  const aspect = Math.max(w, h) / Math.min(w, h)
  const inner = aspect > 1.15 ? Math.floor(SIZE / Math.sqrt(1 + 1 / (aspect * aspect))) : SIZE
  const pad = Math.floor((SIZE - inner) / 2)
  // Flattened onto white rather than left transparent: the avatar renders on several surfaces (dark chips, coloured
  // cards) and a transparent cut-out would pick up whatever sits behind it.
  const out = await sharp(src, density ? { density } : {})
    .resize(inner, inner, { fit: 'contain', background: '#ffffff' })
    .extend({ top: pad, bottom: SIZE - inner - pad, left: pad, right: SIZE - inner - pad, background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .webp({ quality: 92 })
    .toBuffer()
  const { data: grey } = await sharp(out).greyscale().raw().toBuffer({ resolveWithObject: true })
  let visible = 0
  for (const px of grey) if (px < 245) visible++
  return { out, width: meta.width, height: meta.height, format: meta.format, density, inner, visiblePct: (visible / grey.length) * 100 }
}
