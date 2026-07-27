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
  Store, ExternalLink, MessageSquareText, Heart, Scale, Upload, Code2,
  CircleHelp, FileCheck2, Route,
  Flag, ShieldAlert, ClipboardList, Tags, Star, Stamp, BadgeCheck,
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
  /** Show ONLY to a viewer who holds an e-Visa case (dash.hasVisa). The apply flow is
   *  chat-only, so this row is meaningless to everyone else. */
  requiresVisa?: boolean
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
    // Headerless ON PURPOSE (owner 2026-07-23: "remove marketplace text on top when
    // dashboard opened") — the first group's rows need no banner above them; the rail
    // renderer's `{caption && …}` skips an empty one. Community/Admin keep theirs, so
    // the section BREAKS below still read.
    en: '',
    vi: '',
    role: 'all',
    items: [
      // The "Home" (/dashboard) row was removed (owner 2026-07-23: "useless"). The sections
      // below ARE the dashboard, so a link back to a bare overview earned its place in the
      // rail only by habit. /dashboard itself still resolves — nothing routes THROUGH this
      // link — so an existing bookmark or a redirect target is unaffected.
      { href: '/dashboard/listings', ...tr('My listings', 'Tin của tôi'), icon: Store },
      { href: '/messages', ...tr('Messages', 'Tin nhắn'), icon: MessageSquareText, badge: 'unread' },
      { href: '/saved', ...tr('Saved', 'Đã lưu'), icon: Heart, badge: 'saved' },
      // Label matches the page's own name ("Availability review" / "còn hàng").
      { href: '/dashboard/disputes', ...tr('Disputes', 'Khiếu nại'), icon: Scale },
      { href: '/dashboard/bulk', ...tr('Bulk upload', 'Tải hàng loạt'), icon: Upload, role: 'business' },
      { href: '/dashboard/dev', ...tr('Developers', 'Lập trình'), icon: Code2, role: 'business' },
      // Public storefront of the signed-in seller — href is computed by the renderer.
      { href: '/sellers', ...tr('View storefront', 'Xem gian hàng'), icon: ExternalLink, external: true, role: 'seller', dynamic: 'storefront' },
    ],
  },
  {
    ...tr('Community', 'Cộng đồng'),
    role: 'all',
    // Community DATA sections are dashboard pages (owner 2026-07-18) — itinerary/visa state
    // renders in <main> like every marketplace section. The rail itself never leaves for
    // eno.forum: each section carries its own explicit "Open the planner/assistant" handoff
    // CTA (goToForum) inside its content area.
    //
    // "Forum activity" (a posts/comments/saved tab set) was REMOVED 2026-07-21 (owner:
    // "remove forum activity page in dashboard and have only help center"). The Help Center
    // is the one community surface now — it reads the same Forum* tables, and a member's
    // votes and replies there are the same rows eno.forum renders. Help is a real SECTION
    // here rather than an account-footer row, which also closes the old gap where the file
    // that calls itself the single source of truth for the rail had no Help entry at all.
    items: [
      { href: '/dashboard/help', ...tr('Help center', 'Trung tâm trợ giúp'), icon: CircleHelp },
      // ✅ UN-SHELVED (owner, 2026-07-25): the itinerary builder is now a promoted eno.vn
      // service — a landing page at /itinerary, stops persisted per day, a map, and a
      // "My Trips" detail page. This row is back BY DECISION, which is exactly what the
      // note below asked for. It was SHELVED 2026-07-23 ("for now don't delete, later we
      // will make use of it"); "later" is now.
      // (History, kept because it is the reason this comment is so emphatic: shelved in
      // c8090df0, then accidentally reverted 2 minutes later by 0ef45423 committing a stale
      // working-tree copy of this file. So the rule stands for the future — if this row
      // changes state and no owner decision says so, that is the accident, not a decision.)
      { href: '/dashboard/trips', ...tr('My Trips', 'Chuyến đi của tôi'), icon: Route },
      // KEPT, RELABELLED (owner 2026-07-22: "only 1 way should exist through the chat").
      // The section is no longer a place to APPLY — the wizard behind this row is deleted
      // and the application is filled in the chat thread — so the row names what it still
      // leads to: the applicant's own cases, their status, and the way back into the
      // thread each one lives in. "Vietnam e-Visa" read as "apply here"; this does not.
      { href: '/dashboard/visa', ...tr('My e-Visa', 'E-Visa của tôi'), icon: FileCheck2, requiresVisa: true },
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
      { href: '/admin/business-verification', en: 'Business verification', icon: BadgeCheck },
    ],
  },
]
