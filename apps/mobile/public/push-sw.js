/**
 * Push handling, imported into the generated service worker.
 *
 * This is the half of the warning that works when nobody is looking. The page
 * can only show a notification while it is open; a fire at three in the
 * morning has to come through the browser vendor's push service and land on a
 * locked screen. That arrives here, in a worker with no page attached.
 *
 * It lives in `public/` and is pulled in with `workbox.importScripts` because
 * the rest of the worker is generated. Nothing here caches or fetches — it
 * shows what the server sent and opens the app when tapped.
 */

/* global self, clients */

const FALLBACK = {
  title: "긴급 안내",
  body: "살길 앱을 열어 현재 상황을 확인하세요.",
  tag: "salgil-incident",
};

self.addEventListener("push", (event) => {
  let payload = FALLBACK;
  try {
    // A push with no body still has to show something. An empty notification
    // is worse than a vague one: the phone buzzed and said nothing.
    payload = { ...FALLBACK, ...(event.data ? event.data.json() : {}) };
  } catch {
    // Not JSON — treat whatever came as the body rather than dropping it.
    payload = {
      ...FALLBACK,
      body: event.data ? event.data.text() : FALLBACK.body,
    };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      // Replaces the previous notice rather than stacking. The latest state is
      // the only one worth acting on, and a stack of five is a stack nobody
      // reads.
      renotify: true,
      requireInteraction: true,
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      // A drill has to be distinguishable before the screen is unlocked, so it
      // does not get the urgent pattern.
      vibrate: payload.data?.drill ? [120, 80, 120] : [200, 100, 200, 100, 400],
      data: payload.data ?? {},
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Focus the tab that is already open rather than stacking another copy of
  // the app on top of the one holding the route the person is walking.
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        for (const client of windows) {
          if ("focus" in client) return client.focus();
        }
        return clients.openWindow("/");
      }),
  );
});
