import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// Shared centered empty / error placeholder: the dashed-border card (icon + title +
// optional subtitle + optional action) that was hand-rolled in ~14 places — empty lists,
// failed fetches (icon + message + retry button), and "nothing here yet" notices.
// No 'use client' / no hooks → usable from server and client components alike.
//   tone: 'default' = dashed border (marketplace surfaces) · 'admin' = solid border.
export function EmptyState({
  icon: Icon,
  title,
  subtitle,
  action,
  tone = 'default',
  className,
}: {
  icon?: LucideIcon
  title: React.ReactNode
  subtitle?: React.ReactNode
  action?: React.ReactNode
  tone?: 'default' | 'admin'
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 rounded-2xl border px-6 py-14 text-center',
        tone === 'admin' ? 'border-border' : 'border-dashed border-line-strong',
        className,
      )}
    >
      {Icon && <Icon className="h-10 w-10 text-muted-foreground" />}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-body">{title}</p>
        {subtitle && <p className="mx-auto max-w-sm text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
