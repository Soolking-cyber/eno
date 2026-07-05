import Link from 'next/link'
import { ShieldCheck, List, Tag, MessageSquareText, Gavel } from 'lucide-react'

const TABS = [
  { href: '/admin', label: 'Moderation', icon: ShieldCheck },
  { href: '/admin/enforcement', label: 'Enforcement', icon: Gavel },
  { href: '/admin/listings', label: 'Listings', icon: List },
  { href: '/admin/brands', label: 'Brands', icon: Tag },
  { href: '/admin/feedback', label: 'Feedback', icon: MessageSquareText },
]

// Small nav shared across the admin tools.
export function AdminNav({ active }: { active: string }) {
  return (
    <nav className="mb-6 flex flex-wrap items-center gap-1">
      {TABS.map((t) => {
        const isActive = t.href === active
        const Icon = t.icon
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              'inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ' +
              (isActive ? 'bg-primary text-white' : 'text-body hover:bg-muted')
            }
          >
            <Icon className="h-4 w-4" />
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
