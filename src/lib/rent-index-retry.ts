import { unstable_cache } from 'next/cache'

/**
 * ⛔ A RENTALS DISTRICT PAGE THAT COULD NOT READ THE RENT INDEX RETRIES IN MINUTES, NOT A DAY
 * (SEO wave B, D2). The page is ISR at 86,400 s; when its render meets no snapshot (a cold or failed
 * read, or the 10 s race lost) it shows the plain index link, and without this that fallback would be
 * cached for the whole day. Reading a 300 s `unstable_cache` entry inside the ISR render lowers the
 * render's revalidate to 300 — the store keeps the shortest (`workUnitStore.revalidate` in
 * next/dist/server/web/spec-extension/unstable-cache.js) — so the next regeneration comes within five
 * minutes (plus the edge's own fresh window) and meets the warm snapshot.
 * ⚠️ NOT `revalidateTag`: it throws when called during a render (next/dist/server/web/spec-extension/
 * revalidate.js). ⚠️ Only the district page calls it; the sitemap throws instead (D3).
 */
const retry = async () => true
retry.toString = () => 'hcmc-rent-index-retry'
export const rentIndexRetrySoon = () =>
  unstable_cache(retry, ['hcmc-rent-index-retry'], { revalidate: 300, tags: ['hcmc-rent-index'] })()
