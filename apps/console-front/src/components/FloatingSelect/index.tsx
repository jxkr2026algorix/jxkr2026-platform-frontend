import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
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
  readonly disabled?: boolean;
  readonly onValueChange: (value: string) => void;
}

export function FloatingSelect({
  label,
  value,
  options,
  disabled = false,
  onValueChange,
}: FloatingSelectProps) {
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const selectedOptionRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const initialIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const activeIndexRef = useRef(initialIndex);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [placement, setPlacement] = useState<"top" | "bottom">("bottom");
  const [popoverTop, setPopoverTop] = useState<number | null>(null);
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

  useLayoutEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    const selected = selectedOptionRef.current;
    if (!root || !trigger || !popover || !selected) return;

    const maxScrollTop = Math.max(
      0,
      popover.scrollHeight - popover.clientHeight,
    );
    const centeredScrollTop =
      selected.offsetTop + selected.offsetHeight / 2 - popover.clientHeight / 2;
    popover.scrollTop = Math.min(Math.max(centeredScrollTop, 0), maxScrollTop);

    const rootBounds = root.getBoundingClientRect();
    const triggerBounds = trigger.getBoundingClientRect();
    const boundaryBounds = root
      .closest(".workflow-view, .side-nav, .floating-lens")
      ?.getBoundingClientRect();
    const boundaryTop = (boundaryBounds?.top ?? 0) + 6;
    const boundaryBottom = (boundaryBounds?.bottom ?? window.innerHeight) - 6;
    const selectedCenter =
      selected.offsetTop - popover.scrollTop + selected.offsetHeight / 2;
    const triggerCenter = triggerBounds.top + triggerBounds.height / 2;
    const idealTop = triggerCenter - selectedCenter;
    const latestTop = Math.max(
      boundaryTop,
      boundaryBottom - popover.offsetHeight,
    );
    const viewportTop = Math.min(Math.max(idealTop, boundaryTop), latestTop);

    setPopoverTop(viewportTop - rootBounds.top);
    setPlacement(viewportTop < triggerBounds.top ? "top" : "bottom");
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      activeIndexRef.current = initialIndex;
      setActiveIndex(initialIndex);
      setPopoverTop(null);
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
            ref={popoverRef}
            id={listboxId}
            role="listbox"
            aria-label={label}
            data-placement={placement}
            {...(popoverTop === null ? {} : { style: { top: popoverTop } })}
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
                ref={option.value === value ? selectedOptionRef : undefined}
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
