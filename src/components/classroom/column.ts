/**
 * ⛔ THE CLASSROOM IS A PHONE APP (owner, 2026-10-26: "the whole ui should take mobile first approach"). Teachers and
 * parents use it on their phones, so every page is laid out for a 390px phone first — and on a wide window the SAME
 * layout sits in a centred phone-width column instead of stretching into a desktop page. The header row, the page and
 * every sticky action bar take their width from here, so their edges line up at every size.
 * A plain module (no 'use client'): the layout and the header are server components.
 */

/**
 * The column: 28rem (448px — the widest phones) centred, with 16px gutters that widen to the notch's side inset when a
 * phone is held sideways (the viewport is `viewport-fit=cover`, so content otherwise runs under the camera cut-out).
 */
export const COLUMN = 'mx-auto w-full max-w-md pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]'

/**
 * Every ui/sticky-action-bar inside the classroom keeps to the column too (its panel is `max-w-7xl` for the marketplace):
 * on a tablet its buttons line up with the page above them instead of spanning the window. Set once on the layout's
 * root, by the panel's own `data-slot` — an attribute + class selector, so it outranks the panel's single classes at
 * every breakpoint. The bar's safe-area and keyboard handling live on its root and are untouched.
 */
export const BARS_IN_COLUMN = '[&_[data-slot=sticky-action-bar-panel]]:max-w-md [&_[data-slot=sticky-action-bar-panel]]:px-4'
