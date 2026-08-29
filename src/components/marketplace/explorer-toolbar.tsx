'use client'

import { ArrowUp, ArrowDown, ArrowUpDown } from '@/components/ui/icons'
import { UiArt } from '@/components/marketplace/ui-art'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

// Presentational toolbar pieces extracted from ListingsExplorer. Pure: they read a value +
// call a passed handler, own no state.
export type SortKey = 'newest' | 'recent' | 'price-low' | 'price-high' | 'popular'
export type ViewMode = 'compact' | 'grid' | 'map' | 'video'
/** The sort strip's TAB space, which is deliberately not SortKey: `price` is ONE tab that carries
 *  a direction (asc/desc), so price-low and price-high both select it. Internal to SortStrip. */
type SortTab = 'newest' | 'recent' | 'popular' | 'price'

/** List / Grid / Map / Video view-mode toggle icons. `showVideo` gates the ▷ tab — with a
 *  catalog that has zero videos the Video view is a guaranteed dead end, so the parent hides
 *  the tab until at least one video listing exists (deep links via ?view=video still work). */
export function ViewToggles({ viewMode, onViewMode, showVideo = true }: { viewMode: ViewMode; onViewMode: (m: ViewMode) => void; showVideo?: boolean }) {
  const { tr } = useLanguage()
  // p-2.5 + 20px icon = a 40px tap target (h-5 is the §4 ladder step for action-row icons —
  // the old h-[18px] was an off-ladder arbitrary size). tap-44 can't be used here — four
  // toggles sit a `gap-1` apart, so 44px hit areas would overlap and steal each other's taps
  // (same failure the video-feed rail hit).
  const tab = (mode: ViewMode) =>
    cn('rounded-lg p-2.5 transition-colors duration-200 cursor-pointer', viewMode === mode ? 'text-accent-foreground' : 'text-body hover:bg-muted')
  // §5 icon-language: the active view toggle is LOCATION state ("you are here" among the four
  // result views), so it takes the soft duotone — the line turns text-accent-foreground (via
  // tab() above) AND the glyph's ONE closed region gains the brand wash. Same treatment as the
  // bottom nav's active tab; NEVER solid fill-brand, which is reserved for user-state (§5.2).
  // Selectors are per-glyph literals (lucide child order varies, and both Tailwind's scanner
  // and the design-lint hook read the source text — no template concatenation):
  //   Rows3       body rect        LayoutGrid  first tile rect
  //   Map         sheet path       Play        the triangle polygon
  // Glyph choices follow §3 (soft-cornered variants): Rows3/LayoutGrid carry the canon's
  // rounded-rect feel where the old List (dotted lines) and Grid (hard lattice) could take no
  // wash at all and read boxy next to the washed family.
  /**
   * ⚠️ `wash` IS GONE WITH THE LUCIDE GLYPHS IT SERVED. It painted a brand-100 fill into one
   * specific child path of each icon to mark the active view — a per-icon selector (`[&>rect]`,
   * `[&>polygon]`) that had to be hand-matched to each glyph's internal structure. The pack's
   * artwork has no such structure to reach into: selected is simply the artwork as drawn, and
   * unselected is the same artwork through `grayscale()`. Owner, 2026-08-29: "gray by default blue
   * when pressed".
   */
  return (
    <>
      <Tooltip content={tr('List view', 'Danh sách')} side="bottom">
        <Button variant="bare" size="none" onClick={() => onViewMode('compact')} aria-label={tr('List view', 'Danh sách')} aria-pressed={viewMode === 'compact'} className={tab('compact')}>
          <UiArt name="list" lit={viewMode === 'compact'} />
        </Button>
      </Tooltip>
      <Tooltip content={tr('Grid view', 'Lưới')} side="bottom">
        <Button variant="bare" size="none" onClick={() => onViewMode('grid')} aria-label={tr('Grid view', 'Lưới')} aria-pressed={viewMode === 'grid'} className={tab('grid')}>
          <UiArt name="grid" lit={viewMode === 'grid'} />
        </Button>
      </Tooltip>
      <Tooltip content={tr('Map view', 'Xem Bản đồ')} side="bottom">
        <Button variant="bare" size="none" onClick={() => onViewMode('map')} aria-label={tr('Map view', 'Bản đồ')} aria-pressed={viewMode === 'map'} className={tab('map')}>
          <UiArt name="map" lit={viewMode === 'map'} />
        </Button>
      </Tooltip>
      {showVideo && (
        <Tooltip content={tr('Video view', 'Xem Video')} side="bottom">
          <Button variant="bare" size="none" onClick={() => onViewMode('video')} aria-label={tr('Video view', 'Video')} aria-pressed={viewMode === 'video'} className={tab('video')}>
            <UiArt name="play" lit={viewMode === 'video'} />
          </Button>
        </Tooltip>
      )}
    </>
  )
}

/** One-row sort strip (Shopee's learned pattern: Liên quan | Mới nhất | Được quan tâm | Giá) —
 *  one-tap tabs on all sizes. Sticky below the header's slot; the offset follows the header
 *  when it auto-hides on scroll-down. The price tab carries its direction arrow (asc → re-tap
 *  flips). onPickSort wraps the parent's startFilterTransition(setSort). */
export function SortStrip({
  sort,
  onPickSort,
  headerHidden,
  leading,
}: {
  sort: SortKey
  onPickSort: (s: SortKey) => void
  headerHidden: boolean
  /**
   * The filter controls, rendered on the LEFT of this same row.
   *
   * ⚠️ A SLOT RATHER THAN A SIBLING ROW, AND THE STICKY IS THE WHOLE REASON. The wireframe puts
   * filters and sort on ONE line (owner, 2026-08-12: "clean 2 lines fit all"). The obvious way to
   * get that is to wrap both in a flex row in the caller — but this component IS the sticky bar
   * under the header, and its `top` offsets carry behaviour that took real incidents to get
   * right: the safe-area inset so the tabs do not sit under the Dynamic Island once the header
   * slides away, the dual env()/custom-property path for older Android WebViews, and the negative
   * margins that bleed its background to the page gutter. Moving the sticky up to a wrapper would
   * have re-derived all of it blind. Passing the filters IN keeps every one of those properties
   * untouched and still produces one line.
   *
   * ⚠️ IT WRAPS BELOW sm ON PURPOSE. The tab strip is a snap scroller on a phone (see the
   * touch-action note on the list below), and a filter bar beside it would leave both too narrow to scroll
   * sensibly. `basis-full sm:basis-auto` gives the filters their own line on mobile and shares
   * the row from sm up, which is where the wireframe's layout applies.
   */
  leading?: React.ReactNode
}) {
  const { tr } = useLanguage()
  const priceSortActive = sort === 'price-low' || sort === 'price-high'
  // The strip is a real ARIA tablist (ui/tabs → Base UI Tabs), driven by the URL/parent state, so
  // it uses the CONTROLLED api: value + onValueChange. The two price directions collapse onto ONE
  // tab — `price` — because they are one tab that carries a direction, not two tabs.
  // Re-tests inline rather than reusing priceSortActive: TS narrows `sort` through the literal
  // comparison, not through a boolean const, so the else branch is provably not a price key.
  const activeTab: SortTab = sort === 'price-low' || sort === 'price-high' ? 'price' : sort
  // Re-tap on the ALREADY-active price tab flips asc↔desc. That is not a value change, so
  // onValueChange never fires for it — it has to stay an onClick (see the tab below).
  const flipPrice = () => onPickSort(sort === 'price-low' ? 'price-high' : 'price-low')

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
  const sortTab = (selected: boolean) =>
    cn(
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
      'flex shrink-0 snap-start items-center gap-1 rounded-none border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors cursor-pointer',
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
        // The group-data twin is killed for the same reason. It is currently DORMANT (the rendered
        // list reports data-variant="default", so the [variant=line] selector never matches) — which
        // means today the dark underline survives by luck, not by design. Restate it with the base's
        // exact modifier so tailwind-merge removes it outright; otherwise the day that attribute
        // does land, the active underline goes transparent in dark mode and nothing fails loudly.
        ? 'border-brand dark:border-brand dark:data-active:border-brand dark:group-data-[variant=line]/tabs-list:data-active:border-brand text-accent-foreground hover:text-accent-foreground dark:hover:text-accent-foreground'
        : 'border-transparent text-body hover:text-foreground',
    )
  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        const next = value as SortTab
        // MANUAL activation, and keep it that way. Base UI's TabsList defaults
        // activateOnFocus={false}: ←/→ move roving focus, Enter/Space commits, and only the commit
        // reaches this handler. Do NOT "fix" arrows-don't-sort by turning activateOnFocus on — each
        // arrow keypress would then commit a sort and fire a fresh product query (four of them just
        // to arrow across the strip), and on Price it would auto-flip asc→desc mid-traverse.
        onPickSort(next === 'price' ? (sort === 'price-low' ? 'price-high' : 'price-low') : next)
      }}
      className={cn(
        // `block` drops the Tabs root's base `flex` (there are no panels here — the results grid
        // is the de-facto panel and lives outside this component), so the sticky bar stays the
        // exact block box it was.
        'block',
        // Swapping `top` (vs transform) is a no-op while still in normal flow, so it never
        // jolts the layout above — it only glides once actually stuck.
        // ⚠️ NO `border-b` HERE — IT MOVED TO THE INNER ROW, AND THE TWO ARE NOT THE SAME WIDTH.
        // This element deliberately bleeds past the page gutter (`-mx-3 sm:-mx-6 lg:-mx-8` below)
        // so its frosted background covers the full viewport once stuck. The hairline was riding on
        // that same box, so it ran one gutter wider than the content on each side — 12px at phone
        // sizes, 32px at lg — and read as a rule that missed the banner and cards it was supposed to
        // sit under (owner, 2026-08-13: "shorten this hairline to match the banner length").
        // The BACKGROUND still bleeds; only the line is inset. Keep them separate.
        'sticky z-30 bg-background/95 material backdrop-blur transition-[top] duration-[var(--duration-sticky,250ms)] ease-out motion-reduce:transition-none',
        // ⚠️ THIS BAR LEAVES WITH THE HEADER NOW, IT DOES NOT TAKE ITS PLACE (owner, 2026-08-12:
        // "on mobile and desktop when scroll up make these disappear and appear together with top
        // navbar" … "otherwise it should be there on home screen"). It used to swap `top` between
        // 4rem and 0 — so scrolling down replaced one pinned bar with another and the sort strip
        // followed you down the whole page. Both are chrome; both go.
        //
        // ⛔ IT IS DONE WITH `top` ALONE. NOT opacity, NOT transform — BOTH WERE TRIED AND BOTH ARE
        // WRONG, and the reason is the whole subtlety of this element. **A sticky element's `top`
        // is a no-op until it actually sticks**, which is exactly the property needed here:
        // `headerHidden` flips after ~80px of scroll, but this bar does not pin until the rails
        // above it have scrolled past — around 570px on the home page. `opacity-0` in that window
        // does not hide a pinned bar, it blanks a bar sitting IN FLOW halfway down the page.
        // Measured on the built preview at 1440×900: at scrollY 150 the strip was at viewport
        // y=372 with opacity 0 — a 49px hole between the rails and the grid, flickering back on
        // every change of direction. All three reviewers caught the class of bug; opus named this
        // instance. A negative `top` cannot do it: while unstuck it changes nothing at all, and
        // once stuck it parks the bar above the viewport.
        //
        // ⚠️ AND `top` IS THE ONLY PROPERTY IN THE TRANSITION FOR A SECOND REASON. The first draft
        // animated `top`, `transform` and `opacity` off one class flip and a comment claiming the
        // `top` change happened "while the bar is already translated out of sight". One flip is
        // one duration: they interpolate CONCURRENTLY, so mid-animation the bar was ~2rem down,
        // ~24px up and half-opaque — crossing the returning header in plain sight (agy, opus).
        // With one property there is no sequencing claim left to be wrong about.
        //
        // ⚠️ -9rem IS A MEASURED CLEARANCE, NOT A ROUND NUMBER. The bar is 49px tall on desktop
        // and 90px on a phone — and 90px is also what it measures at 320px wide with a category,
        // subcategory, brand, condition and type all applied, i.e. the widest this bar gets is
        // two rows, not three. 144px is a ~60% margin over that worst case. It was -6rem for one
        // round, which cleared 90px by six pixels; opus was right that a bar one wrapped row
        // taller would have peeked back into view. If this bar ever grows a third row, re-measure
        // rather than assuming this still clears.
        // It does NOT need the safe-area inset — that inset exists to keep a bar out from under
        // the Dynamic Island, and this position is off-screen. The VISIBLE pin still carries it:
        // max(env(), var()) is the dual-path inset from `html.native #app-header`, env() on iOS
        // and Android WebView ≥ 140, Capacitor's injected custom property on older Android. Both
        // are 0 on the web, so it is a no-op in a browser.
        //
        // ⚠️ `focus-within:` PUTS IT BACK, AND IT PINS AT THE INSET — **NOT** at inset+4rem. That
        // is the branch where the header is HIDDEN, so 4rem would reserve a 64px void for a bar
        // that is not on screen and show page content sliding through it (agy, opus). It is not
        // only a keyboard path either: clicking a sort tab focuses it, so a pointer user who
        // clicks and then scrolls down lands in exactly this state. Tabbing into a bar parked
        // 9rem above the viewport would otherwise move focus somewhere the user cannot see.
        headerHidden
          ? 'top-[-9rem] focus-within:top-[max(env(safe-area-inset-top),var(--safe-area-inset-top,0px))]'
          : 'top-[calc(max(env(safe-area-inset-top),var(--safe-area-inset-top,0px))+4rem)]',
        // Edge bleed coupled to the page gutter (max-w-7xl px-3 sm:px-6 lg:px-8).
        '-mx-3 px-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8',
      )}
    >
      {/* The hairline lives on THIS row, not on the bled wrapper — see the note above. It lands at
          the content's own left/right edges, so it lines up with the promo banner and the card grid
          beneath it instead of overshooting into the gutter. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 border-b border-border">
      {leading ? <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">{leading}</div> : null}
      <TabsList
        // variant=line: the default variant paints a bg-muted pill behind the strip.
        variant="line"
        className={cn(
          // Same-modifier kills of the list base: inline-flex → flex, w-fit → full width,
          // justify-center → start (it would CENTRE the tabs in the scroller), p-[3px] → none,
          // and the horizontal list's fixed h-8, which would squash the 40px tabs and clip the
          // underline. group-data-horizontal/tabs:h-auto matches the base's modifier verbatim so
          // tailwind-merge removes h-8 rather than racing it on specificity.
          // w-full/justify-start on mobile (own line); from sm it shrinks and sits at the
          // row's right edge beside the filters — the wireframe's arrangement.
          'flex w-full justify-start p-0 group-data-horizontal/tabs:h-auto sm:w-auto sm:shrink-0 sm:justify-end',
          // HORIZONTAL RAIL, NOT A DRAGGABLE OBJECT. Three things are load-bearing here:
          //
          //   ⛔ THE FIX FOR "cant scroll app on mobile" (owner, 2026-08-26) IS THE DELETED
          //                 `touch-pan-x`, NOT THE ADDED `overflow-y-hidden` — said plainly because
          //                 a reviewer caught the first version of this comment crediting the wrong
          //                 line, which is exactly how the bad line gets restored later. Measured:
          //                 `scrollHeight - clientHeight === 0` on this element BOTH before and
          //                 after, so there was never any vertical overflow; the only thing eating
          //                 vertical drags was the touch-action declaration.
          //   overflow-y-hidden  Belt and braces, and it retires the ORIGINAL justification rather
          //                 than the symptom: `overflow-x-auto` alone forces overflow-y to COMPUTE
          //                 to `auto` (CSS: once one axis is non-visible the other cannot stay
          //                 `visible`), which is what made "this strip is a two-axis scroller"
          //                 look true and sent the previous author to touch-action. Naming `hidden`
          //                 makes it false by declaration.
          //                 ⚠️ It does NOT newly clip anything: the computed `auto` it replaces
          //                 clips at the same box edge. The tab is exactly the list's height (42 of
          //                 42) and carries a 2px outline at 2px offset, so the focus ring has zero
          //                 headroom and is cut — pre-existing, unchanged here, and worth fixing
          //                 separately by giving the list vertical padding.
          //
          //   ⛔ NO touch-action AT ALL, AND THE ABSENCE IS THE POINT. This carried `touch-pan-x`,
          //                 justified by a comment claiming pan-x "hands every vertical gesture
          //                 back to the page". It does the opposite: `touch-action` names the ONLY
          //                 permitted directions, so a vertical drag BEGINNING here was discarded,
          //                 not forwarded — and this strip is 388px wide on a 393px phone inside a
          //                 STICKY container, i.e. parked under the reader's thumb for the whole
          //                 page. The app looked frozen.
          //                 ⚠️ `pan-x pan-y` was the obvious replacement and is ALSO wrong: any
          //                 touch-action but `auto` drops `pinch-zoom` and double-tap zoom, so it
          //                 would trade "cannot scroll" for "cannot zoom" over the same band, on a
          //                 marketplace where zooming a photo is ordinary behaviour. All three
          //                 reviewers caught that independently.
          //                 ✅ With the vertical axis gone above, `auto` is correct AND minimal —
          //                 there is nothing left for the strip to capture. Verified on the built
          //                 page, one gesture each: vertical swipe starting ON the strip scrolls the
          //                 page 399px (it was 0), horizontal swipe still pans the strip, and a
          //                 pinch over it zooms 1.0 → 2.0.
          //                 ⛔ Do NOT reintroduce a touch-action value here to "be explicit".
          //
          //   -mb-px        Moved here off the tabs (see sortTab): on the tab it left a permanent
          //                 1px scrollHeight > clientHeight, i.e. a live vertical scroller. On the
          //                 list the same pixel overlaps the root's border with zero overflow.
          //   snap-*        With px-3 restored the strip DOES overflow (~24px at 393px, far more
          //                 under OS text scaling). Mandatory snap means it lands on a tab edge
          //                 rather than resting mid-label.
          //
          // overscroll-x-contain stops a sideways flick chaining out to the page/back-gesture.
          '-mb-px scrollbar-none flex-nowrap items-center gap-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain',
        )}
      >
        <TabsTrigger value="newest" type="button" className={sortTab(sort === 'newest')}>
          {tr('Relevance', 'Liên quan')}
        </TabsTrigger>
        <TabsTrigger value="recent" type="button" className={sortTab(sort === 'recent')}>
          {tr('Newest', 'Mới nhất')}
        </TabsTrigger>
        <TabsTrigger value="popular" type="button" className={sortTab(sort === 'popular')}>
          {tr('Most contacted', 'Được quan tâm')}
        </TabsTrigger>
        <TabsTrigger
          value="price"
          type="button"
          // Fires for BOTH pointer and Enter/Space. Guarded on priceSortActive so it only ever
          // handles the re-tap flip: when the tab is not yet active the click changes the value
          // and onValueChange already selects price-low, so the guard keeps that from double-firing.
          onClick={() => {
            if (priceSortActive) flipPrice()
          }}
          aria-label={tr('Sort by price', 'Sắp xếp theo giá')}
          className={sortTab(priceSortActive)}
        >
          {tr('Price', 'Giá')}
          {/* size-3.5 is the same 14px as h-3.5 w-3.5 — but TabsTrigger's base carries the OLD
              [&_svg:not([class*='size-'])]:size-4 rule (0,2,1), which outspecificities h-3.5 and
              would inflate these arrows to 16px. A class containing "size-" is excluded by that
              :not(), so this spelling keeps them at 14px. */}
          {sort === 'price-low' ? (
            <ArrowUp className="size-3.5" />
          ) : sort === 'price-high' ? (
            <ArrowDown className="size-3.5" />
          ) : (
            <ArrowUpDown className="size-3.5 text-ink-4" />
          )}
        </TabsTrigger>
      </TabsList>
      </div>
    </Tabs>
  )
}
