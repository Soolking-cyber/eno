/**
 * THE BASEMAP TILE URL, IN ONE PLACE.
 *
 * ⛔ THE KEY IS NOT OPTIONAL ANY MORE. CARTO serves these tiles keyless, but since 2026 it renders
 * "API KEY REQUIRED" diagonally across the pixels of a keyless tile — repeatedly, in large grey
 * type. It is not an outage and nothing 4xxs: the tiles arrive `200 image/png` with the notice
 * baked in, which is why nothing in the app's error handling noticed. Owner reported it from the
 * live browse map.
 *
 * ⚠️ `key`, NOT `api_key`. Both are accepted-looking and only one works; the other is silently
 * ignored, which reads exactly like a bad key.
 *
 * ⚠️ PUBLIC BY DESIGN — hence `NEXT_PUBLIC_`. Tile URLs are fetched by the browser, so this value
 * is visible in devtools on any map view and cannot be otherwise. CARTO issues it for that use and
 * scopes it to basemap reads; it is not an account credential. Do not "fix" this by moving it
 * server-side — the tiles would then have to be proxied through us, which is bandwidth we would be
 * paying for to hide a value that is designed to be seen.
 *
 * ⚠️ FALLS BACK TO KEYLESS rather than to a blank map. Without the variable the map still draws,
 * watermarked — degraded, not broken, which is the right failure for a preview or a fork that has
 * no key of its own.
 */
const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_KEY

/**
 * @param retina `@2x` for a HiDPI tile, or Leaflet's own `{r}` placeholder, or ''.
 * @param style CARTO basemap style. `light_all` is the app's; the others exist for a dark map — and, since build 7, for the
 *   rental listing page's phone map picture (PREVIEW_STYLE below).
 */
export function basemapTileUrl(retina: '@2x' | '{r}' | '' = '', style = 'light_all'): string {
  const base = `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}${retina}.png`
  return CARTO_KEY ? `${base}?key=${CARTO_KEY}` : base
}

/**
 * The CARTO style for the app's scheme (owner, 2026-09-30, P-MAP: "dark CARTO basemap: yes"). A
 * `light_all` tile is a near-white 260px slab in dark mode — the brightest thing on the page. PDP map
 * only for now; the explorer's map keeps `light_all` (its pins and chips were contrast-measured on it).
 */
export function basemapStyle(dark: boolean): 'dark_all' | 'light_all' {
  return dark ? 'dark_all' : 'light_all'
}

/**
 * ⛔ THE RENTAL LISTING PAGE'S MAP PICTURE ON A PHONE IS CARTO VOYAGER, ONE ZOOM STEP OUT (owner-approved 2026-11-15 (build 7),
 * cook r07 "rental"; it reverses there, in light mode only, "`light_all` is the app's" — P-MAP, 2026-09-30): the labelled
 * Voyager style at z14 (STATIC_MAP_ZOOM − 1), so the streets, the water and the place names around the pin read in the
 * picture (ListingMapPreview `look="sheet"`, below md). Same CARTO service, same key, same credits (© OpenStreetMap
 * contributors, © CARTO). The live map — the explorer's, the desktop PDP's and the full-screen one the picture opens — keeps
 * `light_all` at its own zoom; dark mode keeps `dark_all`.
 */
export const PREVIEW_STYLE = 'rastertiles/voyager'
