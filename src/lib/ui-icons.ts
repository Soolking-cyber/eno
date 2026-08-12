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
 * ⚠️ TWO GLYPHS WHOSE BOLD CHANGES THE MEANING, NOT JUST THE WEIGHT. `back` and `forward` are
 * chevrons at rest and SOLID TRIANGLES in Bold, which read as play/rewind rather than as
 * navigation. Use `rest` for those at every state; the selected file exists only because the
 * generator emits both weights for every row.
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
  return hasUiIcon(name) ? `/icons/ui/${state}/${name}.svg` : null
}
