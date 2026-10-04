/* eno.vn service worker — Web Push for the daily availability reminder.
   Minimal on purpose: it only handles push display + notification clicks (no
   precaching/offline), so it never interferes with Next's own asset handling. */

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = {} }
  const title = data.title || 'eno.vn'
  const options = {
    body: data.body || '',
    // ⚠️ STAMPED, LIKE THE FOUR IN-APP CALL SITES. /logo-mark.svg is served
    // `max-age=31536000, immutable`, so an unstamped request here would pin the OLD mark in the
    // notification for a year. `src/lib/asset-stamps.test.ts` fails if this literal drifts from
    // the file's hash — that guard is the only reason four hand-maintained copies are tolerable.
    icon: '/logo-mark.svg?v=2b609517',
    badge: '/logo-mark.svg?v=2b609517', // the MONOCHROME status-bar glyph — NOT the app-icon count (that's setAppBadge below)
    tag: data.tag || 'eno-reminder', // collapses repeats into one
    data: { url: data.url || '/dashboard' },
    requireInteraction: false,
  }
  event.waitUntil((async () => {
    // The notification is MANDATORY and comes FIRST: iOS revokes the push subscription if a
    // push doesn't produce a user-visible event, and a badge-only update does NOT satisfy that.
    await self.registration.showNotification(title, options)
    // App-icon unread badge (Web Badging API — installed PWAs, iOS 16.4+). data.badge is the
    // recipient's CURRENT unread total, stamped server-side in src/lib/push.ts; 0 clears the
    // badge. This is the ONLY way the count updates while the app is closed — the foreground
    // half (pwa-badge.tsx) is what LOWERS it on read, since iOS forbids a silent decrement push.
    // Feature-detected + swallowed: a failed badge write must never reject the push.
    if (typeof data.badge === 'number' && self.navigator && 'setAppBadge' in self.navigator) {
      try { await self.navigator.setAppBadge(data.badge) } catch { /* no permission / unsupported */ }
    }
  })())
})

/**
 * ⛔ A `/vi…` URL RESOLVES ONLY ON eno.vn's OWN HOSTS (A1-LANG). The saved-search cron runs on eno.vn and
 * writes `/vi?…` into a Vietnamese recipient's push, but a push subscription belongs to an ORIGIN, and one
 * registered on eno.forum — which has no `/vi` pilot, so its `/vi` is a 404 — opens the URL there. On such
 * an origin the plain path is the same page, so that is what opens. The rule hrefHere follows in the app
 * (src/lib/lang-pinned.ts) for the same stored URL: eno.vn and its subdomains keep it (a shop's host sends a
 * live twin on to the apex with a 308 — src/proxy.ts), and so does a local preview (loopback). A path that
 * merely starts with the letters (e.g. `/vietnam-guide`) is not a twin and is left alone.
 * ⚠️ PLAIN JS, NO BUNDLER, NO IMPORTS: this file is served as-is, so the rule is restated here rather than
 * imported (sw-push-click.test.ts runs this file and pins it).
 */
function urlForThisOrigin(url) {
  if (typeof url !== 'string' || !/^\/vi(?=$|[/?#])/.test(url)) return url
  const host = (self.location && self.location.hostname) || ''
  if (host === 'eno.vn' || host.endsWith('.eno.vn') || host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return url
  const rest = url.slice(3)
  return rest === '' || rest[0] === '?' || rest[0] === '#' ? `/${rest}` : rest
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = urlForThisOrigin((event.notification.data && event.notification.data.url) || '/dashboard')
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (wins) => {
      // Focus an existing tab if one is open (navigating it where supported), else
      // open a new one.
      for (const w of wins) {
        if ('focus' in w) {
          if ('navigate' in w) { try { await w.navigate(url) } catch { /* cross-origin / not allowed */ } }
          return w.focus()
        }
      }
      return clients.openWindow(url)
    }),
  )
})
