// Keynection's notifications (pilot mode). Shows an alert the server sent to this phone, even with the app closed,
// and opens the right screen when it is tapped. Nothing else: no caching, so the app is always the live version.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let alert = {}
  try {
    alert = event.data ? event.data.json() : {}
  } catch {
    alert = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(self.registration.showNotification(alert.title || 'Keynection', {
    body: alert.body || '',
    tag: alert.tag || undefined,
    lang: alert.lang || undefined,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    data: { url: alert.url || '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin)
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const open = windows.find((w) => new URL(w.url).origin === url.origin)
    if (open) {
      open.postMessage({ type: 'keynection-open', hash: url.hash })
      return open.focus()
    }
    return self.clients.openWindow(url.href)
  }))
})
