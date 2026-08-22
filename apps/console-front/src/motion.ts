export function getFeedbackTransition(reduceMotion: boolean | null) {
  return { duration: reduceMotion ? 0 : 0.16 } as const;
}
