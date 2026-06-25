// Monotone brand mark for the directory + search surfaces. Renders the simple-icons
// SVG path when the brand is recognized (resolved server-side and passed in as
// `iconPath`); otherwise a clean monogram chip. No client JS — pure presentation.

function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return name.trim().slice(0, 2).toUpperCase()
}

export function BrandLogo({
  name,
  iconPath,
  size = 40,
  flat = false,
  className = '',
}: {
  name: string
  iconPath?: string | null
  size?: number
  // flat = monolith style: square monogram with a hairline border, no fill (for
  // the on-canvas brand rail). Default keeps the tinted circle (cards/chips).
  flat?: boolean
  className?: string
}) {
  if (iconPath) {
    // Drop any leading XML prolog / comments so files that start with
    // "<?xml …?>" are still recognized as SVG (not mistaken for path data).
    const raw = iconPath.trim()
    const svgAt = raw.search(/<svg[\s>]/i)
    const v = svgAt >= 0 ? raw.slice(svgAt) : raw
    // A full <svg> (admin-curated, any viewBox) is rendered as a CSS MASK filled with
    // currentColor — so it shows as a MONOTONE silhouette in the theme's foreground
    // colour and adapts to dark mode automatically (the logo's own — often black —
    // fills are ignored; only its shape is used). Same data-URI sandbox as an <img>
    // (no script execution), and consistent with the monotone path rendering below.
    if (v.startsWith('<svg')) {
      // The SVG MUST carry the real namespace; pasted/AI svgs often omit or mangle it
      // (e.g. "http://w3.org") → blank. Force the correct one.
      const svg = v.replace(/<svg\b[^>]*>/i, (tag) =>
        tag.replace(/\s+xmlns\s*=\s*("[^"]*"|'[^']*')/i, '').replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"'),
      )
      const uri = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
      return (
        <span
          role="img"
          aria-label={name}
          className={`inline-block shrink-0 bg-current text-body ${className}`}
          style={{
            width: size,
            height: size,
            WebkitMaskImage: uri,
            maskImage: uri,
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center',
            maskPosition: 'center',
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
          }}
        />
      )
    }
    // Otherwise it's monotone path data (simple-icons, or a pasted 24×24 path):
    // render in currentColor so it tints with the rail/card.
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        role="img"
        aria-label={name}
        className={`text-body ${className}`}
        fill="currentColor"
      >
        <path d={iconPath} />
      </svg>
    )
  }
  return (
    <span
      aria-label={name}
      className={`inline-flex items-center justify-center font-bold text-accent-foreground ${flat ? 'rounded-xl border border-line-strong' : 'rounded-full bg-tint'} ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {monogram(name)}
    </span>
  )
}
