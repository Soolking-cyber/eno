import { cn } from '@/lib/utils'

/**
 * THE SORT TAB'S CLASS — ONE BUILDER FOR EVERY SORT STRIP (E-SORT, 2026-09-29). The explorer's strip
 * (explorer-toolbar.tsx) and SellerListings' (the /c/<category> landings and storefronts) each carried
 * a copy, and the copies drifted: the second one also styled plain <Link>s, which lack TabsTrigger's
 * `whitespace-nowrap`, so "Most contacted" broke onto two lines at 390px (62px tall against 42). Both
 * strips now render `variant="line"` lists whose tabs carry exactly this string.
 * ⚠️ `whitespace-nowrap` restates the TabsTrigger base on purpose: a caller that renders a non-trigger
 * with this class (a link, a skeleton) must not wrap either.
 * ⚠️ ITS OWN MODULE, NOT AN EXPORT OF explorer-toolbar.tsx: SellerListings ships on the /c/* and
 * storefront pages, and the app declares no `sideEffects: false`, so importing a string builder out
 * of the toolbar would carry its Tooltip and Toggle into those chunks for nothing.
 */
// rounded-none is MANDATORY: these tabs are underlined with border-b-2, and the base
// rounded-lg would curve that underline into a lozenge. gap-1 / flex / font-semibold /
// transition-colors all override their base counterparts through cn()'s tailwind-merge.
//
// The leading block NEUTRALISES ui/tabs' TabsTrigger base, which is styled for a pill/line
// trigger, not for this strip. Every neutraliser is deliberately written with the SAME
// modifier as the base class it kills, so cn()'s tailwind-merge DELETES the base class
// outright — it never leaves two live rules to be settled by stylesheet order (which is not
// authoring order, and is how invisible rules ship). Line by line:
//   h-auto      kills h-[calc(100%-1px)]  ·  flex-none  kills flex-1 (tabs are content-width)
//   border-0    kills the base `border` — a 1px box on all four sides that, once
//               border-transparent is merged away by border-brand, would paint a full brand
//               OUTLINE around the active tab instead of an underline. It must come BEFORE
//               border-b-2 in this string: tailwind-merge walks right-to-left, so a later
//               border-0 would swallow the earlier border-b-2 and delete the underline.
//               Verified in the built css that the surviving pair resolves the right way —
//               `grep -o '\.border-0{[^}]*}\|\.border-b-2{[^}]*}' .next/static/chunks/*.css`
//               shows .border-0 emitted at byte 36616 and .border-b-2 at 37112, i.e. the
//               bottom-width longhand lands AFTER the shorthand and wins. Do not reorder.
//   outline-none  restores ui/button's behaviour: it sets --tw-outline-style:none, which is
//               the var the base's focus-visible:outline-1 reads, so the ring stays the only
//               focus affordance (identical to before). The ring itself is already the same.
//   after:hidden  ⚠️ THE BIG ONE. This Base UI (1.6) puts data-ACTIVE on the selected tab, not
//               data-selected: TabsTabState's key is `active` and getStateAttributesProps does
//               `data-${key}`. So TabsTrigger's dormant-looking
//               group-data-[variant=line]/tabs-list:data-active:after:opacity-100 DOES fire and
//               paints a second, foreground-coloured 2px bar at bottom-[-5px] under our brand
//               underline. display:none removes the pseudo-element regardless of that opacity.
//   duration-100 + active:scale-[0.97]  keep ui/button's press feel (the base tabs trigger has
//               neither; transition-colors leaves the scale instant, exactly as it was).
//   data-active:* / dark:data-active:*  same-modifier overrides of the base's active-tab FILL
//               and TEXT colour (bg-background / text-foreground / dark bg-input/30), which for
//               the same data-active reason are live. They no-op on the three unselected tabs.
//   dark:text-body  kills the base's dark:text-muted-foreground, which would otherwise beat our
//               unprefixed text-body in dark mode (.dark .x is 0,2,0 vs 0,1,0).
export function sortTabClass(selected: boolean): string {
  return cn(
    'h-auto flex-none border-0 outline-none after:hidden duration-100 active:scale-[0.97]',
    'data-active:bg-transparent data-active:text-accent-foreground dark:data-active:bg-transparent dark:data-active:text-accent-foreground dark:text-body',
    // Padding is the ORIGINAL px-3 — narrowing it was not the fix. Overflowing horizontally is
    // fine and expected (OS text scaling makes it unavoidable anyway); the strip just has to
    // scroll like a rail instead of dragging like a loose object. See the list for that.
    //
    // snap-start pairs with the list's snap-mandatory so a scrolled strip can only come to rest
    // on a tab boundary, never halfway through a label ("…vance").
    //
    // ⚠️ The -1px that overlaps the root's bottom border lives on the LIST, not here. On the tab
    // it made the tab's border box (42px) exactly 1px taller than its margin box (41px), which
    // sized the scroller to 41 and left scrollHeight at 42 — a permanent 1px VERTICAL overflow.
    // overflow-x-auto forces overflow-y to compute to auto, so that 1px turned the strip into a
    // two-axis scroller that swallowed vertical drags. Same pixel, moved one level up, no overflow.
    'flex shrink-0 snap-start items-center gap-1 whitespace-nowrap rounded-none border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors cursor-pointer',
    selected
      // hover:* on the selected branch is not new paint: it kills the base's
      // hover:text-foreground so the active tab keeps its colour on hover, as it always did.
      //
      // ⚠️ dark:data-active:border-brand is LOAD-BEARING, and it is not decoration. TabsTrigger's
      // base carries a DARK border-COLOUR rule on the active tab (`dark:data-active:border-input`,
      // plus a line-variant `…:border-transparent`). Unprefixed `border-brand` is (0,1,0); those
      // are (0,3,0)+. tailwind-merge only collapses classes sharing a modifier, so a bare
      // `border-brand` does NOT displace them — it just loses. The result is a 2px underline that
      // is brand-blue in light mode and GREY (or invisible) in dark, on the active tab only.
      // Restating the class with the base's own modifier makes cn() DELETE the base rule instead
      // of racing it. Two independent reviewers (Fable, GPT-5.6) found this; the build, tsc,
      // design-lint and the e2e suite all passed straight over it.
      //
      // The group-data twin is killed for the same reason, and it is LIVE: both strips render
      // `variant="line"` lists, so the base's `dark:group-data-[variant=line]/tabs-list:data-active:
      // border-transparent` matches and would turn the active underline transparent in dark mode.
      // Restating it with the base's exact modifier makes tailwind-merge remove it outright.
      ? 'border-brand dark:border-brand dark:data-active:border-brand dark:group-data-[variant=line]/tabs-list:data-active:border-brand text-accent-foreground hover:text-accent-foreground dark:hover:text-accent-foreground'
      : 'border-transparent text-body hover:text-foreground',
  )
}
