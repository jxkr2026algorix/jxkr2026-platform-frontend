export function getFeedbackTransition(reduceMotion: boolean | null) {
  return { duration: reduceMotion ? 0 : 0.16 } as const;
}

export function getPressTransition(reduceMotion: boolean | null) {
  return { duration: reduceMotion ? 0 : 0.08, ease: "easeOut" } as const;
}
