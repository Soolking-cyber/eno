/* eno.vn service worker — Web Push for the daily availability reminder.
   Minimal on purpose: it only handles push display + notification clicks (no
   precaching/offline), so it never interferes with Next's own asset handling. */

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = {} }
  const title = data.title || 'eno.vn'
  const options = {
    body: data.body || '',
    icon: '/logo-mark.svg',
    badge: '/logo-mark.svg',
    tag: data.tag || 'eno-reminder', // collapses repeats into one
    data: { url: data.url || '/dashboard' },
    requireInteraction: false,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/dashboard'
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
