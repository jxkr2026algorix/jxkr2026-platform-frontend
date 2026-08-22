/**
 * Emergency notifications on the resident's phone.
 *
 * A warning that only exists inside a tab the resident is already looking at
 * is not a warning. These go through the service worker so they land as system
 * notifications, which is what gets someone to look at their phone.
 *
 * Two things are worth interrupting for, and only two: an incident being
 * declared where they are, and a new hazard appearing across the route they
 * were told to take. Anything else trains people to swipe the alert away.
 */

const TAG_INCIDENT = "salgil-incident";
const TAG_ROUTE = "salgil-route";

export type NotificationPermissionState =
  | "unsupported"
  | "default"
  | "granted"
  | "denied";

export function notificationState(): NotificationPermissionState {
  if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) {
    return "unsupported";
  }
  return Notification.permission as NotificationPermissionState;
}

/**
 * Ask for permission. Must be called from a user gesture — browsers refuse
 * otherwise, and a refusal here cannot be retried for the rest of the session.
 */
export async function requestNotifications(): Promise<NotificationPermissionState> {
  if (notificationState() === "unsupported") return "unsupported";
  const result = await Notification.requestPermission();
  return result as NotificationPermissionState;
}

async function show(
  title: string,
  options: NotificationOptions,
): Promise<void> {
  if (notificationState() !== "granted") return;
  const withIcon = {
    icon: "/pwa-192x192.png",
    badge: "/pwa-192x192.png",
    ...options,
  };
  try {
    // Through the service worker where there is one: those notifications
    // survive the tab being closed and can carry actions. `ready` never
    // resolves when no worker is registered, so it is raced against a timeout
    // rather than awaited — a warning that hangs is a warning that never
    // arrives.
    const registration = await Promise.race([
      navigator.serviceWorker?.ready,
      new Promise<undefined>((resolve) => setTimeout(resolve, 600)),
    ]);
    if (registration) {
      await registration.showNotification(title, withIcon);
      return;
    }
    new Notification(title, withIcon);
  } catch {
    // A notification that fails to show must never take the page with it:
    // the guidance on screen is the thing that actually matters.
  }
}

/** An incident has been declared in the resident's area. */
export function notifyIncident(headline: string, instruction: string): void {
  void show(headline, {
    body: instruction,
    tag: TAG_INCIDENT,
    // Replaces any earlier incident notice rather than stacking: the latest
    // state is the only one worth acting on.
    renotify: true,
    requireInteraction: true,
  } as NotificationOptions);
}

/**
 * A hazard has appeared across the route the resident was given. This is the
 * one update that cannot wait for them to look: they may already be walking
 * into it.
 */
export function notifyRouteBlocked(detail: string, shelter: string): void {
  void show("Your evacuation route has changed", {
    body: `${detail} — rerouting to ${shelter}.`,
    tag: TAG_ROUTE,
    renotify: true,
    requireInteraction: true,
  } as NotificationOptions);
}
