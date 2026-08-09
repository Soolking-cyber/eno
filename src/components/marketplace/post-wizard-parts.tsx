'use client'

// Presentational pieces of the PostWizard, moved out verbatim to keep post-wizard.tsx focused
// on flow/state. All pure (props in, JSX out), hoisted to module scope so React keeps stable
// component identity across the wizard's frequent re-renders (a keystroke must not remount
// these subtrees). No behaviour change from the in-file versions.

import { useId } from 'react'
import { Cog, Ellipsis, ImagePlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STROKE_DISPLAY, STROKE_UI } from '@/lib/icon-tokens'
import { Button } from '@/components/ui/button'
import {
  Field as UiField,
  FieldLabel,
  FieldDescription,
  FieldError,
} from '@/components/ui/field'
import { useLanguage } from '@/context/language-context'
import { CategoryIcon, CategoryGlyphArt } from './category-icons'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'

export function PublishButton({
  className,
  onSubmit,
  canSubmit,
  submitting,
  edit,
  missingCount,
  t,
}: {
  className?: string
  onSubmit: () => void
  canSubmit: boolean
  submitting: boolean
  edit: boolean
  missingCount: number
  t: (vi: string, en: string) => string
}) {
  return (
    <Button variant="cta" size="none"
      onClick={onSubmit}
      // NOT disabled when fields are missing — a click then reveals what's left
      // (disabled submit hides the reason). Only blocked mid-submit.
      disabled={submitting}
      // ⛔ NO `aria-disabled={!canSubmit}` — it was a lie, and once `opacity-70` went it was the
      // only remaining one. The control IS actionable with fields outstanding: that is the whole
      // design, a tap runs scrollToMissing and reveals what is left. `aria-disabled` told assistive
      // tech "unavailable" about a button that works, and it now told them the opposite of what
      // sighted users see. Incompleteness is carried by the count badge, which every user gets.
      // A reviewer caught the mismatch after the dimming was removed.
      // ⛔ NO `opacity-70` WHEN FIELDS ARE MISSING. It used to dim the button on exactly the
      // screens where the seller most needs to believe it works, and it contradicted the line
      // above it: this button is DELIBERATELY not disabled, because a tap is what reveals what's
      // left. Affordance and behaviour were arguing — the thing looked dead and wasn't — at the
      // single highest-drop-off moment in the product, the last step of the seller funnel.
      // Incompleteness is now carried by the count badge in the label, which states the same fact
      // without lying about whether the control works.
      className={cn('w-full rounded-xl px-7 py-3 text-sm transition-colors disabled:opacity-40 disabled:pointer-events-none cursor-pointer', className)}
    >
      {submitting
        ? (edit ? t('Đang lưu…', 'Saving…') : t('Đang đăng…', 'Posting…'))
        : (
          // ⚠️ THE LABEL IS ALWAYS A VERB. It used to read "6 left to finish" — a COUNT where the
          // primary action belongs, so the button stopped naming what it does at the exact moment
          // the seller is deciding whether to bother. The verb stays put and the count rides
          // alongside as a badge: same information, but the button still says what pressing it is
          // for. `tabular-nums` so the badge does not reflow the label as the count ticks down.
          <span className="inline-flex items-center justify-center gap-2">
            {edit ? t('Lưu thay đổi', 'Save changes') : t('Đăng tin', 'Publish listing')}
            {missingCount > 0 && (
              <span
                aria-label={t(`Còn ${missingCount} mục chưa xong`, `${missingCount} still needed`)}
                // ⚠️ `bg-white/20` ASSUMES THIS BUTTON IS DARK, and that holds only because
                // `variant="cta"` is the solid brand fill — measured rgb(10,102,194). It is a
                // scrim on the button's own ink, not a themed surface, which is why it is white
                // rather than a token. If this button ever takes a light variant the badge
                // disappears, and with the dimming gone there would then be NO incompleteness
                // signal at all. Change the variant, change this.
                className="inline-flex min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 py-0.5 text-2xs font-bold tabular-nums"
              >
                {missingCount}
              </span>
            )}
          </span>
        )}
    </Button>
  )
}

export function Section({ title, hint, children, id }: { title: string; hint?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="space-y-3 scroll-mt-24">
      <div>
        <h2 className="h-section text-foreground">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

/** The wizard's field wrapper — the label/hint/error frame every step reuses.
 *
 *  ## What it used to be, and why that was the worst bug in the form
 *  A `<div>` with a bare `<label>` that had no `htmlFor` and wrapped nothing. A dangling label
 *  names NOTHING: title, description, brand, model, condition, contact name and phone all
 *  rendered a visible label that assistive tech could not connect to any input. The `id` prop
 *  landed on the WRAPPER, so it couldn't rescue the association either, and no control ever
 *  reported `aria-invalid` — the red text sat beside a field that still announced as valid.
 *
 *  Now it is `ui/field` (Base UI `Field.Root`): the label registers itself with the control, the
 *  hint and the error register as descriptions, and `invalid` sets `aria-invalid`. The call sites
 *  keep the same props — they only have to pass their control through `<FieldControl render={…}>`
 *  so Field knows which element to bind to.
 *
 *  ⚠️ Hint and error now render TOGETHER (they used to be a ternary — one XOR the other). Base UI
 *  merges both ids into a single `aria-describedby`, and the phone field genuinely wants both
 *  ("buyers never see it until you reply" AND "add a valid number").
 *
 *  ⚠️ `group` — Base UI's `Field.Control` needs a LABELABLE element (input/textarea/select). The
 *  chip grids, the sale/rent toggle and `RangeSpecInput` are none of those, so a `Field.Label`
 *  there would dangle exactly like the old one. Those pass `group` and get the same wiring by
 *  hand on a `role="group"`: `aria-labelledby` → the label, `aria-invalid`, `aria-describedby` →
 *  the hint + error. Same contract, no lie about being an input.
 *
 *  ⚠️ `id` lands on the WRAPPER (it always did). `scrollToMissing()` in post-wizard.tsx looks up
 *  `pw-description` / `pw-condition` / `pw-details` as SCROLL anchors, so that must not move. The
 *  one id that has to be on the control itself is `pw-title` — it is passed to `<FieldControl>`
 *  there, not to this wrapper.
 */
export function Field({ id, label, counter, hint, error, group, children }: { id?: string; label: string; counter?: string; hint?: string; error?: string; group?: boolean; children: React.ReactNode }) {
  const uid = useId()
  const labelId = `${uid}-label`
  const hintId = `${uid}-hint`
  const errorId = `${uid}-error`

  if (group) {
    const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
    return (
      <div id={id} className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span id={labelId} className="text-sm font-semibold text-foreground">{label}</span>
          {counter && <span className="text-2xs text-ink-4">{counter}</span>}
        </div>
        {/* aria-invalid is not a supported prop on role="group" (jsx-a11y/role-supports-aria-props),
            and screen readers ignore it there — the error reaches AT via aria-describedby → the
            role="alert" message below. */}
        <div role="group" aria-labelledby={labelId} aria-describedby={describedBy}>
          {children}
        </div>
        {hint && <p id={hintId} className="text-xs text-muted-foreground">{hint}</p>}
        {/* Nothing focuses a chip grid on a failed publish, so the message is announced
            (role="alert") as well as being the group's description. */}
        {error && <p id={errorId} role="alert" className="text-xs font-semibold text-destructive">{error}</p>}
      </div>
    )
  }

  return (
    <UiField id={id} invalid={!!error}>
      <div className="flex items-center justify-between">
        <FieldLabel className="font-semibold">{label}</FieldLabel>
        {counter && <span className="text-2xs text-ink-4">{counter}</span>}
      </div>
      {children}
      {hint && <FieldDescription className="text-muted-foreground">{hint}</FieldDescription>}
      {/* FieldError has match={true} baked in — it renders whenever the CALLER says so.
          Never render it unconditionally: this app validates in React state, not native
          validity, so an always-mounted error would show an empty description. */}
      {error && <FieldError className="font-semibold">{error}</FieldError>}
    </UiField>
  )
}

/** R2 semantic fixes for the vehicles subcategory row (blind critic 2026-08-06;
 *  lead ruling 2026-08-07). 'Xe máy' (was a speedometer) is fixed AT THE REGISTRY —
 *  bespoke motorbike artwork under the existing 'Gauge' key in category-icons.tsx —
 *  so the rentals picker and every browse mount heal with it. The two entries here
 *  CANNOT be fixed there, because their taxonomy strings are SHARED keys whose other
 *  meanings are correct: 'Wrench' is also the Dịch vụ listing type AND the Services
 *  category (registry-level cog artwork would re-collide all three on this very
 *  screen), and 'Truck' is also Chuyển nhà (moving), where a truck is the right
 *  glyph. Taxonomy icon strings are DB-mirrored and immutable, so the SLUG — the one
 *  unambiguous coordinate — picks the artwork at this mount only: Phụ tùng = Cog
 *  ('Phụ tùng' reused the identical wrench as 'Dịch vụ' in the same viewport),
 *  Khác = Ellipsis ('Khác' drew a truck, which read "Trucks" and invited
 *  miscategorization). Foundation request filed: mint distinct registry keys + DB
 *  migration (e.g. parts-gear → 'Cog', vehicle-other → 'Ellipsis') so this map can
 *  be deleted. */
const SUB_GLYPH_FIX: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  'parts-gear': Cog,
  'vehicle-other': Ellipsis,
}

/** Resolves a picker option's glyph: the slug-keyed artwork fix above when one exists,
 *  otherwise the shared registry (same glyph family as the home grid / browse rail).
 *  ⚠️ BOTH BRANCHES RENDER THE SAME DUOTONE. The fix branch used to draw a bare lucide
 *  svg with a hand-picked wash region, which is exactly the half-filled look the owner
 *  called out (2026-08-07): Ellipsis had no closed region at all, so 'Khác' sat hollow
 *  in a row of tinted siblings. `CategoryGlyphArt` is `CategoryIcon` minus the registry
 *  lookup — one silhouette rule, key or no key. */
function PickerGlyph({ slug, name, className, stroke, selected }: { slug: string; name: string; className?: string; stroke?: number; selected?: boolean }) {
  const Fix = SUB_GLYPH_FIX[slug]
  // ⚠️ `selected` reaches BOTH branches. A slug-fixed option (Phụ tùng, Khác) is picked the
  // same way its neighbours are, so if only the registry branch filled, the two fixed chips
  // would be the only ones in the row that never light up — the half-filled row the owner
  // rejected, reintroduced through the back door.
  if (!Fix) return <CategoryIcon name={name} className={className} stroke={stroke} selected={selected} />
  return <CategoryGlyphArt Icon={Fix} className={className} stroke={stroke} selected={selected} />
}

/** Single-pick chip row. `icon` (a CategoryIcon registry name — subcategories and
 *  listing types carry one in the taxonomy) renders the same glyph family the home
 *  grid and browse rail use, at the §4 chip step (14px) re-tiered to the UI stroke.
 *  Text-only options (condition, attribute facets) simply pass no icon. */
export function Chips({ options, value, onPick }: { options: { value: string; label: string; icon?: string }[]; value: string; onPick: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Button
          variant="bare"
          size="none"
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onPick(o.value)}
          className={cn('gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer', value === o.value ? 'bg-primary text-white' : 'text-body hover:bg-muted')}
        >
          {o.icon && (
            // Fill marks the pick (owner, 2026-08-07: "use icons filling only when selected").
            // `value === o.value` is the same comparison that paints the pill and sets
            // aria-pressed above — the glyph cannot drift out of sync with either.
            // ⚠️ The `[--color-brand-100:transparent]` that used to be here is deleted, not
            // moved: it neutralized the (then unconditional) wash on exactly the chip that now
            // has to fill. Re-adding it disables this whole mechanism on the row.
            <PickerGlyph
              slug={o.value}
              name={o.icon}
              stroke={STROKE_UI}
              selected={value === o.value}
              className="h-3.5 w-3.5 shrink-0"
            />
          )}
          {o.label}
        </Button>
      ))}
    </div>
  )
}

export function Preview({ cover, title, price, priceUnit, area, categoryIcon, t }: { cover?: string; title: string; price: string; priceUnit: string; area: string; categoryIcon?: string; t: (vi: string, en: string) => string }) {
  const { lang } = useLanguage() // preview price mirrors what buyers in this language will see
  return (
    <div className="w-full">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-tint">
        {cover ? (
          <img src={cover} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {/* Category chosen → its tile glyph at the display tier (h-11), exactly like a
                no-photo listing card — and like that card it stays PURE LINE. This canvas
                simulates the buyer's card; nothing on it is being picked, so a fill here would
                spend the one selection cue on a preview and stop meaning "chosen" in the picker
                twelve inches above it (listing-card.tsx mounts the same glyph unselected).
                No category yet → the chrome coin
                (icon-language §6): this canvas is the largest icon moment on the surface
                and the first-run state was its only family-less glyph — a dead gray lucide
                on gray, while the sibling state renders fully branded. The coin mirrors
                ui/empty-state's badge byte-for-byte (h-16 brand-50 disc, h-8 brand glyph
                at the display stroke) — same "nothing here yet, still eno" language.
                Never the registry's HelpCircle fallback, which read as a bug ("?"). */}
            {categoryIcon ? (
              <CategoryIcon name={categoryIcon} className="h-11 w-11 text-ink-4" />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
                <ImagePlus strokeWidth={STROKE_DISPLAY} className="h-8 w-8 text-brand" />
              </span>
            )}
          </div>
        )}
      </div>
      <h3 className="mt-2 line-clamp-2 text-sm font-medium leading-snug text-foreground">{title || t('Tiêu đề tin của bạn', 'Your listing title')}</h3>
      <p className="mt-0.5 text-sm font-bold text-foreground">
        {price ? formatMoneyFull(Number(price), '₫', moneyLocale(lang)) : t('Giá', 'Price')}{price && priceUnit ? <span className="font-normal text-ink-4"> {priceUnit}</span> : null}
      </p>
      {area && <p className="text-xs text-muted-foreground">{area}</p>}
    </div>
  )
}
