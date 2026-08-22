import { motion, useReducedMotion } from "motion/react";

interface SegmentIndicatorProps {
  readonly layoutId: string;
}

const segmentTransition = {
  type: "spring",
  stiffness: 420,
  damping: 36,
  mass: 0.55,
} as const;

export function SegmentIndicator({ layoutId }: SegmentIndicatorProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.span
      aria-hidden="true"
      className="segmented-indicator"
      layout="position"
      layoutId={layoutId}
      transition={reduceMotion ? { duration: 0 } : segmentTransition}
    />
  );
}
