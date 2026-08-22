/**
 * Web Push subscription — the alert that arrives with the app closed.
 *
 * `notifications.ts` shows a notification from a page that is already running.
 * That covers a resident watching the screen and nobody else. This registers
 * the device with the browser's push service so the platform can reach a
 * locked phone, which is the case that actually matters.
 *
 * Everything here fails soft. A resident whose browser refuses push must still
 * get the guidance on screen; losing the lock-screen alert is worse than
 * nothing but far better than a blank page.
 */

const API = import.meta.env.VITE_PLATFORM_API_URL ?? "/api/platform";

export type PushState =
  | "unsupported"
  | "unconfigured"
  | "subscribed"
  | "failed";

/** The key travels as base64url and `applicationServerKey` wants raw bytes. */
function decodeKey(base64url: string): ArrayBuffer {
  const padded = base64url.padEnd(
    base64url.length + ((4 - (base64url.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window;
}

/**
 * Register this device for background alerts. Safe to call more than once:
 * an existing subscription is re-sent rather than replaced, because the server
 * keys off the endpoint and the browser hands back the same one.
 *
 * Must run after notification permission has been granted — Chrome rejects
 * `subscribe` with `userVisibleOnly` otherwise.
 */
export async function subscribeToPush(
  regionCode?: string | null,
): Promise<PushState> {
  if (!supported()) return "unsupported";
  try {
    const response = await fetch(`${API}/push/key`);
    if (!response.ok) return "failed";
    const { configured, public_key: publicKey } = (await response.json()) as {
      configured: boolean;
      public_key: string;
    };
    // No keys on the server. Said plainly rather than reported as success:
    // a resident who thinks alerts are on will not check the app.
    if (!configured || !publicKey) return "unconfigured";

    const registration = await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        // Required by Chrome, and honest: every push we send shows something.
        userVisibleOnly: true,
        applicationServerKey: decodeKey(publicKey),
      }));

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth)
      return "failed";
    const saved = await fetch(`${API}/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        ...(regionCode ? { region_code: regionCode } : {}),
      }),
    });
    return saved.ok ? "subscribed" : "failed";
  } catch {
    return "failed";
  }
}
