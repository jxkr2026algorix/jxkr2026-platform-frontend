import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

interface FloatingSelectOption {
  readonly value: string;
  readonly label: string;
}

interface FloatingSelectProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly FloatingSelectOption[];
  readonly preferredPlacement?: "auto" | "top" | "bottom";
  readonly disabled?: boolean;
  readonly onValueChange: (value: string) => void;
}

export function FloatingSelect({
  label,
  value,
  options,
  preferredPlacement = "auto",
  disabled = false,
  onValueChange,
}: FloatingSelectProps) {
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const initialIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const activeIndexRef = useRef(initialIndex);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [placement, setPlacement] = useState<"top" | "bottom">("bottom");
  const selectedOption = options[selectedIndex];

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && !event.composedPath().includes(root)) setOpen(false);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      activeIndexRef.current = initialIndex;
      setActiveIndex(initialIndex);
      const root = rootRef.current;
      if (preferredPlacement === "auto" && root) {
        const rootBounds = root.getBoundingClientRect();
        const workflowBounds = root
          .closest(".workflow-view")
          ?.getBoundingClientRect();
        const boundaryTop = workflowBounds?.top ?? 0;
        const boundaryBottom = workflowBounds?.bottom ?? window.innerHeight;
        const estimatedPopoverHeight = Math.min(278, options.length * 42 + 10);
        const availableAbove = rootBounds.top - boundaryTop - 6;
        const availableBelow = boundaryBottom - rootBounds.bottom - 6;
        setPlacement(
          availableBelow < estimatedPopoverHeight &&
            availableAbove > availableBelow
            ? "top"
            : "bottom",
        );
      } else if (preferredPlacement !== "auto") {
        setPlacement(preferredPlacement);
      }
    }
    setOpen(nextOpen);
  };

  const handleSelect = (nextValue: string) => {
    onValueChange(nextValue);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        handleOpenChange(true);
        return;
      }
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        const nextIndex =
          (current + direction + options.length) % options.length;
        activeIndexRef.current = nextIndex;
        return nextIndex;
      });
      return;
    }

    if (open && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      const activeOption = options[activeIndexRef.current];
      if (activeOption) handleSelect(activeOption.value);
    }
  };

  return (
    <div className="floating-select" ref={rootRef}>
      <span className="control-label">{label}</span>
      <button
        className="floating-select-trigger"
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={disabled}
        aria-activedescendant={
          open ? `${listboxId}-option-${activeIndex}` : undefined
        }
        onClick={() => handleOpenChange(!open)}
        onKeyDown={handleKeyDown}
      >
        <span>{selectedOption?.label ?? "Select"}</span>
        <motion.svg
          className="floating-select-chevron"
          viewBox="0 0 16 16"
          aria-hidden="true"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.12, ease: "easeOut" }}
        >
          <path d="m4.5 6 3.5 3.5L11.5 6" />
        </motion.svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="floating-select-popover"
            id={listboxId}
            role="listbox"
            aria-label={label}
            data-placement={placement}
            initial={
              reduceMotion
                ? false
                : {
                    opacity: 0,
                    y: placement === "top" ? 4 : -4,
                    scale: 0.99,
                  }
            }
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              reduceMotion
                ? { opacity: 0 }
                : { opacity: 0, y: placement === "top" ? 3 : -3 }
            }
            transition={{ duration: reduceMotion ? 0 : 0.12, ease: "easeOut" }}
          >
            {options.map((option, index) => (
              <button
                className="floating-select-option"
                id={`${listboxId}-option-${index}`}
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                data-active={index === activeIndex}
                onMouseEnter={() => {
                  activeIndexRef.current = index;
                  setActiveIndex(index);
                }}
                onClick={() => handleSelect(option.value)}
              >
                <span>
                  <strong>{option.label}</strong>
                </span>
                {option.value === value && (
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m3.5 8.2 2.8 2.8 6.2-6.2" />
                  </svg>
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
