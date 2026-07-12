import { cn } from '@/lib/utils'

// Shared multiline field — same idioms as <Input> (filled tint default, outline
// variant), plus a sane min height and vertical-only resize. See input.tsx.
const VARIANTS = {
  filled: 'bg-tint focus:ring-2 focus:ring-ring/30',
  outline:
    'border border-line-strong bg-card focus:border-brand focus:ring-2 focus:ring-ring/30',
} as const

export function Textarea({
  variant = 'filled',
  className,
  ...props
}: { variant?: keyof typeof VARIANTS } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'min-h-24 w-full resize-y rounded-xl px-4 py-3 text-sm text-foreground outline-none placeholder:text-ink-4 disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  )
}
