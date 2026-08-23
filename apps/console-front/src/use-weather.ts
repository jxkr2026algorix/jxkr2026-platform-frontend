/**
 * Live weather for the selected district.
 *
 * Replaces the demo table this panel used to carry. Three rules the hook keeps,
 * because getting them wrong turns a failed lookup into reassurance:
 *
 * - a value the backend did not send stays `null`; it is never filled in
 * - `UNVERIFIED` is surfaced as its own state, not as an empty reading
 * - the KOGL attribution and the observation time travel with the values
 */

import {
  createPlatformClient,
  type WeatherSnapshot,
} from "@salgil/platform-client";
import { useEffect, useMemo, useState } from "react";

export type WeatherState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly snapshot: WeatherSnapshot }
  | { readonly status: "unavailable" };

export function useWeather(regionCode: string | null): WeatherState {
  // The district being viewed is passed to `getWeather` per call; the client's
  // own regionCode only matters for declaring incidents, which this hook never
  // does. Built once so switching districts does not rebuild it.
  const client = useMemo(
    () =>
      createPlatformClient({
        apiUrl: import.meta.env.VITE_PLATFORM_API_URL ?? "/api/platform",
        regionCode: import.meta.env.VITE_PLATFORM_REGION_CODE ?? "47750",
      }),
    [],
  );
  const [state, setState] = useState<WeatherState>({ status: "idle" });

  useEffect(() => {
    if (!regionCode) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });

    client
      .getWeather(regionCode)
      .then((snapshot) => {
        if (cancelled) return;
        setState({ status: "ready", snapshot });
      })
      .catch(() => {
        if (cancelled) return;
        // No fallback values. A number invented here is indistinguishable on
        // screen from an observation, and the operator has no way to tell.
        setState({ status: "unavailable" });
      });

    // The KMA short-range forecast updates hourly; the backend caches to
    // protect the upstream quota, so polling faster buys nothing.
    const timer = window.setInterval(
      () => {
        client
          .getWeather(regionCode)
          .then((snapshot) => {
            if (!cancelled) setState({ status: "ready", snapshot });
          })
          .catch(() => {
            /* keep the last good reading rather than blanking the panel */
          });
      },
      5 * 60 * 1000,
    );

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [client, regionCode]);

  return state;
}
