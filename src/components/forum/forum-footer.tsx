'use client'

import Link from 'next/link'
import { FileCheck2, MessageCircleQuestion, Route, Store } from 'lucide-react'
import { useLanguage } from '@/context/language-context'

const MARKETPLACE_URL = process.env.NEXT_PUBLIC_MARKETPLACE_URL || 'https://eno.vn'

export function ForumFooter() {
  const { tr } = useLanguage()
  const links = [
    { href: '/', icon: MessageCircleQuestion, label: tr('Forum', 'Diễn đàn'), external: false },
    { href: '/itinerary', icon: Route, label: tr('Itinerary', 'Lịch trình'), external: false },
    { href: '/visa', icon: FileCheck2, label: tr('Vietnam e-Visa', 'E-Visa Việt Nam'), external: false },
    { href: MARKETPLACE_URL, icon: Store, label: tr('Marketplace', 'Chợ mua bán'), external: true },
  ]
  return (
    <footer className="mt-auto border-t border-border/80 bg-card">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-3 py-8 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div>
          <img src="/logo.svg" alt="eno" width={1200} height={300} className="h-7 w-auto" />
          <p className="mt-2 text-xs text-body">{tr('Practical help for living in and visiting Vietnam.', 'Hỗ trợ thiết thực để sống và du lịch tại Việt Nam.')}</p>
        </div>
        <nav aria-label={tr('eno quick links', 'Liên kết nhanh eno')} className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {links.map(({ href, icon: Icon, label, external }) => {
            const className = 'inline-flex h-11 items-center gap-2 rounded-xl border border-line-strong bg-background px-3 text-sm font-semibold text-body transition-colors hover:border-brand hover:text-accent-foreground'
            return external
              ? <a key={href} href={href} className={className}><Icon className="h-4 w-4" />{label}</a>
              : <Link key={href} href={href} className={className}><Icon className="h-4 w-4" />{label}</Link>
          })}
        </nav>
      </div>
    </footer>
  )
}
