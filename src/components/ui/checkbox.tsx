import { cn } from '@/lib/utils'

// Shared checkbox — a NATIVE input with `accent-color` mapped to the brand blue.
// Deliberately not a Radix re-implementation: native checkboxes are accessible,
// zero-JS, and render the platform's own control (accent-color themes the check
// itself), which is the right feel on a mobile-first marketplace.
// `indeterminate` is a DOM property (not an attribute), so it's applied via ref —
// used by table header select-alls when some-but-not-all rows are selected.
export function Checkbox({
  className,
  indeterminate,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { indeterminate?: boolean }) {
  return (
    <input
      type="checkbox"
      ref={(el) => { if (el) el.indeterminate = indeterminate ?? false }}
      className={cn('size-4 shrink-0 cursor-pointer accent-brand', className)}
      {...props}
    />
  )
}
