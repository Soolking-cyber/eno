// THE single navigation configuration for the eno.vn dashboard rail (owner spec, 2026-07-18):
// desktop AND mobile, users AND sellers AND admins all render from THIS module. The left rail
// (account-panel.tsx) is the only consumer today, but any future surface (native shell, forum
// mirror) must read these groups rather than re-declaring routes — one source of truth for
// hrefs, labels, icons, badges, and role visibility. DATA + TYPES ONLY: no UI components here
// (icon DATA only — the components that render these live in the rail and the account hub)
// contract as the lucide imports beside it, not rail UI).
//
// Roles: 'all' renders for everyone signed-in; 'business' requires dash.tier === 'business';
// 'seller' requires a seller profile (dash.seller); 'admin' requires dash.isAdmin (server-
// computed from ADMIN_EMAILS via /api/dashboard — the client never decides admin-ness itself).
// The Admin group is ROLE-gated, not path-switched: it shows for admins on EVERY page.
// Admin labels are EN-only by repo convention (admin chrome is never localized), hence vi
// is optional — a renderer must fall back to `en` when `vi` is undefined.

import type { ComponentType, SVGProps } from 'react'
import { IS_SERVICES } from '@/lib/edition'
import { SERVICES_NAV_ADMIN_QUEUE, SERVICES_NAV_PAYMENTS, SERVICES_NAV_SERVICES } from '@/lib/edition-services-copy'
// Glyph choices follow docs/icon-language.md §3 (soft-cornered object metaphors, one
// family). Developers = Plug since 2026-08-07 (R3 critic: Braces was the rail's one
// abstract washless glyph; Plug is a concrete noun with a washable body) — before that `</>`
// chevrons read as debug chrome at the platform weight).
//
// ⚠️ GLYPH = MEANING IN AN ICON-ONLY RAIL (R2 critic ruling, 2026-08-06). The collapsed
// 72px rail shows no labels, so two rows may never share a glyph, and a rail glyph may not
// mean something else elsewhere on the same screen. Two R1 breaches, both fixed here:
//  - View storefront was Eye — but Eye IS the view-count glyph in the listing meta row on
//    the very screen the rail opens to (/dashboard/listings). Now SquareArrowOutUpRight:
//    the outbound mark the critic asked for ("swap to an outbound/storefront-preview
//    glyph"), which still reads right: the row leaves the dashboard for the PUBLIC page
//    (it is a client transition now, not a document load) and matches the outbound family
//    dashboard-listing-row already
//    uses for "view live". One quiet outbound row is not the R0 debug-cluster problem —
//    that was `</>` + box-arrow + red logout stacked together.
//  - Admin Disputes was Scale — identical to the seller "Khiếu nại" Scale four slots above
//    it in the same collapsed rail. Now Gavel (the critic's own suggestion), which is
//    already this app's dispute-RESOLUTION mark (protections-row, why-eno): Scale = my
//    open cases, Gavel = ruling on everyone's.
//  - Messages was MessageSquareText — but the SAME destination is plain MessageSquare in
//    the bottom nav (mobile-nav.tsx, the platform anchor whose bubble icon-tokens' §5
//    comment names as THE nav glyph), so one concept wore two glyphs across the two nav
//    surfaces (R3 critic). The rail/hub now adopt the nav's plain bubble; the bubble-with-
//    text-lines variant stays the LEADS-count meta mark (dashboard-listing-row: "a message
//    with words in it" = an inquiry) — one glyph per concept in both directions. The
//    selected-state fill is unaffected either way: it is drawn from the glyph's own
//    silhouette, not from a per-key region (see NavIcon below).
import {
  Store, SquareArrowOutUpRight, MessageSquare, Heart, Scale, Wallet,
  CircleHelp, Route,
  Flag, ClipboardList, Star, Stamp, Gavel, Users,
  type IconComponent, ShieldCheck } from '@/components/ui/icons'
import { cn } from '@/lib/utils'

export type NavRole = 'all' | 'business' | 'seller' | 'admin'

/** The minimal contract every rail/hub renderer actually uses. Lucide glyphs satisfy it,
 *  and so does the one first-party mark (the eno seal adapter below) — widened from
 *  `IconComponent` so a trust moment is not forced to wear a lucide glyph (§0b).
 *
 *  ⚠️ THIS IS DELIBERATELY THE SAME SHAPE AS category-icons' `CategoryGlyph`, because the
 *  rail now renders its rows THROUGH `<CategoryGlyphArt selected>` (owner, 2026-08-07:
 *  "use icons filling only when selected, not as default — fix everywhere in dashboard").
 *  A narrower hand-written prop bag (the old `{ className?; strokeWidth?: number }`) is not
 *  assignable to that component's `Icon` prop, and widening it here is what lets ONE fill
 *  rule cover the rail instead of a second, rail-local mechanism. */
export type NavIcon = IconComponent | ComponentType<SVGProps<SVGSVGElement>>

// ⚠️ BUSINESS VERIFICATION USES SOLAR'S `shield-check`, NOT THE eno SEAL (owner, 2026-08-12:
// "admin dashboard business verification still uses old icon make it solar v2").
//
// It used to mount EnoSeal through an adapter, on the reasoning that a first-party verification
// queue is a trust moment and "when in doubt, it is the seal". The seal is the BRAND MARK — it
// belongs on the logo, the watermark and the favicon — and putting it in a nav rail made one row
// wear the company's signature while its neighbours wore stock glyphs. Solar already draws a
// shield with a tick, which is what this row means, and it inherits the app-wide outline/bold
// pressed grammar for free; the adapter existed only to force the seal to degrade under that
// grammar, so it goes with it.

/**
 * ⚠️ THE SERVICES ROWS ARE CONDITIONALLY *CONSTRUCTED*, NOT JUST FILTERED, AND THEIR COPY LIVES IN
 * AN ALIASED MODULE. `servicesOnly` still exists and still gates them at render — that is the
 * correctness guarantee — but a runtime filter leaves the labels in the bundle as ARRAY DATA, where
 * no minifier can reach them.
 *
 * ⚠️ AND NEITHER DOES THE CONDITIONAL CONSTRUCTION, WHICH IS WHAT THIS COMMENT USED TO CLAIM. It
 * said `IS_SERVICES` is a build-time constant so "the spread collapses to []". Measured on a clean
 * marketplace build 2026-08-01, three years of good intentions later: "My e-Visa" was in 3 client
 * chunks and "E-Visa của tôi" in 2, with the row correctly hidden the whole time. Turbopack
 * substitutes the env var INSIDE src/lib/edition.ts; the resulting boolean does NOT propagate across
 * the module boundary to a file that imports the flag, so this ternary is an ordinary runtime branch
 * over string data the bundler keeps. See the correction at the top of src/lib/edition.ts.
 *
 * So the labels and hrefs now come from `@/lib/edition-services-copy`, which next.config.ts aliases
 * to an empty stub on a marketplace build — the only mechanism that removes vocabulary from the
 * artifact rather than declining to render it. Three layers, each doing a different job: the filter
 * decides visibility, the ternary decides what is in the array, the alias decides what is in the
 * bundle. Keep all three.
 */
export type NavItem = {
  /** Internal route. For `dynamic` items this is only a placeholder — the renderer
   *  substitutes the real per-user URL (see `dynamic`). Every row is core-dashboard
   *  navigation and stays INTERNAL: explicit eno.forum handoffs live inside sections
   *  (their own "Open the forum/planner/assistant" CTAs), never on this rail. */
  href: string
  /** English label — the fallback when `vi` is absent (admin chrome is EN-only). */
  en: string
  vi?: string
  icon: NavIcon
  /** Active only on an exact pathname match (for hub routes whose children are also items). */
  exact?: boolean
  /** Render as a plain <a> (full navigation), not a Next <Link>. */
  external?: boolean
  /**
   * Services edition only (eno.forum). eno.vn is a licensed sàn TMĐT and may not surface visa or
   * itinerary services at all.
   *
   * ⚠️ SEPARATE FROM `requiresVisa`, deliberately. That flag asks "does this viewer hold a case?"
   * and only ever gated "My e-Visa" — "My Trips" had no gate whatsoever, and the admin "Visas" row
   * was missed by the first sweep. Reusing requiresVisa would have hidden the row for the right
   * reason on the wrong axis, and would still have shown it to any eno.vn user who had a case.
   */
  servicesOnly?: boolean
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
  /* ⛔ THE PER-ROW `wash` ALLOWLIST IS GONE (owner, 2026-08-07: "help icon, storefront
   * icons on select should be filled"). It named which glyph regions had been verified by
   * zoomed screenshot — 'body' = first path, 'twin' = Scale's two pans — and every row NOT
   * on the list stayed line-only when active. Help center (CircleHelp) and View storefront
   * (SquareArrowOutUpRight) were both off it, which is precisely the pair the owner
   * reported: you select the row, and nothing fills.
   *
   * The allowlist existed because a per-region CSS selector can only be trusted for a glyph
   * someone eyeballed — lucide's child ORDER is arbitrary, so `path:first-of-type` is a
   * guess. The rail no longer makes that guess: `<CategoryGlyphArt selected>` draws the
   * whole glyph twice (tinted body under untouched ink line), so the fill comes from the
   * silhouette itself and is identical on every row by construction. Nothing to verify,
   * nothing to allowlist, and one rule shared with the category tiles.
   *
   * The one row that still degrades to line-only is Business verification, and that is now
   * a property of the GLYPH itself, not of a list kept over here. */
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
      { href: '/messages', ...tr('Messages', 'Tin nhắn'), icon: MessageSquare, badge: 'unread' },
      { href: '/saved', ...tr('Saved', 'Đã lưu'), icon: Heart, badge: 'saved' },
      // Label matches the page's own name ("Availability review" / "còn hàng").
      /**
       * ⛔ THE ROW THAT DID NOT EXIST, AND ITS ABSENCE WAS THE WHOLE PROBLEM. Owner, 2026-08-31:
       * "there is no place to verify kyc now … in ui". Every piece of stage 1 was built —
       * the capture component, the submit service, the admin decision logic — and nothing in the
       * app linked to any of it. `/dashboard/account/verify` was reachable only from a publish
       * refusal, and the business panel was buried inside Settings.
       * ⚠️ BOTH EDITIONS, NO `servicesOnly`. Identity verification is the LICENSED marketplace's
       * obligation before it is anything else, so unlike the payout and wallet rows below it this
       * one is not gated — the sequencing flag is what differs between editions, not the page.
       * ⚠️ NOT `role: 'seller'`. A person verifies themselves BEFORE they have a storefront; hiding
       * the row until they are already selling would reproduce the ordering bug it exists to fix.
       */
      { href: '/dashboard/verification', ...tr('Verification', 'Xác minh'), icon: ShieldCheck },
      { href: '/dashboard/disputes', ...tr('Disputes', 'Khiếu nại'), icon: Scale },
      /**
       * ⛔ SERVICES EDITION ONLY, AND GATED THE SAME THREE WAYS AS THE VISA ROWS BELOW: the
       * `IS_SERVICES` ternary decides what is in the array, `servicesOnly` decides visibility at
       * render, and the copy comes from the aliased module so the words leave the marketplace
       * artifact entirely. eno.vn is a licensed sàn TMĐT: it has no payments surface, and both
       * pages behind these rows are `page.svc.tsx` and are not compiled into that build.
       * ⚠️ THESE PAGES EXISTED FOR DAYS WITH NOTHING LINKING TO THEM. `/dashboard/payout` was
       * reachable only by typing the URL — worth remembering when adding the next section.
       */
      // ⚠️ ONE Payments ROW — wallet + payout merged into /dashboard/payments (tabbed). Same
      // three-layer gating as before: IS_SERVICES ternary, servicesOnly flag, aliased copy.
      ...(IS_SERVICES ? [{ ...SERVICES_NAV_PAYMENTS, icon: Wallet, servicesOnly: true, role: 'seller' as const }] : []),
      // Public storefront of the signed-in seller — href is computed by the renderer.
      // ⚠️ NOT `external` — it renders as a <Link>, like every other row. The storefront
      // href resolves to `/{handle}` (or `/sellers/{id}`), which is an ordinary route in THIS
      // app, so `external: true` bought nothing and cost a full document load: clicking it
      // white-flashed and jumped the page while every sibling row transitioned client-side
      // (owner, 2026-08-07: "make sure all pages in dashboard behave similarly and have smooth
      // transition without jumping"). `external` stays in the type for a genuinely off-app
      // destination — there is none in the rail today.
      { href: '/sellers', ...tr('View storefront', 'Xem gian hàng'), icon: SquareArrowOutUpRight, role: 'seller', dynamic: 'storefront' },
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
      // ⚠️ SERVICES EDITION ONLY — AND THE `IS_SERVICES` GATE BELOW IS THE POINT, NOT AN
      // AFTERTHOUGHT. This comment used to read "✅ UN-SHELVED (owner, 2026-07-25): the itinerary
      // builder is now a promoted eno.vn service", which was true when written and REVERSED on
      // 2026-07-31: itinerary, visa and PayPal moved to eno.forum, and eno.vn — the licensed sàn
      // TMĐT — may not surface, link or mention them. So this row is promoted on eno.forum and
      // ABSENT from eno.vn; the gate is what makes that true, and SERVICES_NAV_TRIPS additionally
      // resolves to an empty stub on a marketplace build so the label never reaches the artifact.
      // Do not "promote" this row out of the gate.
      //
      // (Shelving history, kept because it is why the note below is so emphatic: SHELVED
      // 2026-07-23 "for now don't delete, later we will make use of it", then un-shelved 07-25,
      // then edition-gated 07-31.)
      // (History, kept because it is the reason this comment is so emphatic: shelved in
      // c8090df0, then accidentally reverted 2 minutes later by 0ef45423 committing a stale
      // working-tree copy of this file. So the rule stands for the future — if this row
      // changes state and no owner decision says so, that is the accident, not a decision.)
      // ⚠️ ONE Services ROW — Trips + e-Visa merged into /dashboard/services (tabbed). e-Visa is a
      // tab now rather than its own `requiresVisa`-gated row: a forum seller lands on Services and
      // finds both, with the e-Visa tab showing its own empty state when they hold no case.
      ...(IS_SERVICES ? [{ ...SERVICES_NAV_SERVICES, icon: Route, servicesOnly: true }] : []),
    ],
  },
  {
    // EN-only (admin chrome is never localized) — no vi on the caption or any item.
    en: 'Admin',
    role: 'admin',
    items: [
      // ⚠️ Admin rows carry the SAME location treatment as every other rail row (R2 critic,
      // piece 16: the signature "more fill, same line" must not vanish on the console's most
      // repeated icon moment). They need no per-row opt-in any more — the selected fill is
      // the renderer's one rule, applied to whatever glyph the row carries.
      // ⚠️ CONSOLE v2 (owner, 2026-09-05: "combine, fewer pages, easy to manage"). Seven sections,
      // each a page with tabs, in the order an operator's day runs: what needs attention, who the
      // people are, who is verified, what was reported, what is on sale, the service desks, and
      // what the numbers say. The old eleven rows redirect into these.
      { href: '/admin', en: 'Overview', icon: Flag, exact: true },
      { href: '/admin/users', en: 'Users', icon: Users },
      { href: '/admin/verification', en: 'Verification', icon: ShieldCheck },
      { href: '/admin/moderation', en: 'Moderation', icon: Gavel },
      { href: '/admin/catalogue', en: 'Catalogue', icon: ClipboardList },
      ...(IS_SERVICES ? [{ ...SERVICES_NAV_ADMIN_QUEUE, icon: Stamp, servicesOnly: true }] : []),
      { href: '/admin/insights', en: 'Insights', icon: Star },
    ],
  },
]
