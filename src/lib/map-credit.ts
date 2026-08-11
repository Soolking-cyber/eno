/**
 * The basemap attributions, as constants, deliberately OUTSIDE the translation layer.
 *
 * ⚠️ THESE MUST NEVER GO THROUGH tr(). They did, and the catalogue duly machine-translated
 * them: a Vietnamese/English marketplace was rendering "© Участники проекта OpenStreetMap"
 * to a visitor whose UI language happened to be Russian. Two things are wrong with that —
 * it reads as a bug to anyone who sees it, and the credit is a LEGAL requirement whose
 * wording is not ours to restate. OpenStreetMap data is ODbL, which obliges an attribution
 * naming OpenStreetMap and its contributors; CARTO's basemap terms oblige the second credit.
 *
 * ⚠️ AND THEY MUST NOT BE REMOVED. They are the smallest thing that keeps this marketplace
 * inside the licences of the map it is built on — which matters more than usual for a
 * company mid-registration as a licensed sàn TMĐT. If they ever need to go, that is a legal
 * decision about switching basemap provider, not a styling one. Making them QUIETER is
 * fine and is what the map does; making them absent is not.
 *
 * Constants rather than inline literals so `react/jsx-no-literals` stays satisfied without an
 * eslint-disable at each of the two call sites, and so there is exactly one place to change
 * the wording if the provider ever does.
 */
/**
 * ⚠️ "contributors" IS PART OF THE REQUIRED WORDING — DO NOT SHORTEN IT AGAIN.
 * The first version of this constant said `© OpenStreetMap`, in a file written specifically to
 * protect this string, and all three reviewers caught it. ODbL attribution credits the project
 * AND the people whose surveys make it; OSM's own guidance gives "© OpenStreetMap contributors"
 * as the form to use. Dropping the last word to save eight pixels is exactly the kind of quiet
 * shortening this file exists to prevent — make it smaller or fainter instead, never shorter.
 */
export const OSM_CREDIT = '© OpenStreetMap contributors'
export const CARTO_CREDIT = '© CARTO'
