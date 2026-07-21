'use client'

import { Facebook, Instagram, Youtube } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { MARKETPLACE_BASE, MARKETPLACE_CATEGORIES } from '@/components/forum/marketplace-links'
import { COMPANY } from '@/lib/site-legal'

const MARKETPLACE_URL = (process.env.NEXT_PUBLIC_MARKETPLACE_URL || 'https://eno.vn').replace(/\/$/, '')

export function ForumFooter() {
  const { tr } = useLanguage()
  const columns = [
    {
      title: tr('Customer service', 'Chăm sóc khách hàng'),
      links: [
        { label: tr('Help center', 'Trung tâm trợ giúp'), href: `${MARKETPLACE_URL}/help` },
        { label: tr('Safe trading', 'An toàn giao dịch'), href: `${MARKETPLACE_URL}/safety` },
        { label: tr('Contact us', 'Liên hệ'), href: `mailto:${COMPANY.email}` },
      ],
    },
    {
      title: tr('About eno.vn', 'Về eno.vn'),
      links: [
        { label: tr('About us', 'Giới thiệu'), href: `${MARKETPLACE_URL}/about` },
        { label: tr('How it works', 'Cách hoạt động'), href: `${MARKETPLACE_URL}/guide` },
        { label: tr('How trust works', 'Điểm uy tín hoạt động thế nào'), href: `${MARKETPLACE_URL}/trust` },
        { label: tr('Operating regulations', 'Quy chế hoạt động'), href: `${MARKETPLACE_URL}/regulations` },
        { label: tr('Prohibited items', 'Hàng hóa & dịch vụ cấm'), href: `${MARKETPLACE_URL}/prohibited` },
      ],
    },
    {
      title: tr('Shortcuts', 'Lối tắt'),
      links: [
        { label: tr('Post a listing', 'Đăng tin'), href: `${MARKETPLACE_URL}/post` },
        { label: tr('Saved listings', 'Tin đã lưu'), href: `${MARKETPLACE_URL}/saved` },
        { label: tr('Map', 'Bản đồ'), href: `${MARKETPLACE_URL}/?view=map` },
        { label: tr('Browse by brand', 'Duyệt theo thương hiệu'), href: `${MARKETPLACE_URL}/brands` },
      ],
    },
  ]

  return (
    <footer id="app-footer" className="mt-auto pb-8 pt-8 text-body">
      <div className="mx-auto w-full max-w-7xl px-3 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 border-t border-border/60 pt-12 md:grid-cols-4">
          <div className="col-span-2 space-y-3 md:col-span-1">
            <img src="/logo-mark.svg" alt="eno.vn" width={36} height={36} className="h-9 w-9" />
            <p className="max-w-[220px] text-xs leading-relaxed text-body">
              {tr("eno.vn — Vietnam's trusted marketplace for the international community.", 'eno.vn — chợ uy tín cho cộng đồng quốc tế tại Việt Nam.')}
            </p>
            <div className="flex items-center gap-3 pt-1">
              <a href="https://www.facebook.com/profile.php?id=61591370031264" target="_blank" rel="noopener noreferrer me" aria-label="eno.vn on Facebook" className="text-body transition-colors hover:text-accent-foreground"><Facebook className="h-5 w-5" /></a>
              <a href="https://www.instagram.com/eno.vn/" target="_blank" rel="noopener noreferrer me" aria-label="eno.vn on Instagram" className="text-body transition-colors hover:text-accent-foreground"><Instagram className="h-5 w-5" /></a>
              <a href="https://www.youtube.com/@enovietnam" target="_blank" rel="noopener noreferrer me" aria-label="eno.vn on YouTube" className="text-body transition-colors hover:text-accent-foreground"><Youtube className="h-5 w-5" /></a>
            </div>
          </div>

          {/* Explore — deep links to every eno.vn category landing. eno.vn's own footer
              carries this block for internal linking; the forum was missing it, so the only
              backlinks here were to top-level pages. Fifteen category landings are worth far
              more than fifteen more links to the homepage. */}
          <div className="col-span-2 space-y-3">
            <h2 className="text-sm font-bold text-foreground">{tr('Explore eno.vn', 'Khám phá eno.vn')}</h2>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-2">
              {MARKETPLACE_CATEGORIES.map((category) => (
                <li key={category.slug}>
                  <a href={`${MARKETPLACE_BASE}/c/${category.slug}`} className="text-xs text-body transition-colors hover:text-accent-foreground">{tr(category.en, category.vi)}</a>
                </li>
              ))}
            </ul>
          </div>

          {columns.map((column) => (
            <div key={column.title} className="space-y-3">
              <h2 className="text-sm font-bold text-foreground">{column.title}</h2>
              <ul className="space-y-2">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a href={link.href} className="text-xs text-body transition-colors hover:text-accent-foreground">{link.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 space-y-1 pt-5 text-2xs leading-relaxed text-body">
          <p className="font-semibold text-foreground">{COMPANY.name}</p>
          <p>{tr('Head office', 'Trụ sở')}: {COMPANY.address}</p>
          <p>{tr('Business registration no.', 'GCN ĐKDN số')}: {COMPANY.erc} · {tr('issued', 'cấp')}: {COMPANY.ercIssued}</p>
          <p>{tr('Email', 'Email')}: <a href={`mailto:${COMPANY.email}`} className="transition-colors hover:text-accent-foreground">{COMPANY.email}</a> · {tr('Phone', 'Điện thoại')}: {COMPANY.phone}</p>
          <p className="text-ink-4">{tr('E-commerce platform registration with the Ministry of Industry and Trade: in progress.', 'Đăng ký sàn giao dịch TMĐT với Bộ Công Thương: đang thực hiện.')}</p>
        </div>

        <div className="mt-6 flex flex-col items-center justify-between gap-2 pt-5 text-xs text-body sm:flex-row">
          <p className="flex flex-wrap items-center justify-center gap-1.5 sm:justify-start">
            <span>© {new Date().getFullYear()} eno.vn — {tr('All rights reserved.', 'Mọi quyền được bảo lưu.')}</span>
            <span aria-hidden="true">·</span>
            <span>{tr('Made in Saigon', 'Làm tại Sài Gòn')} <span aria-hidden="true">❤️</span></span>
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
            <a href={`${MARKETPLACE_URL}/terms`} className="transition-colors hover:text-accent-foreground">{tr('Terms', 'Điều khoản')}</a>
            <a href={`${MARKETPLACE_URL}/privacy`} className="transition-colors hover:text-accent-foreground">{tr('Privacy', 'Quyền riêng tư')}</a>
            <a href={`${MARKETPLACE_URL}/regulations`} className="transition-colors hover:text-accent-foreground">{tr('Regulations', 'Quy chế')}</a>
          </div>
        </div>
      </div>
    </footer>
  )
}
