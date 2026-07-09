'use client'

import { cn } from '@/lib/utils'

// Shared toggle switch — one role="switch" button consolidating the bespoke toggles that
// drifted across the app (different sizes, off-colours, thumb-animation strategies). Encodes
// two things ONCE so they can't regress: (1) the thumb is positioned with `left`, not
// translate-x — a transform-positioned thumb mispositions inside CSS multi-column layouts
// (the Settings page); (2) a keyboard focus ring for a11y.
const SIZES = {
  sm: { track: 'h-5 w-9', thumb: 'h-4 w-4', on: 'left-[18px]', off: 'left-0.5' },
  md: { track: 'h-6 w-11', thumb: 'h-5 w-5', on: 'left-[22px]', off: 'left-0.5' },
} as const

export function Switch({
  checked,
  onChange,
  label,
  size = 'md',
  className,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label?: string
  size?: keyof typeof SIZES
  className?: string
}) {
  const s = SIZES[size]
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative shrink-0 cursor-pointer rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        s.track,
        checked ? 'bg-primary' : 'bg-input',
        className,
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 rounded-full bg-white shadow transition-[left]',
          s.thumb,
          checked ? s.on : s.off,
        )}
      />
    </button>
  )
}
