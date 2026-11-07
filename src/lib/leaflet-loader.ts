// THE SELF-HOSTED LEAFLET, LOADED ONCE (a copy of listings-map.tsx's loader, which stays private to that landmine file; trip-map.tsx has another). Used by
// the Import from Facebook location picker. Self-hosted for the reason listings-map.tsx gives: no CDN script with session access.
const LEAFLET_JS = '/vendor/leaflet/leaflet.js'
const LEAFLET_CSS = '/vendor/leaflet/leaflet.css'

export function loadLeaflet(cb: () => void, onError?: () => void) {
  if (typeof window === 'undefined') return
  const w = window as unknown as { L?: unknown }
  if (w.L) { cb(); return }
  if (!document.getElementById('leaflet-css')) {
    // Warm the tile origin now that the map is actually loading (used to be a global
    // preconnect but wasted an early-connection slot on the homepage).
    for (const href of ['https://basemaps.cartocdn.com']) {
      const pc = document.createElement('link')
      pc.rel = 'preconnect'; pc.href = href; pc.crossOrigin = ''
      document.head.appendChild(pc)
    }
    const link = document.createElement('link')
    link.id = 'leaflet-css'; link.rel = 'stylesheet'; link.href = LEAFLET_CSS
    document.head.appendChild(link)
  }
  const existing = document.getElementById('leaflet-js') as HTMLScriptElement | null
  if (existing) {
    if (w.L) cb()
    else {
      existing.addEventListener('load', cb, { once: true })
      // The tag may already have failed (a 'load' listener would never fire) —
      // surface that; removing the dead tag lets a retry inject a fresh one.
      existing.addEventListener('error', () => { existing.remove(); onError?.() }, { once: true })
    }
    return
  }
  const s = document.createElement('script')
  s.id = 'leaflet-js'; s.src = LEAFLET_JS; s.async = true
  s.onload = () => cb()
  s.onerror = () => { s.remove(); onError?.() }
  document.head.appendChild(s)
}
