'use client'

import { Facebook, Instagram, Youtube } from 'lucide-react'
import { useLanguage } from '@/context/language-context'

export function Footer() {
  const { tr } = useLanguage()

  const columns = [
    {
      title: tr('Customer service', 'Chăm sóc khách hàng'),
      links: [
        { label: tr('Help center', 'Trung tâm trợ giúp'), href: '/help' },
        { label: tr('Safe trading', 'An toàn giao dịch'), href: '/safety' },
        { label: tr('Contact us', 'Liên hệ'), href: 'mailto:support@eno.vn' },
      ],
    },
    {
      title: tr('About eno.vn', 'Về eno.vn'),
      links: [
        { label: tr('About us', 'Giới thiệu'), href: '/about' },
        { label: tr('How it works', 'Cách hoạt động'), href: '/guide' },
        { label: tr('How trust works', 'Điểm uy tín hoạt động thế nào'), href: '/trust' },
      ],
    },
    {
      title: tr('Shortcuts', 'Lối tắt'),
      links: [
        { label: tr('Post a listing', 'Đăng tin'), href: '/post' },
        { label: tr('Saved listings', 'Tin đã lưu'), href: '/saved' },
        { label: tr('Map', 'Bản đồ'), href: '/?view=map' },
        { label: tr('Browse by brand', 'Duyệt theo thương hiệu'), href: '/brands' },
      ],
    },
  ]

  return (
    <footer className="mt-auto bg-card pt-12 pb-8 text-muted-foreground">
      <div className="mx-auto w-full max-w-7xl px-3 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-1 space-y-3">
            <img src="/logo-mark.svg" alt="eno.vn" width={36} height={36} className="h-9 w-9" />
            <p className="max-w-[220px] text-xs leading-relaxed text-muted-foreground">
              {tr("eno.vn — Vietnam's trusted marketplace for the international community.", 'eno.vn — chợ uy tín cho cộng đồng quốc tế tại Việt Nam.')}
            </p>
            <div className="flex items-center gap-3 pt-1">
              <a href="https://www.facebook.com/profile.php?id=61591370031264" target="_blank" rel="noopener noreferrer me" aria-label="eno.vn on Facebook" className="text-muted-foreground transition-colors hover:text-accent-foreground"><Facebook className="h-5 w-5" /></a>
              <a href="https://www.instagram.com/eno.vn/" target="_blank" rel="noopener noreferrer me" aria-label="eno.vn on Instagram" className="text-muted-foreground transition-colors hover:text-accent-foreground"><Instagram className="h-5 w-5" /></a>
              <a href="https://www.youtube.com/@enovietnam" target="_blank" rel="noopener noreferrer me" aria-label="eno.vn on YouTube" className="text-muted-foreground transition-colors hover:text-accent-foreground"><Youtube className="h-5 w-5" /></a>
            </div>
          </div>

          {/* Link columns */}
          {columns.map((col) => (
            <div key={col.title} className="space-y-3">
              <h3 className="text-sm font-bold text-foreground">{col.title}</h3>
              <ul className="space-y-2">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a href={link.href} className="text-xs text-muted-foreground transition-colors hover:text-accent-foreground">{link.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Popular keyword landing pages — sitewide internal links so Google can
            discover + rank the expat-intent SEO entry pages. */}
        <nav aria-label={tr('Popular', 'Phổ biến')} className="mt-10 pt-6">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-body">{tr('Popular in Vietnam', 'Phổ biến tại Việt Nam')}</h3>
          <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
            <a href="/housing-vietnam-expats" className="text-xs text-muted-foreground transition-colors hover:text-accent-foreground">{tr('Housing for expats', 'Nhà ở cho người nước ngoài')}</a>
            <a href="/jobs-vietnam-expats" className="text-xs text-muted-foreground transition-colors hover:text-accent-foreground">{tr('Jobs for expats', 'Việc làm cho người nước ngoài')}</a>
            <a href="/motorbikes-for-sale-vietnam" className="text-xs text-muted-foreground transition-colors hover:text-accent-foreground">{tr('Motorbikes for sale & rent', 'Xe máy mua bán & cho thuê')}</a>
            <a href="/moving-sales-vietnam" className="text-xs text-muted-foreground transition-colors hover:text-accent-foreground">{tr('Moving sales', 'Thanh lý chuyển nhà')}</a>
            <a href="/services-for-expats-vietnam" className="text-xs text-muted-foreground transition-colors hover:text-accent-foreground">{tr('Services for expats', 'Dịch vụ cho người nước ngoài')}</a>
            <a href="/brands" className="text-xs text-muted-foreground transition-colors hover:text-accent-foreground">{tr('Browse by brand', 'Duyệt theo thương hiệu')}</a>
          </div>
        </nav>

        <div className="mt-10 flex flex-col items-center justify-between gap-2 pt-5 text-xs text-body sm:flex-row">
          <p className="flex items-center gap-1.5">
            <span>© {new Date().getFullYear()} eno.vn — {tr('All rights reserved.', 'Mọi quyền được bảo lưu.')}</span>
            <span aria-hidden="true">·</span>
            <span>{tr('Made in Saigon', 'Làm tại Sài Gòn')} <span aria-hidden="true">❤️</span></span>
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <a href="/terms" className="transition-colors hover:text-accent-foreground">{tr('Terms', 'Điều khoản')}</a>
            <a href="/privacy" className="transition-colors hover:text-accent-foreground">{tr('Privacy', 'Quyền riêng tư')}</a>
          </div>
        </div>
      </div>
    </footer>
  )
}
