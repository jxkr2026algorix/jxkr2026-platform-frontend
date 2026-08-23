/**
 * How wide the assistant panel is, and it stays that way.
 *
 * 288px is enough for a sentence and not enough for a table of situation
 * codes, so the width is the operator's call rather than ours. It is kept here
 * rather than inside the panel because the timeline underneath has to make
 * room for it, and both read it from the same custom property on the shell.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "salgil-console-assistant-width";

export const ASSISTANT_MIN_WIDTH = 288;
export const ASSISTANT_DEFAULT_WIDTH = 288;

/**
 * The widest the panel may get: never past two-thirds of the window, and never
 * so wide that the map it is explaining is gone.
 */
export function assistantMaxWidth(viewportWidth: number): number {
  return Math.max(
    ASSISTANT_MIN_WIDTH,
    Math.min(760, Math.round(viewportWidth * 0.66), viewportWidth - 320),
  );
}

function clampWidth(width: number, viewportWidth: number): number {
  return Math.min(
    Math.max(Math.round(width), ASSISTANT_MIN_WIDTH),
    assistantMaxWidth(viewportWidth),
  );
}

function readStoredWidth(): number {
  const stored = Number(window.localStorage.getItem(STORAGE_KEY));
  if (!Number.isFinite(stored) || stored <= 0) return ASSISTANT_DEFAULT_WIDTH;
  return clampWidth(stored, window.innerWidth);
}

export function useAssistantWidth() {
  const [width, setWidth] = useState(readStoredWidth);
  const persistTimer = useRef<number | undefined>(undefined);

  /**
   * The width follows the pointer, so this runs on every move of a drag.
   * Writing to localStorage at that rate is a synchronous disk touch per
   * frame; the last value is the only one worth keeping, so the write waits
   * until the drag has paused.
   */
  const changeWidth = useCallback((next: number) => {
    const clamped = clampWidth(next, window.innerWidth);
    setWidth(clamped);
    window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      window.localStorage.setItem(STORAGE_KEY, String(clamped));
    }, 200);
  }, []);

  useEffect(() => () => window.clearTimeout(persistTimer.current), []);

  // A window narrowed after the panel was widened would leave it covering the
  // map entirely, with the drag handle off the left edge of nothing.
  useEffect(() => {
    const handleResize = () =>
      setWidth((current) => clampWidth(current, window.innerWidth));
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return { width, setWidth: changeWidth };
}
