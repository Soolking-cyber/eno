// Single cohesive "saved + searches" glyph: a heart with a magnifier integrated
// at the bottom-right, all in one stroke style (no tacked-on badge). Inherits
// currentColor + sizing via className, like a lucide icon.
export function SavedSearchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* Heart, scaled into the upper-left so the magnifier has room bottom-right.
          non-scaling-stroke keeps its line weight matched to the magnifier. */}
      <path
        vectorEffect="non-scaling-stroke"
        transform="scale(0.8)"
        d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"
      />
      {/* Magnifier at the bottom-right */}
      <circle cx="17" cy="16.8" r="3.1" />
      <line x1="19.4" y1="19.2" x2="22" y2="21.8" />
    </svg>
  )
}
