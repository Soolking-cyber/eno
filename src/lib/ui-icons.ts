/**
 * UI GLYPHS — the app's chrome, in two Solar weights.
 *
 * The files are generated: `npm run icons` (scripts/gen-icons.mjs) writes
 * `public/icons/ui/rest/<name>.svg` (Solar Outline) and `public/icons/ui/selected/<name>.svg`
 * (Solar Bold). This module is the only thing a renderer needs to know about them — a name in,
 * a public path out — and it is the sibling of `category-art.ts`, which does the same job for
 * the seventeen category tiles.
 *
 * ⚠️ THE NAMES HERE ARE OURS, NOT SOLAR'S. `search` is Solar's `magnifier`, `send` is `plane`,
 * `grid` is `widget`. That indirection is the point: a call site asks for what it MEANS, and the
 * mapping (with the reasoning for every non-obvious row) lives in one reviewable table in the
 * generator. Re-argue a glyph there, not here, and nothing at the call sites moves.
 *
 * ⚠️ THE ARTWORK IS MEANT TO BE INLINED, NOT `<img src>`-ed — same rule, same reason, as the
 * category artwork. Every file paints with `currentColor`, so inlining makes a control's own text
 * colour drive the ink in both themes and through hover/active/disabled. An `<img>` or a CSS
 * `background-image` isolates the file from the page's colour and all of that disappears.
 *
 * ⚠️ THREE GLYPHS WHOSE BOLD CHANGES THE MEANING, NOT JUST THE WEIGHT — `back`, `forward` AND
 * `chevron-down`. All three are chevrons at rest and SOLID TRIANGLES in Bold. On `back`/`forward`
 * that reads as play/rewind rather than navigation; on `chevron-down` a filled ▼ is a fine
 * dropdown caret in isolation, but a trigger written the obvious way —
 * `uiIconPath('chevron-down', open ? 'selected' : 'rest')` — swaps the mark's shape on open
 * rather than rotating it, which reads as a different control.
 *
 * Use `rest` for all three at every state. The `selected` files exist only because the generator
 * emits both weights for every row, and nothing enforces this: the paths resolve, and the suite
 * asserts only that the two weights DIFFER — which is exactly what lets these through.
 */
/** `rest` = Solar Outline, the idle control. `selected` = Solar Bold, the active one. */
export type UiIconState = 'rest' | 'selected'

/**
 * Every generated UI glyph. Kept in this order — grouped by what it does, not alphabetically —
 * because that is how the generator's table reads, and keeping the two aligned is what lets a
 * reviewer diff them by eye.
 *
 * ⚠️ THIS LIST IS A COPY OF THE GENERATOR'S, AND `ui-icons.test.ts` IS WHY THAT IS SAFE: the
 * suite stats `public/icons/ui/**` and fails if the two ever disagree in either direction.
 */
export const UI_ICON_NAMES = [
  // navigation + chrome
  'back',
  'forward',
  'chevron-down',
  'close',
  'menu',
  'more',
  'explore',
  'grid',
  // account + settings
  'account',
  'language',
  'theme-dark',
  'theme-light',
  // browse + search
  'search',
  'filters',
  'sort',
  'save-search',
  'saved',
  'map-pin',
  'views',
  // Added 2026-09-06 for the native app, which needed six glyphs the web had never had to name.
  // They generate into the same two weights as everything else, so the web can use them too.
  'ai',
  'business',
  'money',
  'settings',
  'urgent',
  'video-off',
  // listing + composing
  'post',
  'edit',
  'camera',
  'gallery',
  'play',
  'attach',
  'offer',
  'rating',
  'verified',
  // trust — Solar's shield family (owner, 2026-08-12: "trust badge use solar pack minimalistic
  // shield ... for different types of shiel with tick or other shields seach from solar icon pack
  // already exists"). `trust-shield` is deliberately EMPTY inside: trust-score.tsx draws the
  // score at its optical centre, so a shield carrying its own tick would collide with the numeral.
  'trust-shield',
  'shield-verified',
  'shield-warning',
  'shield-star',
  'shield-user',
  // messaging + contact
  'messages',
  'send',
  'phone',
  'share',
  'copy',
  'bell',
  // state + feedback
  'success',
  'error',
  'info',
  'retry',
  'time',
  'calendar',
] as const

export type UiIconName = (typeof UI_ICON_NAMES)[number]

/** The three whose Bold changes the MARK rather than its weight — see the header. Exported
 *  so a renderer that swaps weights by state can refuse to do it for these. */
export const REST_ONLY_ICONS: readonly UiIconName[] = ['back', 'forward', 'chevron-down']

const NAMES: ReadonlySet<string> = new Set(UI_ICON_NAMES)

/** Narrowing guard — `true` when this name has generated artwork. */
export function hasUiIcon(name: string): name is UiIconName {
  return NAMES.has(name)
}

/**
 * The public path for a glyph, or `null` when there is none. A caller that gets `null` must fall
 * back to its lucide equivalent rather than render nothing — the same contract as
 * `categoryArtPath`, and for the same reason: a broken `<img>` is worse than the old glyph.
 */
export function uiIconPath(name: string, state: UiIconState): string | null {
  if (!hasUiIcon(name)) return null
  // ⚠️ THE THREE CHEVRONS ARE COERCED TO `rest`, DELIBERATELY. Their Bold is a solid triangle —
  // a different MARK, not a heavier one — so the natural generic renderer,
  // `uiIconPath(name, active ? 'selected' : 'rest')`, would swap a back arrow for a rewind
  // button and a dropdown caret for a play button. Writing that down in a comment and exporting
  // a list did not stop it; all three reviewers pointed out that nothing enforced it. Coercing
  // here makes the generic renderer correct for all forty names, which is the whole point of
  // having one. Signal the active state on these with rotation or colour, as a chevron expects.
  const resolved = REST_ONLY_ICONS.includes(name) ? 'rest' : state
  return `/icons/ui/${resolved}/${name}.svg`
}
