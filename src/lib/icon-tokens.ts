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


/**
 * THE ✕ CLOSE MARK'S GLYPH, BY BUTTON SIZE — consumed by ui/close-button.tsx, which is the only
 * place a close mark should be sized (D-CLOSE, 2026-09-29). Two rules, because the two variants put
 * the mark in two different boxes:
 *   ghost   — the mark FILLS its button (owner, 2026-08-26, 43dd9bcf: "make this icon fit its
 *             outline everywhere"). Solar's ✕ inks 90% of its box, so glyph = round((button − 2) / 0.9)
 *             lands ~1px of ink inside the edge: 28→29, 32→33, 36→38, 40→42 (24→24 by the same rule).
 *   overlay — the glyph wears a plate (`.plate-host svg`, 3px padding, box-content), so the plate is
 *             the glyph + 6 and must equal the button: glyph = button − 6. Measured twice before this
 *             table existed: the post wizard's photo-tile remove (24 → 18) and the lightbox close
 *             (40 → 34, listing-gallery.tsx).
 * ⚠️ 0.9 IS THIS GLYPH'S NUMBER. Never size another icon from the ghost row.
 */
export const CLOSE_GLYPH = {
  ghost: { '2xs': 'size-6', xs: 'size-[29px]', sm: 'size-[33px]', md: 'size-[38px]', lg: 'size-[42px]' },
  overlay: { '2xs': 'size-[18px]', xs: 'size-[22px]', sm: 'size-[26px]', md: 'size-[30px]', lg: 'size-[34px]' },
} as const

/**
 * OWNER-MEASURED GLYPH FITS OFF THE ICON_SIZE LADDER — the only arbitrary icon sizes design-lint
 * accepts outside ui/close-button.tsx (D-LINT, 2026-09-29). Each is a mark sized to FILL a plate or a
 * button by measurement, so it is a number with a reason, not drift:
 *   X             29/33/38/42 — the ghost ✕ rule above, still hand-typed where CloseButton has not
 *                 reached yet; 34 — the lightbox close on its overlay plate (listing-gallery.tsx).
 *   Plus          29 — the add-circle on the 28px avatar/logo plate (profile editors), same arithmetic;
 *                 42 — the Post coin's plus on its 40px disc (mobile-nav.tsx).
 *   SupportDialog 46 — the floating support mark (support-button.tsx; dialog-2 needed 46, see
 *                 ui/icon-button.tsx).
 * ⚠️ design-lint PARSES THIS LITERAL (it is an .mjs and cannot import TypeScript): keep it one
 * `Name: ['Npx', …]` entry per line, and add a value only with the measurement that justifies it.
 */
export const ICON_FIT = {
  X: ['29px', '33px', '34px', '38px', '42px'],
  Plus: ['29px', '42px'],
  SupportDialog: ['46px'],
} as const
