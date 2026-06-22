// "Sao" — eno.vn's trust mascot: a friendly shield (protection = trust), drawn
// monotone with currentColor so it can be tinted to brand blue and used at any
// opacity. Use as a soft watermark/imprint (low opacity, large) or a hero
// illustration (full color). Decorative only → aria-hidden.
export function EnoMascot({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 140" className={className} fill="none" aria-hidden role="presentation">
      {/* Shield body — soft tinted fill + crisp outline */}
      <path
        d="M60 8 L102 24 Q106 25.5 106 30 L106 68 Q106 104 60 132 Q14 104 14 68 L14 30 Q14 25.5 18 24 Z"
        fill="currentColor"
        fillOpacity="0.14"
        stroke="currentColor"
        strokeOpacity="0.9"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      {/* Eyes */}
      <circle cx="45" cy="62" r="5" fill="currentColor" />
      <circle cx="75" cy="62" r="5" fill="currentColor" />
      {/* Smile */}
      <path d="M43 82 Q60 96 77 82" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" fill="none" />
      {/* Trust spark — a tiny check above the brow */}
      <path d="M52 36 l5 5 11 -12" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" strokeOpacity="0.55" />
    </svg>
  )
}
