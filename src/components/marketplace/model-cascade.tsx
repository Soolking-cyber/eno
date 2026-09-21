'use client'

import { useMemo, useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ChevronDown } from '@/components/ui/icons'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { CountChip } from './count-chip'
import { splitModel, type ModelParts } from '@/lib/model-lineage'
import { linesFor, canonicalModel } from '@/generated/model-lineage'

/**
 * MODEL CASCADE — the brand's PRODUCT LINES as one row of chips, each opening a dropdown of that
 * line's models newest-first: iPhone -> "iPhone 18 Pro Max, iPhone 18 Pro, iPhone 18, iPhone 17 …".
 *
 * ⛔ ONE COLUMN AND A DROPDOWN, NOT THREE COLUMNS. The first build laid line -> generation ->
 * variant out as three side-by-side panels rolling right. It worked, and it was wrong for the rail
 * it lives in: the third panel ran off the edge on a phone, and reaching a specific phone cost
 * three taps through two intermediate lists nobody wanted to read. Owner's call — the generation
 * and the variant are the same question ("which iPhone?"), so they are one list.
 *
 * ⛔ CLICK TO OPEN, ON EVERY DEVICE — AND HOVER WAS TRIED FIRST. `openOnHover` is what the rail's
 * "More" overflow uses, so it looked like the house pattern, but that chip is ALONE and these are
 * a THREE-ROW GRID. Owner, on the built page: "annoying when hover 2nd row but when mouse is over
 * 1st row opens that and hard to open 2nd row" — the menu opens under the pointer and then covers
 * the very rows you are reaching for, so the lower rows become unreachable by hovering. Raising
 * the delay only slows that down. One trigger, one intent: click opens, click again closes, and a
 * finger and a mouse behave identically. `modal={false}` and the portal that escapes the rail's
 * `overflow-x-auto` clipping are still copied from `more-overflow.tsx`.
 *
 * ⚠️ THE TINT STILL DEEPENS, just across a smaller stack: the line row sits on `brand-50` and its
 * dropdown on `brand-100`, so opening one still reads as going a level in. `brand-150` is now
 * unused here; it stays defined because it is a measured, themed step someone will want again.
 */

type ModelRow = { model: string; count: number }

/** A line chip, plus every model under it in display order. */
type Line = { key: string; label: string; count: number; models: { model: string; count: number }[] }

/**
 * Within one generation, the tiers a buyer thinks of as "bigger first".
 * ⚠️ AN EXPLICIT RANK, NOT STRING LENGTH. Sorting the suffix by length puts "Plus" above "Pro"
 * (4 > 3) and reads as a mistake to anyone who knows the lineup.
 */
const TIER = ['pro max', 'ultra', 'pro', 'max', 'plus', '', 'fe', 'e', 'mini', 'se', 'lite']
const tierRank = (v: string | null) => {
  const i = TIER.indexOf((v ?? '').toLowerCase())
  return i === -1 ? TIER.indexOf('') + 0.5 : i
}

/**
 * ⛔ NEWEST FIRST, AND THE ORDER IS PARSED — NEVER ASKED. The decisions model cannot judge
 * recency: probed, it scored "iPhone 17 Pro Max" 0.19 on "is this a real product" while giving
 * "MacBook Air" 0.98, because its training predates the lineup. Generation comes from the integer.
 *
 * ⚠️ A YEAR IS NOT A SEQUENCE NUMBER. "Apple Watch SE 2022" parsed naively sorts above "SE 3", so
 * year-form entries sort among themselves BELOW the numbered ones rather than being interleaved on
 * a guess. An entry with no generation at all ("iPhone Xr") is the oldest of its line, so it goes
 * last — an earlier version had this backwards and headed the list with the oldest product.
 */
function byNewestThenTier(a: ModelParts, b: ModelParts): number {
  if (a.gen === null || b.gen === null) {
    if (a.gen === null && b.gen === null) return a.raw.localeCompare(b.raw)
    return a.gen === null ? 1 : -1
  }
  if (a.genIsYear !== b.genIsYear) return a.genIsYear ? 1 : -1
  if (a.gen !== b.gen) return b.gen - a.gen
  // ⚠️ A FINAL TIEBREAK ON THE STRING, so two models sharing a generation AND a tier cannot swap
  // places between renders — an unstable list under a pointer is a misclick waiting to happen.
  return tierRank(a.variant) - tierRank(b.variant) || a.raw.localeCompare(b.raw)
}

function buildLines(brandSlug: string, rows: ModelRow[]): Line[] | null {
  if (rows.length < 3) return null
  const known = linesFor(brandSlug)

  /**
   * ⚠️ FOLD ALIASES BEFORE GROUPING, NEVER AFTER. "Apple Watch S8" and "Apple Watch Series 8" are
   * one product written twice; grouped raw they become two rows with split counts, and the picker
   * quietly claims the catalogue holds two different watches.
   */
  const folded = new Map<string, { parts: ModelParts; count: number }>()
  for (const r of rows) {
    const canon = canonicalModel(brandSlug, r.model)
    const cur = folded.get(canon)
    if (cur) cur.count += r.count
    else folded.set(canon, { parts: splitModel(canon, known), count: r.count })
  }

  const byLine = new Map<string, { parts: ModelParts; count: number }[]>()
  for (const e of folded.values()) {
    if (!byLine.has(e.parts.line)) byLine.set(e.parts.line, [])
    byLine.get(e.parts.line)!.push(e)
  }
  /**
   * ⛔ THE SAME SKU TEST THE GENERATOR USES, BECAUSE THE GENERIC PARSE RUNS HERE TOO. The curated
   * table had LG right — UltraGear, Puricare, xboom — and production still showed
   * "FV | F | DVHP | IFC": those models match no curated line, so `splitModel` falls back to its
   * generic parse and invents a line from the part number's alphabetic head ("FV1414H3BA" -> FV).
   * Guarding only the generator was guarding the wrong half. Caught on the LIVE page, not in the
   * table, which is why checking the deployed thing is worth the round trip.
   *
   * A line survives when it is CURATED, or multi-token, or reads as a word (a lowercase letter),
   * or is followed by a space in one of its own models — "XPS 13" passes, "FV1414H3BA" does not.
   */
  const curated = new Set(known.map((k) => k.toLowerCase()))
  for (const [line, es] of [...byLine.entries()]) {
    if (curated.has(line.toLowerCase()) || line.includes(' ') || /[a-z]/.test(line)) continue
    if (es.some((e) => e.parts.raw.toLowerCase().startsWith(`${line.toLowerCase()} `))) continue
    byLine.delete(line)
  }
  if (byLine.size < 2) return null

  return [...byLine.entries()]
    .map(([line, es]) => ({
      key: line,
      label: line,
      count: es.reduce((n, e) => n + e.count, 0),
      models: [...es].sort((x, y) => byNewestThenTier(x.parts, y.parts))
        .map((e) => ({ model: e.parts.raw, count: e.count })),
    }))
    .sort((a, b) => b.count - a.count)
}

/** True when this brand has a hierarchy worth drilling — the rail asks before replacing its grid. */
export function hasCascade(brandSlug: string, rows: ModelRow[]): boolean {
  return buildLines(brandSlug, rows) !== null
}

function LineChip({ line, lineKeys, activeLine, activeModel, onPick }: {
  line: Line
  /** Every line name in this brand, so a chip can tell a longer sibling has the better claim. */
  lineKeys: string[]
  activeLine: string
  activeModel: string
  onPick: (line: string, model: string) => void
}) {
  const { tr } = useLanguage()
  const [open, setOpen] = useState(false)
  /**
   * ⚠️ `startsWith`, NOT `===`. The previous build wrote GENERATION prefixes into this param
   * (`?line=iPhone 17`), and those links are already out in the world — shared, and in this
   * session's own history. An equality test would call them orphans and the guard below would
   * silently clear the filter. The API still honours the longer prefix, so the link keeps working
   * and its line chip lights up.
   */
  /**
   * ⚠️ THE LONGEST MATCH WINS, or two chips light up at once. "iPad" is a prefix of "iPad Air",
   * so `?line=iPad Air` made BOTH chips read as selected — the caller passes `lineKeys` so this
   * chip can check that no longer line also matches.
   */
  const lineSelected = (activeLine === line.key || activeLine.startsWith(`${line.key} `))
    && !lineKeys.some((k) => k !== line.key && k.length > line.key.length
      && (activeLine === k || activeLine.startsWith(`${k} `)))
  const modelSelected = line.models.some((m) => m.model === activeModel)
  const on = lineSelected || modelSelected

  /**
   * ⚠️ A LINE OF ONE MODEL IS NOT A DROPDOWN. Opening a menu to reveal a single row is a tap that
   * teaches nothing; the chip filters directly instead.
   */
  if (line.models.length < 2) {
    return (
      <Button
        variant="bare"
        size="none"
        aria-pressed={on}
        onClick={() => onPick('', on ? 'all' : line.models[0].model)}
        className={cn(chipCls, on ? chipOn : chipOff)}
      >
        {line.label}
        <CountChip count={line.count} className="ml-1" />
      </Button>
    )
  }

  return (
    // modal={false}: a lightweight rail menu, not a scroll-locking dialog — same as the rail's
    // "More" overflow. (It is click-opened now, not hover; see the header note.)
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false} highlightItemOnHover={false}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="bare"
            size="none"
            type="button"
            /**
             * ⛔ THE TRIGGER DOES NOT FILTER, AND AN EARLIER VERSION DID. It carried an onClick that
             * selected the whole line — harmless with a mouse, broken with a finger: on a phone the
             * ONLY way to open the menu is to tap, so opening it also applied a filter, and tapping
             * again to close removed it. Both reviewers landed on the same case. Opening a menu and
             * committing a filter are different intents; "All <line>" below is the explicit way to
             * ask for the whole line, and it behaves identically on both input types.
             */
            className={cn(chipCls, on ? chipOn : chipOff)}
          >
            {line.label}
            <CountChip count={line.count} className="ml-1" />
            <ChevronDown className={cn('ml-0.5 h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
          </Button>
        }
      />
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={6}
        // bg-brand-100: one step deeper than the brand-50 row it opens from, so the dropdown reads
        // as going a level IN rather than as a detached white menu floating over the rail.
        className="flex w-64 max-h-[60vh] flex-col gap-0.5 overflow-y-auto scroll-thin rounded-2xl bg-brand-100 p-1.5 shadow-pop ring-0"
      >
        {/* The whole line, stated rather than implied by tapping the chip. */}
        <DropdownMenuItem
          nativeButton
          className="p-0 focus:bg-transparent data-highlighted:bg-card/70"
          render={
            <Button
              variant="bare"
              size="none"
              type="button"
              /**
               * ⚠️ EXACT MATCH, unlike the chip's prefix test. On a legacy `?line=iPhone 17` the
               * chip should light up (it IS the iPhone line) but this row must not: it would read
               * as "all iPhones selected" while the feed shows only the 17s, and clicking it would
               * clear rather than broaden.
               */
              onClick={() => onPick(activeLine === line.key ? '' : line.key, 'all')}
              className={cn(menuRowCls, activeLine === line.key ? menuRowOn : menuRowOff)}
            >
              {/*
                ⛔ A TEMPLATE LITERAL IS NOT A tr() KEY. `tr(\`All ${line.label}\`, …)` compiles,
                renders, and is invisible to `scripts/gen-ui-strings.mjs`, which extracts STATIC
                pairs — so the string would never reach the generated catalogue and the Vietnamese
                would be carried only by whatever happened to be in this file. The static word and
                the brand's own line name are separate nodes.
              */}
              {tr('All', 'Tất cả')} {line.label}
              <CountChip count={line.count} className="ml-1" />
            </Button>
          }
        />
        {line.models.map((m) => (
          /**
           * ⚠️ NO `aria-pressed` ON A MENU ROW. Base UI gives these `role="menuitem"`, where
           * `aria-pressed` is not a valid state — a screen reader would announce a toggle that
           * the role does not define. Selection is carried visually and by the filter itself.
           */
          <DropdownMenuItem
            key={m.model}
            nativeButton
            // ⚠️ The row paints its own states, so the item's focus fill is cleared — but the
            // KEYBOARD cursor has to come back, or arrow-key navigation has no visible position.
            className="p-0 focus:bg-transparent data-highlighted:bg-card/70"
            render={
              <Button
                variant="bare"
                size="none"
                type="button"
                onClick={() => onPick('', activeModel === m.model ? 'all' : m.model)}
                className={cn(menuRowCls, activeModel === m.model ? menuRowOn : menuRowOff)}
              >
                {m.model}
                <CountChip count={m.count} className="ml-1" />
              </Button>
            }
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const menuRowCls = 'w-full shrink-0 justify-start gap-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-left text-sm font-semibold transition-colors cursor-pointer tap-44'
const menuRowOn = 'bg-card text-accent-foreground shadow-sm'
const menuRowOff = 'text-foreground hover:bg-card/70 hover:text-accent-foreground'
const chipCls = 'inline-flex w-full shrink-0 items-center justify-start gap-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-left text-sm font-semibold transition-colors duration-150 active:scale-100 cursor-pointer tap-44 relative'
// ⚠️ `text-foreground`, not `text-body`: measured on the tinted surfaces, `--body` falls below AA.
const chipOn = 'bg-card text-accent-foreground shadow-sm'
const chipOff = 'text-foreground hover:bg-card/70 hover:text-accent-foreground'

export function ModelCascade({ brandSlug, rows, activeLine, activeModel, onPick }: {
  brandSlug: string
  rows: ModelRow[]
  /** The current `?line=` prefix, or ''. */
  activeLine: string
  /** The current `?model=`, or 'all'. */
  activeModel: string
  /** `(line, model)` — at most one is set; both empty clears the filter. */
  onPick: (line: string, model: string) => void
}) {
  const { tr } = useLanguage()
  const lines = useMemo(() => buildLines(brandSlug, rows), [brandSlug, rows])
  const lineKeys = useMemo(() => (lines ?? []).map((l) => l.key), [lines])

  /**
   * ⚠️ A STALE SELECTION MUST CLEAR ITSELF. Change the price filter and the line a user picked can
   * vanish from `rows` entirely, leaving the feed filtered by something no chip shows. Guarded on
   * the value so it cannot loop even if the callback is not memoised.
   */
  const lastCleared = useRef('')
  /**
   * ⛔ THE GUARD CLEARS A STALE `line`, AND DELIBERATELY NEVER TOUCHES `model`. It used to do both,
   * folding aliases first so a raw spelling would still match — and it cleared the link anyway:
   * measured, `?model=Apple+Watch+S8` was wiped on arrival. Rather than keep guessing at why a
   * model is absent from `rows` (the models endpoint caps its list, the scope may differ, the
   * alias table may lag the catalogue), the guard simply stops adjudicating models.
   *
   * ⚠️ The asymmetry is the point. A stale `model` is VISIBLE — it names one product, the feed
   * shows that product or nothing, and the chip row clears it. A stale `line` is not: it filters
   * the feed while no chip can show or undo it, which is the case this guard exists for. Eating a
   * shared link is a worse failure than leaving a narrow filter on screen.
   */
  const orphaned = !!lines && !!activeLine && activeModel === 'all'
    && !lines.some((l) => activeLine === l.key || activeLine.startsWith(`${l.key} `))
  useEffect(() => {
    // Reset when healthy, or the guard fires once per value and a selection that goes stale a
    // second time is never cleared.
    if (!orphaned) { lastCleared.current = ''; return }
    if (lastCleared.current === activeLine) return
    lastCleared.current = activeLine
    onPick('', 'all')
  }, [orphaned, activeLine, onPick])

  if (!lines) return null

  return (
    <div className="flex shrink-0 items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-200">
      <span className="h-12 w-px shrink-0 bg-border" aria-hidden />
      {/*
        ⚠️ A GROUP OF TOGGLES, NOT A LISTBOX. An earlier version used role="listbox"/"option", which
        promises arrow-key roving focus this row does not implement — a screen-reader user would be
        told to navigate a way that does not work. Each chip is an independent control, and the
        dropdowns get real menu semantics from Base UI.
      */}
      <div
        role="group"
        aria-label={tr('Product line', 'Dòng sản phẩm')}
        className="grid max-h-[7.5rem] grid-flow-col grid-rows-3 auto-cols-max gap-x-1.5 gap-y-0.5 overflow-x-auto rounded-2xl bg-brand-50 p-1.5"
      >
        {lines.map((l) => (
          <LineChip key={l.key} line={l} lineKeys={lineKeys} activeLine={activeLine} activeModel={activeModel} onPick={onPick} />
        ))}
      </div>
    </div>
  )
}
