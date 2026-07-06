'use client'

import { Facebook, Instagram, Youtube } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { COMPANY } from '@/lib/site-legal'

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
        { label: tr('Operating regulations', 'Quy chế hoạt động'), href: '/regulations' },
        { label: tr('Prohibited items', 'Hàng hóa & dịch vụ cấm'), href: '/prohibited' },
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

        {/* Legal identity of the operator — Decree 52/2013 Đ.36/Đ.29 requires the
            company name, address, ERC and contacts displayed on the site. Values
            come from src/lib/site-legal.ts (placeholders until the ERC is issued). */}
        <div className="mt-10 space-y-1 pt-5 text-[11px] leading-relaxed text-body">
          <p className="font-semibold text-muted-foreground">{COMPANY.name}</p>
          <p>{tr('Head office', 'Trụ sở')}: {COMPANY.address}</p>
          <p>{tr('Business registration no.', 'GCN ĐKDN số')}: {COMPANY.erc} · {tr('issued', 'cấp')}: {COMPANY.ercIssued}</p>
          <p>Email: <a href={`mailto:${COMPANY.email}`} className="transition-colors hover:text-accent-foreground">{COMPANY.email}</a> · {tr('Phone', 'Điện thoại')}: {COMPANY.phone}</p>
          <p className="text-ink-4">{tr('E-commerce platform registration with the Ministry of Industry and Trade: in progress.', 'Đăng ký sàn giao dịch TMĐT với Bộ Công Thương: đang thực hiện.')}</p>
        </div>

        <div className="mt-6 flex flex-col items-center justify-between gap-2 pt-5 text-xs text-body sm:flex-row">
          <p className="flex items-center gap-1.5">
            <span>© {new Date().getFullYear()} eno.vn — {tr('All rights reserved.', 'Mọi quyền được bảo lưu.')}</span>
            <span aria-hidden="true">·</span>
            <span>{tr('Made in Saigon', 'Làm tại Sài Gòn')} <span aria-hidden="true">❤️</span></span>
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <a href="/terms" className="transition-colors hover:text-accent-foreground">{tr('Terms', 'Điều khoản')}</a>
            <a href="/privacy" className="transition-colors hover:text-accent-foreground">{tr('Privacy', 'Quyền riêng tư')}</a>
            <a href="/regulations" className="transition-colors hover:text-accent-foreground">{tr('Regulations', 'Quy chế')}</a>
          </div>
        </div>
      </div>
    </footer>
  )
}
