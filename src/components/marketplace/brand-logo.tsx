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
  className = '',
}: {
  name: string
  iconPath?: string | null
  size?: number
  className?: string
}) {
  if (iconPath) {
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
      className={`inline-flex items-center justify-center rounded-full bg-tint font-bold text-accent-foreground ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {monogram(name)}
    </span>
  )
}
