'use client'

import { useMemo, useEffect, useRef } from 'react'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { CountChip } from './count-chip'
import { splitModel, byNewest, type ModelParts } from '@/lib/model-lineage'
import { linesFor, canonicalModel } from '@/generated/model-lineage'

/**
 * MODEL CASCADE — brand -> LINE -> GENERATION -> VARIANT, as columns rolling out to the right of
 * the brand tile, each a step deeper into the brand blue.
 *
 * ⚠️ IT DEGRADES TO THE FLAT MODEL GRID AND THAT IS THE POINT. A brand with one line gets exactly
 * the single list it had before: `buildCascade` returns null and the rail keeps its old grid.
 * Inside branded stock 9,840 of 14,923 listings carry a model, so a third of these rows would sit
 * under an empty cascade if every level were forced.
 *
 * ⚠️ DEPTH IS PAINTED WITH THE BRAND RAMP, NOT WITH OPACITY. brand-50 -> brand-100 -> brand-150,
 * each defined per theme, so "deeper" means distance from the canvas: darker in light, LIGHTER in
 * dark. An opacity stack compounds against whatever is behind it and inverts in dark mode.
 *
 * ⛔ A SELECTION IS A PREFIX, NOT A LIST OF MODELS. Picking "iPhone" sets `?line=iPhone`; its 17
 * sets `?line=iPhone 17`; Pro Max sets `?model=iPhone 17 Pro Max`, the exact string `?model=` has
 * always meant. The first build put every matching model string in the URL — ~200 of them for
 * Apple's iPhone line — which reviewers called unshareable, and which a 60-entry cap then
 * silently truncated.
 */

type ModelRow = { model: string; count: number }

/** One selectable cell. `prefix` is what the URL carries; `exact` marks a leaf (a real model). */
type Cell = { key: string; label: string; count: number; prefix: string; exact: boolean }

type Cascade = {
  lines: Cell[]
  gensFor: (line: string) => Cell[]
  variantsFor: (line: string, gen: string) => Cell[]
}

/**
 * ⛔ A PLAIN FUNCTION, NOT A HOOK. As `useCascade` it would sit above the parent's early return,
 * which is the rules-of-hooks trap; worse, an earlier version's reset effect listed the pick
 * callback in its deps, so an un-memoised prop from the rail re-ran it every render and cleared
 * the filter forever. Both were review findings.
 */
function buildCascade(brandSlug: string, rows: ModelRow[]): Cascade | null {
  if (rows.length < 3) return null
  const known = linesFor(brandSlug)

  /**
   * ⚠️ FOLD ALIASES BEFORE GROUPING, NEVER AFTER. "Apple Watch S8" and "Apple Watch Series 8" are
   * one product written twice; grouped raw they become two cells with split counts, and the picker
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
  if (byLine.size < 2) return null

  const total = (es: { count: number }[]) => es.reduce((n, e) => n + e.count, 0)

  const lines: Cell[] = [...byLine.entries()]
    .map(([line, es]) => ({
      key: line,
      label: line,
      count: total(es),
      /**
       * ⚠️ A ONE-MODEL LINE CARRIES ITS MODEL STRING, NOT ITS OWN NAME. With `prefix: line` a
       * leaf would write `?model=<line name>`, which is only ever right when the line name and
       * the model string happen to be identical — true for "Sport Band" today, and false the
       * moment the catalogue gains a "Sport Band Blue". Both reviewers flagged the shape.
       */
      prefix: es.length === 1 ? es[0].parts.raw : line,
      exact: es.length === 1,
    }))
    .sort((a, b) => b.count - a.count)

  const gensFor = (line: string): Cell[] => {
    const es = byLine.get(line) ?? []
    const byGen = new Map<string, typeof es>()
    for (const e of es) {
      const k = e.parts.genLabel ?? ''
      if (!byGen.has(k)) byGen.set(k, [])
      byGen.get(k)!.push(e)
    }
    /**
     * ⚠️ ONE GENERATION IS NOT "NO COLUMN". Returning [] here also killed the VARIANT column
     * below it, so a line whose models all share a generation ("MacBook Pro 14" / "16") had every
     * child unreachable — the user could select the line and nothing else. Only collapse when
     * there is genuinely nothing to choose between.
     */
    if (byGen.size < 2 && es.length < 2) return []
    return [...byGen.entries()]
      .map(([g, gs]) => ({
        key: g || line,
        /**
         * ⚠️ NO GENERATION MEANS LABEL IT WITH THE LINE ALONE. Building `${line} ${gen}` when the
         * two were the same printed "iPhone iPhone" for every unnumbered entry (Xr, Xs) — both
         * reviewers hit it. `genLabel` is empty for those, so the label falls back cleanly.
         */
        label: g ? `${line} ${g}` : line,
        count: total(gs),
        // An unnumbered group is not a prefix anyone can filter on — use its one real model.
        prefix: g ? `${line} ${g}` : gs[0].parts.raw,
        exact: !g && gs.length === 1,
        _p: gs[0].parts,
      }))
      .sort((a, b) => byNewest(a._p, b._p))
      .map(({ _p, ...c }) => c)
  }

  const variantsFor = (line: string, gen: string): Cell[] => {
    const want = gen === line ? '' : gen
    const es = (byLine.get(line) ?? []).filter((e) => (e.parts.genLabel ?? '') === want)
    /**
     * ⚠️ TWO OR MORE ENTRIES, not two or more carrying a SUFFIX. Gating on `variant` hid the
     * column for "iPhone 17" beside "iPhone 17 Pro", where the plain one IS one of the choices.
     */
    if (es.length < 2) return []
    return es
      .map((e) => ({ key: e.parts.raw, label: e.parts.raw, count: e.count, prefix: e.parts.raw, exact: true }))
      .sort((a, b) => a.label.length - b.label.length || a.label.localeCompare(b.label))
  }

  return { lines, gensFor, variantsFor }
}

/** True when this brand has a hierarchy worth drilling — the rail asks before replacing its grid. */
export function hasCascade(brandSlug: string, rows: ModelRow[]): boolean {
  return buildCascade(brandSlug, rows) !== null
}

const DEPTH = ['bg-brand-50', 'bg-brand-100', 'bg-brand-150'] as const

function Column({ cells, active, depth, onPick, label }: {
  cells: Cell[]
  active: string | null
  depth: 0 | 1 | 2
  onPick: (cell: Cell | null) => void
  label: string
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-200">
      <span className="h-12 w-px shrink-0 bg-border" aria-hidden />
      {/*
        ⚠️ A GROUP OF TOGGLES, NOT A LISTBOX. The first version used role="listbox"/"option", which
        promises arrow-key roving focus that is not implemented — a screen-reader user would be told
        to navigate a way that does not work. These are independent toggles, so `aria-pressed`
        states them honestly, and it matches the brand rail beside it.
      */}
      <div
        role="group"
        aria-label={label}
        className={cn(
          'grid max-h-[7.5rem] grid-flow-col grid-rows-3 auto-cols-max gap-x-1.5 gap-y-0.5 overflow-x-auto rounded-2xl p-1.5',
          DEPTH[depth],
        )}
      >
        {cells.map((c) => {
          const on = active === c.key
          return (
            <Button
              key={c.key}
              variant="bare"
              size="none"
              aria-pressed={on}
              onClick={() => onPick(on ? null : c)}
              className={cn(
                'w-full shrink-0 justify-start gap-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-left text-sm font-semibold transition-colors cursor-pointer',
                // ⚠️ `text-foreground`, NOT `text-body`: measured on the deepest column in dark
                // mode, `--body` gives 2.84:1, below AA. The selected cell goes to `card`, which IS
                // the page canvas, so it reads as a cut-out rather than another blue.
                on ? 'bg-card text-accent-foreground shadow-sm' : 'text-foreground hover:bg-card/70 hover:text-accent-foreground',
              )}
            >
              {c.label}
              <CountChip count={c.count} className="ml-1" />
            </Button>
          )
        })}
      </div>
    </div>
  )
}

export function ModelCascade({ brandSlug, rows, activeLine, activeModel, onPick }: {
  brandSlug: string
  rows: ModelRow[]
  /** The current `?line=` prefix, or '' — so a shared link opens with its columns already set. */
  activeLine: string
  /** The current `?model=`, or 'all'. */
  activeModel: string
  /** `(line, model)` — at most one is set; both empty clears the filter. */
  onPick: (line: string, model: string) => void
}) {
  const { tr } = useLanguage()
  const cascade = useMemo(() => buildCascade(brandSlug, rows), [brandSlug, rows])

  /**
   * ⚠️ THE OPEN COLUMNS ARE DERIVED FROM THE URL, NOT FROM LOCAL STATE, so a shared link opens
   * with the right ones showing and Back works. An earlier version kept `line`/`gen` in
   * `useState` and cleared them in an effect, which wiped the filter on mount and could not
   * restore a link at all.
   */
  const selected = activeModel !== 'all' ? activeModel : activeLine

  const line = useMemo(() => {
    if (!cascade || !selected) return null
    return cascade.lines.find((l) => selected === l.key || selected.startsWith(`${l.key} `))?.key ?? null
  }, [cascade, selected])

  const gens = useMemo(() => (cascade && line ? cascade.gensFor(line) : []), [cascade, line])

  const gen = useMemo(() => {
    if (!selected || !line) return null
    return gens.find((g) => selected === g.prefix || selected.startsWith(`${g.prefix} `))?.key ?? null
  }, [gens, selected, line])

  const variants = useMemo(
    () => (cascade && line && gen ? cascade.variantsFor(line, gen) : []),
    [cascade, line, gen],
  )

  /**
   * ⚠️ A STALE SELECTION MUST CLEAR ITSELF. Change the price filter and the line a user picked can
   * vanish from `rows` entirely, leaving the feed filtered by something no column shows. Guarded
   * on the value so it cannot loop even if the callback is not memoised.
   */
  const lastCleared = useRef('')
  useEffect(() => {
    if (!cascade || !selected || line || lastCleared.current === selected) return
    lastCleared.current = selected
    onPick('', 'all')
  }, [cascade, selected, line, onPick])

  if (!cascade) return null

  /** A leaf writes `?model=` (exact, unchanged semantics); a branch writes `?line=` (a prefix). */
  const pick = (c: Cell | null, fallback: string) => {
    if (!c) return onPick(fallback, 'all')
    return c.exact ? onPick('', c.prefix) : onPick(c.prefix, 'all')
  }

  return (
    <>
      <Column
        label={tr('Product line', 'Dòng sản phẩm')}
        cells={cascade.lines}
        active={line}
        depth={0}
        onPick={(c) => pick(c, '')}
      />
      {gens.length > 0 && (
        <Column
          label={tr('Generation', 'Thế hệ')}
          cells={gens}
          active={gen}
          depth={1}
          onPick={(c) => pick(c, line ?? '')}
        />
      )}
      {variants.length > 0 && (
        <Column
          label={tr('Variant', 'Phiên bản')}
          cells={variants}
          active={activeModel !== 'all' ? activeModel : null}
          depth={2}
          onPick={(c) => pick(c, gens.find((g) => g.key === gen)?.prefix ?? line ?? '')}
        />
      )}
    </>
  )
}
