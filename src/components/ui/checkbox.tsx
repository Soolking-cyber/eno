import { cn } from '@/lib/utils'

// Shared checkbox — a NATIVE input with `accent-color` mapped to the brand blue.
// Deliberately not a Radix re-implementation: native checkboxes are accessible,
// zero-JS, and render the platform's own control (accent-color themes the check
// itself), which is the right feel on a mobile-first marketplace.
export function Checkbox({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn('size-4 shrink-0 cursor-pointer accent-brand', className)}
      {...props}
    />
  )
}
