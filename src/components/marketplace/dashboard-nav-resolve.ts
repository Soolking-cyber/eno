// PURE resolution of the dashboard nav config (dashboard-nav.tsx, data-only) into concrete
// rail rows: role gating, per-seller storefront URL, label localization, live badge binding.
// Extracted from account-panel.tsx so the gating branches are unit-testable without React or
// the authed e2e harness — keep this module free of React imports (IconComponent below is a
// type-only pass-through). account-panel.tsx is the renderer; any future surface (native
// shell, forum mirror) can call resolveNavGroups() with its own ctx.

import { IS_SERVICES } from '@/lib/edition'
import type { NavGroup, NavItem, NavRole } from './dashboard-nav'

/** A concrete, renderable rail row (account-panel's RailItem shape). */
export type ResolvedNavItem = {
  href: string
  label: string
  icon: NavItem['icon']
  exact?: boolean
  external?: boolean
  badge?: number
}

export type ResolvedNavGroup = { caption: string; items: ResolvedNavItem[] }

export type NavResolveCtx = {
  /** dash.tier === 'business' */
  isBusiness: boolean
  /** SERVER-computed (isAdminEmail → /api/dashboard payload) — the client never decides it. */
  isAdmin: boolean
  /** Does the viewer hold any e-Visa case? Gates the `requiresVisa` row (chat-only apply flow). */
  hasVisa: boolean
  /** The signed-in user's seller profile, when one exists (drives 'seller' role + storefront). */
  seller: { id: string; handle: string | null } | null
  /** Live badge counters, bound to config `badge` keys. */
  counters: { unread: number; saved: number }
  /**
   * Localizer for {en, vi} label pairs — pass the app's tr(). Only called when `vi` exists;
   * vi-less labels (admin chrome, EN-only by convention) render `en` verbatim.
   */
  label: (en: string, vi: string) => string
}

/** Visibility is ROLE-gated, never path-switched (admins see Admin appended on EVERY page). */
const roleOk = (ctx: NavResolveCtx, role: NavRole = 'all') =>
  role === 'all' || (role === 'business' ? ctx.isBusiness : role === 'seller' ? !!ctx.seller : ctx.isAdmin)

// Config item → concrete rail row: resolve the storefront href for THIS seller, localize the
// label (vi absent → EN verbatim, the admin-chrome convention), bind the live badge counters.
const toRail = (it: NavItem, ctx: NavResolveCtx): ResolvedNavItem | null => {
  let href = it.href
  if (it.dynamic === 'storefront') {
    if (!ctx.seller) return null // role-gated already; belt-and-braces so the placeholder href never renders
    href = ctx.seller.handle ? `/${ctx.seller.handle}` : `/sellers/${ctx.seller.id}`
  }
  return {
    href,
    label: it.vi ? ctx.label(it.en, it.vi) : it.en,
    icon: it.icon,
    exact: it.exact,
    external: it.external,
    badge: it.badge === 'unread' ? ctx.counters.unread : it.badge === 'saved' ? ctx.counters.saved : undefined,
  }
}

/** Resolve the nav config into renderable groups for the given viewer context. */
export function resolveNavGroups(nav: NavGroup[], ctx: NavResolveCtx): ResolvedNavGroup[] {
  return nav
    .filter((g) => roleOk(ctx, g.role))
    .map((g) => ({
      // Caption tolerates vi-less groups (Admin renders its EN caption verbatim).
      caption: g.vi ? ctx.label(g.en, g.vi) : g.en,
      items: g.items
        // ⚠️ `servicesOnly` IS SEPARATE FROM `requiresVisa`, and that is why all THREE rows go.
        // requiresVisa only ever gated "My e-Visa" — "My Trips" had NO gate at all, and the admin
        // "Visas" row was missed by the first sweep entirely. An explicit edition predicate is
        // checkable by reading the item; inferring it from requiresVisa was not.
        .filter((it) => roleOk(ctx, it.role) && (!it.requiresVisa || ctx.hasVisa) && (!it.servicesOnly || IS_SERVICES))
        .flatMap((it) => { const r = toRail(it, ctx); return r ? [r] : [] }),
    }))
}
