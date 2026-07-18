// THE single navigation configuration for the eno.vn dashboard rail (owner spec, 2026-07-18):
// desktop AND mobile, users AND sellers AND admins all render from THIS module. The left rail
// (account-panel.tsx) is the only consumer today, but any future surface (native shell, forum
// mirror) must read these groups rather than re-declaring routes — one source of truth for
// hrefs, labels, icons, badges, and role visibility. DATA + TYPES ONLY: no components here.
//
// Roles: 'all' renders for everyone signed-in; 'business' requires dash.tier === 'business';
// 'seller' requires a seller profile (dash.seller); 'admin' requires dash.isAdmin (server-
// computed from ADMIN_EMAILS via /api/dashboard — the client never decides admin-ness itself).
// The Admin group is ROLE-gated, not path-switched: it shows for admins on EVERY page.
// Admin labels are EN-only by repo convention (admin chrome is never localized), hence vi
// is optional — a renderer must fall back to `en` when `vi` is undefined.

import type { LucideIcon } from 'lucide-react'
import {
  Home, Store, MessageSquareText, Heart, ListChecks, Scale, Upload, Code2,
  UsersRound, Route, FileCheck2,
  Flag, ShieldAlert, ClipboardList, Tags, Star, Stamp,
} from 'lucide-react'

export type NavRole = 'all' | 'business' | 'seller' | 'admin'

export type NavItem = {
  /** Internal route. For `dynamic` items this is only a placeholder — the renderer
   *  substitutes the real per-user URL (see `dynamic`). Every row is core-dashboard
   *  navigation and stays INTERNAL: explicit eno.forum handoffs live inside sections
   *  (their own "Open the forum/planner/assistant" CTAs), never on this rail. */
  href: string
  /** English label — the fallback when `vi` is absent (admin chrome is EN-only). */
  en: string
  vi?: string
  icon: LucideIcon
  /** Active only on an exact pathname match (for hub routes whose children are also items). */
  exact?: boolean
  /** Render as a plain <a> (full navigation), not a Next <Link>. */
  external?: boolean
  /** Live counter to show on this row — the renderer maps it to its real-time source. */
  badge?: 'unread' | 'saved'
  /** Item-level visibility; defaults to the owning group's role. */
  role?: NavRole
  /** Renderer-computed href: 'storefront' → the signed-in seller's public storefront URL
   *  (/{handle} when a handle exists, else /sellers/{id}). */
  dynamic?: 'storefront'
}

export type NavGroup = {
  /** Group caption (EN). Optional `vi`; when absent the caption renders as `en` verbatim
   *  (the Admin group — admin chrome is EN-only by convention). */
  en: string
  vi?: string
  role: NavRole
  items: NavItem[]
}

// Literal-pair builder for {en, vi}. Named `tr` ON PURPOSE: scripts/gen-ui-strings.mjs
// harvests every `tr('English …')` literal under src/ to pre-warm translations for non-EN/VI
// languages, and naming this data builder the same keeps the nav labels inside that harvest
// even though this module never renders (the app's real tr() displays them in the rail).
const tr = (en: string, vi?: string) => ({ en, vi })

/** Group order is part of the spec: Marketplace → Community → Admin. */
export const DASHBOARD_NAV: NavGroup[] = [
  {
    ...tr('Marketplace', 'Chợ eno'),
    role: 'all',
    items: [
      // /dashboard is a real HOME (owner 2026-07-18: one cross-property dashboard on the
      // forum's card design). EXACT match only — every section also lives under /dashboard/,
      // so prefix matching would light this row on /dashboard/listings etc.
      { href: '/dashboard', ...tr('Dashboard', 'Bảng điều khiển'), icon: Home, exact: true },
      { href: '/dashboard/listings', ...tr('My listings', 'Tin của tôi'), icon: Store },
      { href: '/messages', ...tr('Messages', 'Tin nhắn'), icon: MessageSquareText, badge: 'unread' },
      { href: '/saved', ...tr('Saved', 'Đã lưu'), icon: Heart, badge: 'saved' },
      // Label matches the page's own name ("Availability review" / "còn hàng").
      { href: '/dashboard/availability', ...tr('Availability review', 'Xác nhận còn hàng'), icon: ListChecks },
      { href: '/dashboard/disputes', ...tr('Disputes', 'Khiếu nại'), icon: Scale },
      { href: '/dashboard/bulk', ...tr('Bulk upload', 'Tải hàng loạt'), icon: Upload, role: 'business' },
      { href: '/dashboard/dev', ...tr('Developers', 'Lập trình'), icon: Code2, role: 'business' },
      // Public storefront of the signed-in seller — href is computed by the renderer.
      { href: '/sellers', ...tr('View storefront', 'Xem gian hàng'), icon: Store, external: true, role: 'seller', dynamic: 'storefront' },
    ],
  },
  {
    ...tr('Community', 'Cộng đồng'),
    role: 'all',
    // Community DATA sections are dashboard pages (owner 2026-07-18) — the forum's
    // posts/itineraries/visa state renders in <main> like every marketplace section. The rail
    // itself never leaves for eno.forum: each section carries its own explicit "Open the
    // forum/planner/assistant" handoff CTA (goToForum) inside its content area.
    items: [
      { href: '/dashboard/forum', ...tr('Forum activity', 'Hoạt động diễn đàn'), icon: UsersRound },
      { href: '/dashboard/trips', ...tr('Itineraries', 'Lịch trình'), icon: Route },
      { href: '/dashboard/visa', ...tr('Vietnam e-Visa', 'E-Visa Việt Nam'), icon: FileCheck2 },
    ],
  },
  {
    // EN-only (admin chrome is never localized) — no vi on the caption or any item.
    en: 'Admin',
    role: 'admin',
    items: [
      { href: '/admin', en: 'Reports', icon: Flag, exact: true },
      { href: '/admin/disputes', en: 'Disputes', icon: Scale },
      { href: '/admin/enforcement', en: 'Enforcement', icon: ShieldAlert },
      { href: '/admin/listings', en: 'Listings', icon: ClipboardList },
      { href: '/admin/brands', en: 'Brands', icon: Tags },
      { href: '/admin/feedback', en: 'Feedback', icon: Star },
      { href: '/admin/visas', en: 'Visas', icon: Stamp },
    ],
  },
]
