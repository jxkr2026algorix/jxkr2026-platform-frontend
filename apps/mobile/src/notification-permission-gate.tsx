import { useCallback, useEffect, useRef, useState } from "react";
import {
  type NotificationPermissionState,
  notificationState,
  requestNotifications,
} from "./notifications";

export function NotificationPermissionGate() {
  const [permission, setPermission] =
    useState<NotificationPermissionState>(notificationState);
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [hasBypassedUnsupported, setHasBypassedUnsupported] = useState(false);
  const actionRef = useRef<HTMLButtonElement>(null);
  const isOpen = permission !== "granted" && !hasBypassedUnsupported;

  const syncPermission = useCallback(() => {
    setPermission(notificationState());
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") syncPermission();
    };
    window.addEventListener("focus", syncPermission);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", syncPermission);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [syncPermission]);

  useEffect(() => {
    if (!isOpen) return;
    actionRef.current?.focus();
  }, [isOpen]);

  const handleRequest = useCallback(async () => {
    setIsRequesting(true);
    setRequestError("");
    try {
      setPermission(await requestNotifications());
    } catch {
      setRequestError(
        "Notification permission could not be requested. Try again.",
      );
    } finally {
      setIsRequesting(false);
    }
  }, []);

  if (!isOpen) return null;

  const isDenied = permission === "denied";
  const isUnsupported = permission === "unsupported";
  const title = isDenied
    ? "Notifications are blocked"
    : isUnsupported
      ? "Notifications are unavailable"
      : "Get immediate evacuation alerts";
  const description = isDenied
    ? "Open this site's notification settings, choose Allow, then return here."
    : isUnsupported
      ? "This browser cannot receive system alerts. Use the latest Safari or Chrome for emergency notifications."
      : "We’ll notify you when an incident starts or your suggested route changes.";

  const handleAction = () => {
    if (isUnsupported) {
      setHasBypassedUnsupported(true);
      return;
    }
    if (isDenied) {
      syncPermission();
      return;
    }
    void handleRequest();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    actionRef.current?.focus();
  };

  return (
    <div className="notification-gate-backdrop">
      <section
        className="notification-gate"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-gate-title"
        aria-describedby="notification-gate-description"
        onKeyDown={handleKeyDown}
      >
        <div className="notification-gate-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
          </svg>
        </div>
        <p>Emergency alerts</p>
        <h2 id="notification-gate-title">{title}</h2>
        <span id="notification-gate-description">{description}</span>

        {isDenied ? (
          <ol className="notification-gate-steps">
            <li>Open browser site settings</li>
            <li>Set Notifications to Allow</li>
            <li>Return here and check again</li>
          </ol>
        ) : null}

        {requestError ? (
          <span className="notification-gate-error" role="alert">
            {requestError}
          </span>
        ) : null}

        <button
          ref={actionRef}
          type="button"
          disabled={isRequesting}
          onClick={handleAction}
        >
          {isRequesting
            ? "Requesting…"
            : isDenied
              ? "Check permission again"
              : isUnsupported
                ? "Continue to demo"
                : "Enable notifications"}
        </button>
      </section>
    </div>
  );
}
