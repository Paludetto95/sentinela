self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const eventId = event.notification.data ? event.notification.data.eventId : null;
  const targetUrl = eventId ? `/dashboard?eventId=${eventId}` : '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        let client = clientList[0];
        for (let i = 0; i < clientList.length; i++) {
          if (clientList[i].focused) {
            client = clientList[i];
            break;
          }
        }
        if ('navigate' in client) {
          return client.navigate(targetUrl).then((c) => c.focus());
        }
        return client.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
