'use client'

import { List, Grid, Map, Play, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
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
  // p-2.5 + 18px icon ≈ a 38px tap target (was ~30px: p-2 + 14px icon, below the comfortable
  // minimum). tap-44 can't be used here — four toggles sit a `gap-1` apart, so 44px hit areas
  // would overlap and steal each other's taps (same failure the video-feed rail hit).
  const tab = (mode: ViewMode) =>
    cn('rounded-lg p-2.5 transition-colors cursor-pointer', viewMode === mode ? 'text-accent-foreground' : 'text-body hover:bg-muted')
  return (
    <>
      <Tooltip content={tr('List view', 'Danh sách')} side="bottom">
        <Button variant="bare" size="none" onClick={() => onViewMode('compact')} aria-label={tr('List view', 'Danh sách')} aria-pressed={viewMode === 'compact'} className={tab('compact')}>
          <List className="h-[18px] w-[18px]" />
        </Button>
      </Tooltip>
      <Tooltip content={tr('Grid view', 'Lưới')} side="bottom">
        <Button variant="bare" size="none" onClick={() => onViewMode('grid')} aria-label={tr('Grid view', 'Lưới')} aria-pressed={viewMode === 'grid'} className={tab('grid')}>
          <Grid className="h-[18px] w-[18px]" />
        </Button>
      </Tooltip>
      <Tooltip content={tr('Map view', 'Xem Bản đồ')} side="bottom">
        <Button variant="bare" size="none" onClick={() => onViewMode('map')} aria-label={tr('Map view', 'Bản đồ')} aria-pressed={viewMode === 'map'} className={tab('map')}>
          <Map className="h-[18px] w-[18px]" />
        </Button>
      </Tooltip>
      {showVideo && (
        <Tooltip content={tr('Video view', 'Xem Video')} side="bottom">
          <Button variant="bare" size="none" onClick={() => onViewMode('video')} aria-label={tr('Video view', 'Video')} aria-pressed={viewMode === 'video'} className={tab('video')}>
            <Play className="h-[18px] w-[18px]" />
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
}: {
  sort: SortKey
  onPickSort: (s: SortKey) => void
  headerHidden: boolean
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
      // px-2 on mobile (px-3 from sm up): at 393px the four labels + px-3 came to ~417px, so the
      // strip overflowed by ~24px — just enough to be nudged and then REST MID-WORD ("evance").
      // Trimming 8px per tab reclaims 32px, so the full strip fits and there is nothing to scroll.
      // snap-start pairs with the list's snap-mandatory: if it ever DOES overflow (accessibility
      // text sizes), it can only come to rest on a tab boundary, never halfway through a label.
      '-mb-px flex shrink-0 snap-start items-center gap-1 rounded-none border-b-2 px-2 py-2.5 text-sm font-semibold transition-colors cursor-pointer sm:px-3',
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
        'sticky z-30 border-b border-border bg-background/95 backdrop-blur transition-[top] duration-[250ms] ease-out motion-reduce:transition-none',
        // ⚠️ The hidden-header offset is NOT top-0. Once the header slides away this strip is
        // the TOP-MOST element on the app's primary surface, and the native WebView is
        // edge-to-edge (capacitor.config ios.contentInset:'never') — at top-0 the sort tabs
        // sit under the Dynamic Island / notch. It has to reclaim the inset itself, exactly
        // as the header does when it pins at y=0 (see globals.css "Safe-area top").
        // max(env(), var()) is the same dual-path inset as `html.native #app-header`: env()
        // on iOS + Android WebView ≥ 140, Capacitor's injected custom property on older
        // Android WebViews. Both operands are 0 on the web, so this is a no-op in a browser.
        headerHidden
          ? 'top-[max(env(safe-area-inset-top),var(--safe-area-inset-top,0px))]'
          : 'top-[calc(max(env(safe-area-inset-top),var(--safe-area-inset-top,0px))+4rem)]',
        // Edge bleed coupled to the page gutter (max-w-7xl px-3 sm:px-6 lg:px-8).
        '-mx-3 px-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8',
      )}
    >
      <TabsList
        // variant=line: the default variant paints a bg-muted pill behind the strip.
        variant="line"
        className={cn(
          // Same-modifier kills of the list base: inline-flex → flex, w-fit → full width,
          // justify-center → start (it would CENTRE the tabs in the scroller), p-[3px] → none,
          // and the horizontal list's fixed h-8, which would squash the 40px tabs and clip the
          // underline. group-data-horizontal/tabs:h-auto matches the base's modifier verbatim so
          // tailwind-merge removes h-8 rather than racing it on specificity.
          'flex w-full justify-start p-0 group-data-horizontal/tabs:h-auto',
          // The strip is sized to FIT (see sortTab's px-2), so overflow-x-auto normally yields no
          // scroller at all — it reads as solid chrome. snap-mandatory + overscroll-x-contain only
          // matter when text scaling forces overflow: it then scrolls tab-by-tab instead of feeling
          // like a loose draggable rail, and a sideways flick can't chain out to the page.
          'scrollbar-none flex-nowrap items-center gap-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain',
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
    </Tabs>
  )
}
