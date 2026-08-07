// Icon system tokens — the numeric law of docs/icon-language.md.
// Import these instead of retyping stroke widths / size classes: a hand-typed
// `strokeWidth={2.25}` is how tiers drift. Each constant names the tier it
// implements; the spec (docs/icon-language.md §2, §4) says when to use which.

/** §2 UI default — body-copy icons: meta rows, buttons, baked ui/* glyphs. */
export const STROKE_UI = 2

/**
 * §2 THE PLATFORM WEIGHT (owner-mandated) — all nav chrome at h-6/h-7:
 * header, bottom nav, section-header back, dashboard rail.
 */
export const STROKE_NAV = 2.25

/** §2 floating chevrons over content — back-to-top uses the min. */
export const STROKE_FLOAT = 2.5
/** §2 floating chevrons — rail scroll arrows use the max. */
export const STROKE_FLOAT_MAX = 2.75

/** §2 Check/Minus marks inside small filled boxes (checkbox, input-otp). */
export const STROKE_MARK = 3

/**
 * §2 display/data tier — category-tile artwork (CategoryIcon bakes it in) and
 * data/illustration SVGs. Thin because the 24-grid line scales with the box:
 * 1.5 at h-11 renders ~2.75px — the premium weight; 2 would render ~3.7px.
 */
export const STROKE_DISPLAY = 1.5

/**
 * §4 size ladder (16px dominant). Put the class on the svg itself — unsized
 * icons inside <Button iconSize> get size-4 via the :where rule; anywhere else
 * they'd render lucide's native 24px.
 */
export const ICON_SIZE = {
  /** 12px — micro-meta inside 2xs/3xs labels */
  xs: 'h-3 w-3',
  /** 14px — chip glyphs, dense meta */
  sm: 'h-3.5 w-3.5',
  /** 16px — THE DEFAULT: buttons, rows, menus */
  md: 'h-4 w-4',
  /** 20px — inputs, list leads, PDP action row */
  lg: 'h-5 w-5',
  /** 24px — header search-bar glyphs */
  xl: 'h-6 w-6',
  /** 28px — bottom-nav tabs, notification bell */
  nav: 'h-7 w-7',
  /** 44px — category tiles (display tier, via CategoryIcon only) */
  tile: 'h-11 w-11',
} as const

/**
 * §0/§6 the signature wash — the one brand-tinted interior region of an
 * artwork/active glyph. Line stays currentColor; only a closed region fills.
 * `WASH_ACTIVE` is the location-active (bottom-nav) form: it skips any icon
 * that already carries an explicit fill-* class (user-state fills win, §5).
 *
 * ⚠️ THIS IS THE **CHROME/INLINE** WASH, NOT THE CATEGORY-TILE ONE. Category
 * artwork went FULL duotone on 2026-08-07 (owner: "make sure your icons are
 * fully filled, i see some are half filled in categories") — see
 * `<CategoryIcon>`'s duotone layers. The one-closed-region law
 * survives only here: nav/rail location marks and the inline seal.
 */
export const WASH = 'fill-brand-100'
// Washes the FIRST PATH child only, not the whole svg: svg-level fill inherits
// into every child, and a glyph whose outline is drawn after its detail (e.g.
// Compass: needle path, then circle) would have the detail painted over by the
// filled outline. The first path is the interior/body region on all five nav
// glyphs (Compass needle, Heart body, MessageSquare bubble, User shoulders).
export const WASH_ACTIVE = "[&_svg:not([class*='fill-'])>path:first-of-type]:fill-brand-100"
// §0/§6 addendum (lead ruling, 2026-08-07): a glyph whose closed body is a
// MIRRORED PAIR (scale pans, binocular barrels, dumbbell plates) washes BOTH
// twins — the pair reads as ONE visual move, and washing a single side reads
// as a rendering error, not restraint. Lucide draws the twin bodies as the
// first two paths on these glyphs (Scale: pan, pan, beam, post), so this is
// WASH_ACTIVE plus the second path, under the same user-state guard (an
// explicit fill-* class on the icon still wins, §5). Location-active rows
// whose glyph is a mirrored pair (the rail's Scale row) take this instead of
// WASH_ACTIVE; single-body glyphs keep WASH_ACTIVE untouched.
export const WASH_ACTIVE_TWIN =
  "[&_svg:not([class*='fill-'])>path:first-of-type]:fill-brand-100 [&_svg:not([class*='fill-'])>path:nth-of-type(2)]:fill-brand-100"

