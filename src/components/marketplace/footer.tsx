'use client'

import { Facebook, Instagram, Youtube } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { COMPANY } from '@/lib/site-legal'
import { TAXONOMY } from '@/lib/taxonomy'

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
    {
      title: tr('Popular searches', 'Tìm kiếm phổ biến'),
      links: [
        { label: tr('Housing in Vietnam for expats', 'Nhà ở cho người nước ngoài tại Việt Nam'), href: '/housing-vietnam-expats' },
        { label: tr('Jobs in Vietnam for expats', 'Việc làm cho người nước ngoài'), href: '/jobs-vietnam-expats' },
        { label: tr('Motorbikes for sale in Vietnam', 'Mua bán xe máy tại Việt Nam'), href: '/motorbikes-for-sale-vietnam' },
        { label: tr('Moving sales in Vietnam', 'Thanh lý chuyển nhà tại Việt Nam'), href: '/moving-sales-vietnam' },
        { label: tr('Services for expats in Vietnam', 'Dịch vụ cho người nước ngoài'), href: '/services-for-expats-vietnam' },
      ],
    },
    {
      title: tr('Community', 'Cộng đồng'),
      links: [
        { label: tr('Expat forum', 'Diễn đàn cộng đồng'), href: 'https://www.eno.forum' },
        { label: tr('Trip planner', 'Lập kế hoạch chuyến đi'), href: 'https://www.eno.forum/itinerary' },
        { label: tr('Vietnam e-Visa help', 'Hỗ trợ e-Visa Việt Nam'), href: 'https://www.eno.forum/visa' },
      ],
    },
  ]

  return (
    <footer id="app-footer" className="mt-auto pt-8 pb-8 text-muted-foreground">
      <div className="mx-auto w-full max-w-7xl px-3 sm:px-6 lg:px-8">
        {/* Blends into the page canvas (no bg-card). The divider is on the GRID, so it spans the
            CONTENT width inset by the gutter — a contained hairline, NOT the full-viewport edge. */}
        <div className="grid grid-cols-2 gap-8 border-t border-border/60 pt-12 md:grid-cols-4">
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

          {/* Explore — crawlable internal links to every /c/{slug} category landing
              (SEO internal linking). Slugs and bilingual names come straight from the
              canonical taxonomy (src/lib/taxonomy.ts), so this never drifts from it. */}
          <div className="col-span-2 space-y-3">
            <h3 className="text-sm font-bold text-foreground">{tr('Explore', 'Khám phá')}</h3>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-2">
              {TAXONOMY.map((cat) => (
                <li key={cat.slug}>
                  <a href={`/c/${cat.slug}`} className="text-xs text-muted-foreground transition-colors hover:text-accent-foreground">{tr(cat.name, cat.nameVi)}</a>
                </li>
              ))}
            </ul>
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
        <div className="mt-10 space-y-1 pt-5 text-2xs leading-relaxed text-body">
          <p className="font-semibold text-muted-foreground">{COMPANY.name}</p>
          <p>{tr('Head office', 'Trụ sở')}: {COMPANY.address}</p>
          <p>{tr('Business registration no.', 'GCN ĐKDN số')}: {COMPANY.erc} · {tr('issued', 'cấp')}: {COMPANY.ercIssued}</p>
          <p>{tr('Email', 'Email')}: <a href={`mailto:${COMPANY.email}`} className="transition-colors hover:text-accent-foreground">{COMPANY.email}</a> · {tr('Phone', 'Điện thoại')}: {COMPANY.phone}</p>
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
            {/* Consent withdrawal entry point — reopens the cookie banner (PDPL). */}
            <Button type="button" variant="bare" size="none" onClick={() => window.dispatchEvent(new CustomEvent('eno:open-consent'))} className="cursor-pointer text-xs font-normal transition-colors hover:text-accent-foreground">{tr('Cookie settings', 'Cài đặt cookie')}</Button>
          </div>
        </div>
      </div>
    </footer>
  )
}
