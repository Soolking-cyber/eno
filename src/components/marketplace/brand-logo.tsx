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
    const v = iconPath.trim()
    // A full <svg> (admin-curated, any viewBox) renders via an <img> data-URI —
    // browser-sandboxed (no script execution) and keeps the logo's own scale/colour.
    if (v.startsWith('<svg')) {
      // <img>-rendered SVG MUST carry the real SVG namespace; pasted/AI svgs often
      // omit or mangle it (e.g. "http://w3.org") → blank img. Force the correct one.
      const svg = v.replace(/<svg\b[^>]*>/i, (tag) =>
        tag.replace(/\s+xmlns\s*=\s*("[^"]*"|'[^']*')/i, '').replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"'),
      )
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
          width={size}
          height={size}
          alt={name}
          className={`object-contain ${className}`}
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
        className={`text-foreground ${className}`}
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
