'use client'

import { Slider as SliderPrimitive } from '@base-ui/react/slider'
import { cn } from '@/lib/utils'

/** THE dual-thumb range slider primitive — sibling of `<Slider>` (single handle).
 *  Don't re-roll two stacked `<input type="range">`s; import this.
 *
 *  Now a real Base UI `Slider.Root` with TWO `Slider.Thumb` children. Base UI's slider
 *  is natively multi-thumb (`value: number | readonly number[]`), which deletes the
 *  entire hand-rolled contract this file used to carry:
 *
 *  - the `.eno-range` `pointer-events: none` hack that let both overlapping native
 *    inputs stay grabbable (Base UI's thumbs are separate absolutely-positioned divs —
 *    they never overlap the whole track, so nothing has to be made pointer-transparent);
 *  - the `onPointerDown` track-jump with its `tagName === 'INPUT'` guard (`Slider.Control`
 *    press-to-move-the-nearest-thumb is built in, and it starts a drag from that press);
 *  - the manual `Math.min(v, hi)` / `Math.max(v, lo)` clamps on every path.
 *
 *  In exchange we get what the hand-roll never had: Home/End/PageUp/PageDown, `largeStep`
 *  (Shift+Arrow), proper `aria-valuenow`/`aria-valuetext` per thumb, RTL, form/Field
 *  integration and touch handling.
 *
 *  ## The no-crossing guard
 *  `minStepsBetweenValues={0}` + `thumbCollisionBehavior="none"` reproduce the OLD rule
 *  exactly: a thumb is clamped to its neighbour and stops there (`lo <= hi`, equality
 *  ALLOWED, neighbour never dragged along).
 *   - `0`, not `1`: one step of forced separation would make `lo === hi` unreachable, and
 *     both call sites permit it (a "2020–2020" year facet is a legitimate filter, and the
 *     price panel's type-in boxes can land there). Base UI still cannot cross with 0 —
 *     `getSliderValue()` clamps a thumb between its neighbours on every keyboard/input path.
 *   - `"none"`, not the default `"push"`: `push` would shove the OTHER thumb along when
 *     you drag one past it. The old slider clamped instead and left the other value alone.
 *
 *  `onChange` fires live during the drag (cheap: local state). `onCommit` fires when the
 *  interaction settles — pointer-up, key-up, track press — and is where the expensive work
 *  belongs (URL writes, refetches), which is what both call sites already do.
 *  Styling mirrors `ui/slider.tsx` (`.eno-thumb` is the div-thumb twin of the
 *  `::-webkit-slider-thumb` rule `.eno-slider` uses) so the two read as one family.
 */
export function RangeSlider({
  value, min, max, step = 1, onChange, onCommit, className, thumbAriaLabels: ariaLabel,
}: {
  value: [number, number]
  min: number
  max: number
  step?: number
  onChange: (value: [number, number]) => void
  /** Settle callback: pointer-up / key-up / track press. */
  onCommit?: (value: [number, number]) => void
  className?: string
  /** [minLabel, maxLabel] — one string per thumb; each is applied as the individual
   *  Slider.Thumb's own `aria-label` below. NOT a DOM `aria-label` (that must be a string),
   *  so this deliberately does NOT reuse the `aria-label` name — an array there is a valid
   *  per-thumb API but jsx-a11y/aria-proptypes reads the JSX literally and false-flags it. */
  thumbAriaLabels?: [string, string]
}) {
  // Degenerate bounds: the price panel's histogram can hold a single price, i.e.
  // dataMin === dataMax. Base UI divides by (max - min) and an infinite percentage
  // hides the thumb outright; the old code guarded the same case with
  // `span = Math.max(step, max - min)`. Keep one step of span so the control still renders.
  const hiBound = max > min ? max : min + step

  // Defensive sanitise: Base UI wants an ASCENDING, in-bounds pair (its indicator spans
  // values[0]→values[n-1], so a descending pair would paint a negative width). A native
  // <input type="range"> used to absorb this by clamping its own display. Both call sites
  // already clamp, so this only ever fires on a malformed URL.
  const clamp = (n: number) => Math.min(Math.max(n, min), hiBound)
  const lo = clamp(value[0])
  const hi = Math.max(lo, clamp(value[1]))
  const values: [number, number] = [lo, hi]

  return (
    <SliderPrimitive.Root
      // Base UI defaults to center alignment, which lets a 20px thumb overhang the rail by
      // 10px at min/max — and BOTH call sites open with the thumbs at exactly those extremes.
      // The native inputs this replaced inset their thumbs (edge). Matches ui/slider.
      thumbAlignment="edge"
      value={values}
      min={min}
      max={hiBound}
      step={step}
      minStepsBetweenValues={0}
      thumbCollisionBehavior="none"
      // Degenerate range (max <= min — a single-price histogram): hiBound widens the RAIL to
      // min+step so Base UI has somewhere to draw, but the values that escape must still be
      // clamped to the real `max`. Without this, a user could drag to min+step and write a
      // filter bound one step ABOVE the only price that exists — excluding the sole matching
      // listing. The native inputs this replaced were simply immovable there.
      onValueChange={(v) => onChange([Math.min(v[0], max), Math.min(v[1], max)])}
      onValueCommitted={(v) => onCommit?.([Math.min(v[0], max), Math.min(v[1], max)])}
      className={cn(className)}
    >
      {/* Control = the 20px-tall hit area (the old wrapper's `h-5 cursor-pointer`).
          touch-none is required by Base UI: without it a scroll gesture cancels the
          pointer capture mid-drag and the thumb is dropped. */}
      <SliderPrimitive.Control className="relative flex h-5 w-full cursor-pointer touch-none items-center select-none">
        <SliderPrimitive.Track className="h-1.5 w-full rounded-full bg-line-strong">
          {/* Indicator = the old blue fill div; Base UI positions it between the two
              thumbs itself (inset-inline-start + width, height: inherit from Track). */}
          <SliderPrimitive.Indicator className="rounded-full bg-primary" />
          <SliderPrimitive.Thumb index={0} aria-label={ariaLabel?.[0]} className="eno-thumb" />
          <SliderPrimitive.Thumb index={1} aria-label={ariaLabel?.[1]} className="eno-thumb" />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}
