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
        { label: tr('Report a listing', 'Báo cáo tin đăng'), href: '/safety' },
        { label: tr('Contact us', 'Liên hệ'), href: '/about#contact' },
      ],
    },
    {
      title: tr('About ENO', 'Về ENO'),
      links: [
        { label: tr('About us', 'Giới thiệu'), href: '/about' },
        { label: tr('How verification works', 'Cách xác minh tin'), href: '/about' },
        { label: tr('Careers', 'Tuyển dụng'), href: '/about' },
        { label: tr('Press', 'Báo chí'), href: '/about#contact' },
      ],
    },
    {
      title: tr('Shortcuts', 'Lối tắt'),
      links: [
        { label: tr('Post a listing', 'Đăng tin'), href: '/post' },
        { label: tr('Saved listings', 'Tin đã lưu'), href: '/saved' },
        { label: tr('Map', 'Bản đồ'), href: '/' },
        { label: tr('Help', 'Trợ giúp'), href: '/help' },
      ],
    },
  ]

  return (
    <footer className="mt-auto border-t border-slate-200/60 bg-card pt-12 pb-8 text-muted-foreground">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-1 space-y-3">
            <img src="/logo-mark.svg" alt="ENO" width={36} height={36} className="h-9 w-9" />
            <p className="max-w-[220px] text-xs leading-relaxed text-[#64748b]">
              {tr("ENO — the verified marketplace for Vietnam's international community.", 'ENO — chợ tin đăng được xác minh cho cộng đồng quốc tế tại Việt Nam.')}
            </p>
            <div className="flex items-center gap-3 pt-1">
              <a href="#top" aria-label="Facebook" className="text-[#64748b] transition-colors hover:text-[#0a66c2]"><Facebook className="h-5 w-5" /></a>
              <a href="#top" aria-label="Instagram" className="text-[#64748b] transition-colors hover:text-[#0a66c2]"><Instagram className="h-5 w-5" /></a>
              <a href="#top" aria-label="YouTube" className="text-[#64748b] transition-colors hover:text-[#0a66c2]"><Youtube className="h-5 w-5" /></a>
            </div>
          </div>

          {/* Link columns */}
          {columns.map((col) => (
            <div key={col.title} className="space-y-3">
              <h3 className="text-sm font-bold text-[#1a202c]">{col.title}</h3>
              <ul className="space-y-2">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a href={link.href} className="text-xs text-[#64748b] transition-colors hover:text-[#0a66c2]">{link.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-2 border-t border-slate-200/60 pt-5 text-xs text-[#94a3b8] sm:flex-row">
          <p className="flex items-center gap-1.5">
            <span>© {new Date().getFullYear()} eno.vn — {tr('All rights reserved.', 'Mọi quyền được bảo lưu.')}</span>
            <span aria-hidden="true">·</span>
            <span>{tr('Made in Saigon', 'Làm tại Sài Gòn')} <span aria-hidden="true">❤️</span></span>
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <a href="/terms" className="transition-colors hover:text-[#0a66c2]">{tr('Terms', 'Điều khoản')}</a>
            <a href="/privacy" className="transition-colors hover:text-[#0a66c2]">{tr('Privacy', 'Quyền riêng tư')}</a>
          </div>
        </div>
      </div>
    </footer>
  )
}
