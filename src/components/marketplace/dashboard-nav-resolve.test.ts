// Unit tests for the pure nav resolver (dashboard-nav-resolve.ts): role gating across the
// viewer tiers, storefront URL substitution, label localization fallback, badge binding.
// No React — the icon is an opaque pass-through here.

import { describe, expect, it } from 'vitest'
import type { NavGroup, NavItem } from './dashboard-nav'
import { DASHBOARD_NAV } from './dashboard-nav'
import { resolveNavGroups, type NavResolveCtx } from './dashboard-nav-resolve'

const icon = (() => null) as unknown as NavItem['icon']

/** vi wins when present — a deterministic stand-in for the app's tr(). */
const label = (_en: string, vi: string) => vi

const ctx = (over: Partial<NavResolveCtx> = {}): NavResolveCtx => ({
  isBusiness: false,
  isAdmin: false,
  hasVisa: false,
  seller: null,
  counters: { unread: 0, saved: 0 },
  label,
  ...over,
})

const FIXTURE: NavGroup[] = [
  {
    en: 'Marketplace', vi: 'Chợ', role: 'all',
    items: [
      { href: '/dashboard', en: 'Home', vi: 'Trang chủ', icon, exact: true },
      { href: '/messages', en: 'Messages', vi: 'Tin nhắn', icon, badge: 'unread' },
      { href: '/saved', en: 'Saved', vi: 'Đã lưu', icon, badge: 'saved' },
      { href: '/dashboard/visa', en: 'My e-Visa', vi: 'E-Visa của tôi', icon, requiresVisa: true },
      { href: '/dashboard/bulk', en: 'Bulk upload', vi: 'Tải hàng loạt', icon, role: 'business' },
      { href: '/sellers', en: 'View storefront', vi: 'Xem gian hàng', icon, external: true, role: 'seller', dynamic: 'storefront' },
    ],
  },
  // vi-less group + items (the admin-chrome EN-only convention).
  { en: 'Admin', role: 'admin', items: [{ href: '/admin', en: 'Reports', icon, exact: true }] },
]

describe('resolveNavGroups requiresVisa gating', () => {
  const visaRow = (over = {}) =>
    resolveNavGroups(FIXTURE, ctx(over)).flatMap((g) => g.items).find((it) => it.href === '/dashboard/visa')

  it('HIDES the e-Visa row from a viewer with no case', () => {
    expect(visaRow({ hasVisa: false })).toBeUndefined()
  })
  it('SHOWS it once the viewer has a case', () => {
    expect(visaRow({ hasVisa: true })?.href).toBe('/dashboard/visa')
  })
  it('does not gate ordinary rows on hasVisa', () => {
    // Saved has no requiresVisa, so it is present regardless — proves the filter is scoped.
    const saved = resolveNavGroups(FIXTURE, ctx({ hasVisa: false })).flatMap((g) => g.items).find((it) => it.href === '/saved')
    expect(saved?.href).toBe('/saved')
  })
})

describe('resolveNavGroups role gating', () => {
  it('individual (no seller, no business, no admin): only all-role rows, no Admin group', () => {
    const groups = resolveNavGroups(FIXTURE, ctx())
    expect(groups.map((g) => g.caption)).toEqual(['Chợ'])
    expect(groups[0].items.map((i) => i.href)).toEqual(['/dashboard', '/messages', '/saved'])
  })

  it('business tier: business rows appear, seller/admin rows still hidden', () => {
    const groups = resolveNavGroups(FIXTURE, ctx({ isBusiness: true }))
    expect(groups[0].items.map((i) => i.href)).toContain('/dashboard/bulk')
    expect(groups[0].items.some((i) => i.external)).toBe(false)
    expect(groups.some((g) => g.caption === 'Admin')).toBe(false)
  })

  it('seller: storefront row appears with the per-seller URL', () => {
    const groups = resolveNavGroups(FIXTURE, ctx({ seller: { id: 's1', handle: 'shop' } }))
    const storefront = groups[0].items.find((i) => i.external)
    expect(storefront?.href).toBe('/shop')
  })

  it('seller without a handle falls back to /sellers/{id}', () => {
    const groups = resolveNavGroups(FIXTURE, ctx({ seller: { id: 's1', handle: null } }))
    expect(groups[0].items.find((i) => i.external)?.href).toBe('/sellers/s1')
  })

  it('admin: Admin group appended, EN caption + labels verbatim (never localized)', () => {
    const groups = resolveNavGroups(FIXTURE, ctx({ isAdmin: true }))
    const admin = groups.find((g) => g.caption === 'Admin')
    expect(admin).toBeDefined()
    expect(admin?.items).toEqual([{ href: '/admin', label: 'Reports', icon, exact: true, external: undefined, badge: undefined }])
  })
})

describe('resolveNavGroups binding', () => {
  it('localizes labels through the passed label fn when vi exists', () => {
    const groups = resolveNavGroups(FIXTURE, ctx())
    expect(groups[0].items.map((i) => i.label)).toEqual(['Trang chủ', 'Tin nhắn', 'Đã lưu'])
  })

  it('binds live counters to unread/saved badge keys and leaves others undefined', () => {
    const groups = resolveNavGroups(FIXTURE, ctx({ counters: { unread: 7, saved: 3 } }))
    const byHref = Object.fromEntries(groups[0].items.map((i) => [i.href, i.badge]))
    expect(byHref).toEqual({ '/dashboard': undefined, '/messages': 7, '/saved': 3 })
  })

  it('belt-and-braces: a dynamic storefront row without a seller never renders its placeholder href', () => {
    const leaky: NavGroup[] = [{ en: 'G', role: 'all', items: [{ href: '/sellers', en: 'Storefront', icon, dynamic: 'storefront' }] }]
    expect(resolveNavGroups(leaky, ctx())[0].items).toEqual([])
  })
})

describe('real DASHBOARD_NAV config', () => {
  it('non-admin never sees the Admin group; admin sees it on every resolve', () => {
    expect(resolveNavGroups(DASHBOARD_NAV, ctx()).some((g) => g.caption === 'Admin')).toBe(false)
    expect(resolveNavGroups(DASHBOARD_NAV, ctx({ isAdmin: true })).some((g) => g.caption === 'Admin')).toBe(true)
  })
})
