/**
 * THE LAYERS PAGE-LEVEL DROPDOWNS DRAW ON — a blurred scrim and, one above it, the panel.
 *
 * ⛔ WHY (owner, 2026-11-19: "why price dropdown doesnt blur" the bars). The sort and facet pills (custom-select.tsx)
 * scrimmed at z-[1200], above the header (z-overlay 50; its neighbours run to z-[130]), the floating buttons (z-fab 45),
 * the tab bar (z-nav 40) and the map's overlays (z-map-overlay 1100). The Price and Filters panels are ui/popover, whose
 * scrim defaults to z-40 — under the header, so the header and the floating buttons stayed sharp while the page blurred.
 *
 * ⚠️ TWO PAIRS, ORDERED, NOT ONE: a select opens INSIDE the Filters panel (facet-bar.tsx panelBody), and its scrim must
 * cover that panel the way it covers the page. So the panels sit just under the selects:
 *   · PANEL_SCRIM_Z / PANEL_Z      — 1150 / 1151: the Price and Filters popovers.
 *   · DROPDOWN_SCRIM_Z / DROPDOWN_PANEL_Z — 1200 / 1201: every CustomSelect, which may open inside a panel or dialog.
 * dropdown-layers.test.ts pins the order. A new page-level popover imports a pair, never a literal.
 */
export const PANEL_SCRIM_Z = 'z-[1150]'
export const PANEL_Z = 'z-[1151]'
export const DROPDOWN_SCRIM_Z = 'z-[1200]'
export const DROPDOWN_PANEL_Z = 'z-[1201]'
