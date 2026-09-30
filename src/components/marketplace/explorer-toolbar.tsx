'use client'

import { Rows3, LayoutGrid, Map, Play, ArrowUp, ArrowDown, ArrowUpDown, ChevronRight } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toggle } from '@/components/ui/toggle'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { sortTabClass } from './sort-tab-class'
import { CustomSelect } from './custom-select'
import { useScrollArrows } from '@/hooks/use-scroll-arrows'
import { STROKE_UI } from '@/lib/icon-tokens'

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
  // p-2.5 + 20px icon = a 40px box (h-5 is the §4 ladder step for action-row icons — the old
  // h-[18px] was an off-ladder arbitrary size).
  // ⚠️ `tap-44` FITS HERE EXACTLY, AND THIS COMMENT USED TO SAY THE OPPOSITE. The four toggles sit
  // a `gap-1` (4px) apart, i.e. at a 44px PITCH. A centred 44px hit area on a 40px box reaches 2px
  // each side — half of each gap — so neighbouring extenders ABUT and cannot overlap. Measured
  // without it: 40px targets with a 4px dead strip between every pair. The overlap failure the old
  // note feared (the video-feed rail) needs a pitch under 44px; re-check this if the gap or the
  // padding ever shrinks. `relative` is the tap-44 contract: ui/button is not positioned.
  const tab = (mode: ViewMode) =>
    cn('relative rounded-lg p-2.5 transition-colors duration-200 cursor-pointer tap-44', viewMode === mode ? 'text-accent-foreground' : 'text-body hover:bg-muted')
  /**
   * ⛔ THE PER-GLYPH `wash()` IS GONE BECAUSE IT NEVER RENDERED. It carried a careful comment about
   * §5 duotone — "the glyph's ONE closed region gains the brand wash" — and named a child selector
   * per icon: `[&>rect]` for Rows3, `[&>rect:first-of-type]` for LayoutGrid, `[&>path:first-of-type]`
   * for Map, `[&>polygon]` for Play. Those children do not exist in this app's DOM. The icons are
   * `<use href="…#glyph">` references into an external sprite, and the repo already has this written
   * down elsewhere: a class cannot style inside a `<use>` shadow tree — only inherited properties
   * and custom properties cross that boundary. So the fill was never applied and the only thing
   * marking the active view was the ink colour from `tab()`.
   * ⚠️ IT LOOKED FINE THE WHOLE TIME, which is why nobody caught it: `text-accent-foreground` alone
   * reads as selected, so the missing half was invisible.
   * ⚠️ THE REAL MECHANISM IS ALREADY WIRED: `aria-pressed` on each button drives the app's
   * `.i-rest`→`.i-on` swap in globals.css (Solar Bold weight + accent colour). If the duotone back
   * plate is genuinely wanted here, it has to go through scripts/gen-icons.mjs's DUOTONE list and
   * be driven by `--i-back-color` / `--i-back-opacity`, because a custom property is the only thing
   * that crosses into the sprite.
   */
  return (
    <>
      <Tooltip content={tr('List view', 'Danh sách')} side="bottom">
        <Button variant="bare" size="none" onClick={() => onViewMode('compact')} aria-label={tr('List view', 'Danh sách')} aria-pressed={viewMode === 'compact'} className={tab('compact')}>
          <Rows3 className="h-5 w-5" />
        </Button>
      </Tooltip>
      <Tooltip content={tr('Grid view', 'Lưới')} side="bottom">
        <Button variant="bare" size="none" onClick={() => onViewMode('grid')} aria-label={tr('Grid view', 'Lưới')} aria-pressed={viewMode === 'grid'} className={tab('grid')}>
          <LayoutGrid className="h-5 w-5" />
        </Button>
      </Tooltip>
      <Tooltip content={tr('Map view', 'Xem Bản đồ')} side="bottom">
        <Button variant="bare" size="none" onClick={() => onViewMode('map')} aria-label={tr('Map view', 'Bản đồ')} aria-pressed={viewMode === 'map'} className={tab('map')}>
          <Map className="h-5 w-5" />
        </Button>
      </Tooltip>
      {showVideo && (
        <Tooltip content={tr('Video view', 'Xem Video')} side="bottom">
          <Button variant="bare" size="none" onClick={() => onViewMode('video')} aria-label={tr('Video view', 'Video')} aria-pressed={viewMode === 'video'} className={tab('video')}>
            <Play className="h-5 w-5" />
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
  goodPrice,
  onGoodPrice,
  goodPriceOffered = true,
  headerHidden,
  leading,
  priceLabel = 'price',
}: {
  sort: SortKey
  onPickSort: (s: SortKey) => void
  /**
   * What the price tab is called. Over jobs it sorts by the SALARY in the price column, and a "Price"
   * tab over job cards reads as a fee (K-ORANGE, 2026-09-29) — same prop as SellerListings'.
   */
  priceLabel?: 'price' | 'salary'
  /**
   * The "Good price" filter (owner, 2026-09-15: "add good price sorting here … tap good price will show
   * prices that are good in that subcategory model"; "good price button should be green when tapped").
   * It lives in this strip because that is where the owner asked for it, but it is a FILTER, not a
   * fifth sort: it narrows the rows and combines with whichever tab is selected, so Good price + Price ↑
   * lists the cheapest good deals. Hence a Toggle beside the tablist, never a tab inside it.
   */
  goodPrice: boolean
  onGoodPrice: (on: boolean) => void
  /**
   * False when "Good price" would narrow nothing — no listing in view is priced below its market
   * band, or every one is (the feed's `facets.deal`). Measured on production 2026-09-25: it returned
   * 0 in 71 of 83 category and subcategory views, because only Electronics carries market bands. The
   * toggle is then not drawn (owner: "show only available filter options") — unless it is ON, which
   * must stay visible so it can be switched off. Defaults to true: no counts, no evidence.
   */
  goodPriceOffered?: boolean
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
   *
   * ⛔ LOCAL TRY, 2026-09-30 — THE OWNER ASKED TO TRY ONE ROW ON PHONES, reversing the paragraph
   * above for widths below sm (the "clean 2 lines fit all" arrangement of 2026-08-12 is kept above
   * as the history). Below sm the filters no longer take their own line: the whole strip is ONE
   * horizontal scroller — a compact sort pill FIRST (the current sort, opening the choices through
   * CustomSelect, the same Base UI select the facet pills are), then the facet pills, then Good price.
   * The tab list is not drawn below sm; from sm up nothing changes. The two nested-scroller traps the
   * notes below describe are avoided the same way: below sm the facet row and the tab/toggle row stop
   * scrolling (`max-sm:overflow-visible`) and the ONE scroller is the row that holds them all.
   * Measured at 390×844: first card 447 → see listings-explorer.tsx at the SortStrip call site.
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
  // THE PHONE ROW (see `leading`'s 2026-09-30 note). The same five orders the tabs reach, with the
  // price tab's two directions spelled out as two options — a menu has no "re-tap flips".
  const salary = priceLabel === 'salary'
  const sortOptions: { value: SortKey; label: string }[] = [
    { value: 'newest', label: tr('Relevance', 'Liên quan') },
    { value: 'recent', label: tr('Newest', 'Mới nhất') },
    { value: 'popular', label: tr('Most contacted', 'Được quan tâm') },
    { value: 'price-low', label: salary ? tr('Salary: low to high', 'Lương: thấp đến cao') : tr('Price: low to high', 'Giá: thấp đến cao') },
    { value: 'price-high', label: salary ? tr('Salary: high to low', 'Lương: cao đến thấp') : tr('Price: high to low', 'Giá: cao đến thấp') },
  ]
  // The pill says the CURRENT order in the tab's own words ("Price" + its arrow), not the menu's
  // long option label, so it stays as narrow as a tab.
  const sortPillLabel = priceSortActive
    ? (salary ? tr('Salary', 'Lương') : tr('Price', 'Giá'))
    : (sortOptions.find((o) => o.value === sort)?.label ?? tr('Sort by', 'Sắp xếp'))
  const SortGlyph = sort === 'price-low' ? ArrowUp : sort === 'price-high' ? ArrowDown : ArrowUpDown
  // The phone row's scroller, for the edge signpost (category-rail.tsx's pattern — see below).
  const { scrollerRef: phoneRowRef, canRight: phoneRowCanRight } = useScrollArrows<HTMLDivElement>({ watch: sort })

  return (
    <Tabs
      /**
       * ⚠️ THE ID IS A STYLING HOOK, NOT A LABEL — the home page's wash reaches this bar through it.
       * Owner, 2026-09-18, pointing at the filter strip: "add background blue here too". This bar is
       * chrome that pins directly under the header, and the header already takes the wash's strongest
       * stop (`.home-wash #app-header` in globals.css), so a white bar landing under a blue one broke
       * the band in half. The rule is scoped to `.home-wash`, so /listings and every other explorer
       * keeps the neutral bar; only the home page tints it.
       * ⛔ IT CANNOT BE A CLASS HERE. `bg-background/95` below is a single class, and any tint added
       * beside it would be a same-weight rule decided by stylesheet order rather than by intent — the
       * trap CLAUDE.md records for `render`-prop children. An id selector outranks it outright.
       */
      id="explorer-toolbar"
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
      {/* ⛔ PHONE: ONE SCROLLER (owner's one-row try, 2026-09-30 — see `leading`). The hairline stays on
          the outer box at the content's width; the scroller inside bleeds to the screen edges
          (`-mx-3 px-3`, the facet row's own bleed) so pills slide out under the edge rather than being
          sliced at the gutter. From sm the scroller classes are inert and the row is the old one. */}
      <div className="relative border-b border-border">
      <div
        ref={phoneRowRef}
        className="flex flex-wrap items-center justify-between gap-x-4 max-sm:-mx-3 max-sm:flex-nowrap max-sm:justify-start max-sm:gap-x-2 max-sm:overflow-x-auto max-sm:overflow-y-hidden max-sm:overscroll-x-contain max-sm:px-3 scrollbar-none"
      >
      {/* THE PHONE SORT PILL — first in the row so the order is visible without a swipe. A facet pill's
          box (min-h-11, ⌄), with the order's glyph in front (⇅, or the price direction). */}
      <CustomSelect
        value={sort}
        onChange={(v) => onPickSort(v as SortKey)}
        options={sortOptions}
        label={tr('Sort by', 'Sắp xếp theo')}
        triggerLabel={sortPillLabel}
        icon={<SortGlyph className={cn('size-3.5 shrink-0', sort === 'newest' && 'text-ink-4')} />}
        indicator="down"
        searchable={false}
        className="min-h-11"
        activeClassName="text-accent-foreground"
        wrapperClassName="w-auto shrink-0 sm:hidden"
      />
      {leading ? <div className="min-w-0 basis-full max-sm:shrink-0 max-sm:basis-auto sm:flex-1 sm:basis-auto">{leading}</div> : null}
      {/* ⚠️ THE TABLIST AND THE GOOD-PRICE TOGGLE SHARE ONE FLEX ROW, AND THE WRAPPER IS WHAT KEEPS THEM
          ON ONE LINE. The TabsList is `w-full` on a phone (its own line, see `leading`); as a direct child
          of the wrapping row above, anything after it would wrap onto a third line. Inside this row the
          list takes the rest (`min-w-0 flex-1` — it is the scroller) and the toggle keeps its own width
          at the end, always visible without scrolling the strip. */}
      {/*
        * ⛔ THE SCROLLER IS THIS ROW, NOT THE TabsList — owner, 2026-09-21: "so all is on one swipe
        * reel". "Good price" is a FILTER, not a fifth sort, so it must stay a Toggle OUTSIDE the
        * `role="tablist"` (a tablist may only contain tabs; an aria-pressed button in one is an
        * a11y violation, and the note on `goodPrice` above says exactly that). Making the shared
        * parent the scroller puts both on one rail without moving the button into the tablist.
        * ⚠️ THE touch-action RULES MOVE WITH THE OVERFLOW. Everything the TabsList comment below
        * says about `overflow-y-hidden`, and about NEVER declaring `touch-action`, now applies HERE
        * — this is the element that owns the horizontal overflow, and it sits inside the STICKY
        * bar, parked under the reader's thumb. A `touch-pan-x` here would re-break "cant scroll app
        * on mobile" exactly as it did on the list.
        */}
      {/* ⚠️ Below sm (2026-09-30 try) this row is NOT a scroller and holds only Good price — the tab list
          is hidden and the row it sits in scrolls instead (`max-sm:overflow-visible`, `max-sm:shrink-0`). */}
      <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto -mb-px scrollbar-none flex-nowrap snap-x snap-proximity overflow-x-auto overflow-y-hidden overscroll-x-contain max-sm:mb-0 max-sm:w-auto max-sm:shrink-0 max-sm:overflow-visible">
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
          // ⚠️ `w-auto flex-none shrink-0` at EVERY width now, not only from sm. Inside a
          // horizontal scroller a `w-full flex-1` child collapses to the container's width and the
          // tabs compress instead of overflowing — leaving nothing to swipe.
          'flex w-auto min-w-0 flex-none shrink-0 justify-start p-0 group-data-horizontal/tabs:h-auto sm:justify-end',
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
          // ⚠️ THE OVERFLOW/SNAP/-mb-px SET MOVED UP TO THE ROW (see its comment). Two nested
          // scrollers would trap the gesture in whichever one the thumb landed on, so the tabs
          // would pan while "Good price" stayed put — the opposite of one reel.
          'flex-nowrap items-center gap-1',
          // ⛔ Not drawn below sm (2026-09-30 one-row try): the phone sort pill at the head of the row
          // reaches the same five orders.
          'max-sm:hidden',
        )}
      >
        <TabsTrigger value="newest" type="button" className={sortTabClass(sort === 'newest')}>
          {tr('Relevance', 'Liên quan')}
        </TabsTrigger>
        <TabsTrigger value="recent" type="button" className={sortTabClass(sort === 'recent')}>
          {tr('Newest', 'Mới nhất')}
        </TabsTrigger>
        <TabsTrigger value="popular" type="button" className={sortTabClass(sort === 'popular')}>
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
          aria-label={priceLabel === 'salary' ? tr('Sort by salary', 'Sắp xếp theo lương') : tr('Sort by price', 'Sắp xếp theo giá')}
          className={sortTabClass(priceSortActive)}
        >
          {priceLabel === 'salary' ? tr('Salary', 'Lương') : tr('Price', 'Giá')}
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
      {(goodPrice || goodPriceOffered) && (
      <Toggle
        pressed={goodPrice}
        onPressedChange={onGoodPrice}
        title={tr('Show only listings priced below the market for the same item', 'Chỉ hiện tin có giá thấp hơn thị trường cho cùng sản phẩm')}
        className={cn(
          // ⚠️ IT WEARS THE FACET PILLS' CLOTHES, NOT ITS OWN (owner, 2026-09-16: "match the good price
          // style to other dropdowns so it wont pop out just on press turns green"). It sat in this row
          // as a bordered rounded-full chip, which read as a fifth, louder control beside Any type /
          // Price / Area / Any condition. These are those pills' exact classes from facet-bar.tsx —
          // borderless, rounded-xl, px-4, h-12 tap target, muted hover, same press scale and duration —
          // minus their chevron, because this one opens nothing. Keep the two in step if that file moves.
          // ⚠️ THE HEIGHT IS THE TABS', NOT THE FACET PILLS'. facet-bar's own pills are min-h-11 (44px, 48 until 2026-09-30)
          // because they sit on their own row; measured here, 48 beside 42px tabs grew this row to 48
          // and left the toggle overhanging the tab strip's baseline (agy). It matches its neighbours.
          // `snap-start` so it is a stop on the same reel as the tabs, not a straggler after them.
          'flex h-[42px] w-auto shrink-0 snap-start items-center justify-between rounded-xl px-4 text-sm font-semibold transition-[background-color,color,scale] duration-100 active:scale-[0.96]',
          // Below sm it sits among the facet pills, not the tabs (2026-09-30 one-row try), so it takes
          // THEIR 44px — the tap-target floor — rather than the tabs' 42.
          'max-sm:h-11',
          'text-body hover:bg-muted',
          // GREEN ONLY WHEN PRESSED, and it is the whole affordance now that the border is gone.
          // `--success` is green-800 in light and green-400 in dark, so the ink flips with it: the page
          // background colour reads on both (white on green-800, near-black on green-400) where a fixed
          // white would fail contrast on the dark theme's light green.
          'data-pressed:bg-success data-pressed:text-background data-pressed:hover:bg-success data-pressed:hover:text-background',
        )}
      >
        {tr('Good price', 'Giá tốt')}
      </Toggle>
      )}
      </div>
      </div>
      {/**
        * THE PHONE ROW'S EDGE SIGNPOST — category-rail.tsx's, class for class: a static plated chevron
        * at the right edge while there IS more to the right (`canRight`), gone at the end of the row,
        * `pointer-events-none` so a swipe passes through it. NOT the rail beam: shelf.tsx reserves the
        * beam for rails of PRODUCTS and names the facet bar as a row that deliberately goes without.
        * `sm:hidden` — from sm this row does not scroll.
        */}
      {phoneRowCanRight && (
        <span
          aria-hidden="true"
          className="material pointer-events-none absolute right-0 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-card/70 text-body shadow-sm ring-1 ring-border/60 backdrop-blur-sm sm:hidden"
        >
          <ChevronRight className="h-5 w-5" strokeWidth={STROKE_UI} />
        </span>
      )}
      </div>
    </Tabs>
  )
}
