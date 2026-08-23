import { motion, useReducedMotion } from "motion/react";
import QRCode from "react-qr-code";
import { useI18n } from "../../i18n";
import { getPressTransition } from "../../motion";
import { useSidebarTheme } from "../../theme";

/**
 * The two controls that belong to the whole screen rather than to any panel:
 * the theme, and the address of the resident app.
 *
 * The QR was in the bottom corner of the left rail, where it read as part of
 * the branding. It is the one thing an audience is asked to act on, so it sits
 * at the top right where the eye finishes crossing the header.
 */
export function ViewportActions({ mobileUrl }: { readonly mobileUrl: string }) {
  const { t } = useI18n();
  const { sidebarTheme, toggleSidebarTheme } = useSidebarTheme();
  const reduceMotion = useReducedMotion();
  const dark = sidebarTheme === "dark";
  const themeLabel = t(dark ? "theme.useLight" : "theme.useDark");

  return (
    <div className="viewport-actions">
      <a
        className="viewport-qr"
        href={mobileUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={t("qr.mobile")}
        title={mobileUrl}
      >
        {/* Drawn in the theme's own two colours rather than fixed black on
            white. A scanner reads either as long as the contrast holds, and a
            white tile punched into a dark board is the thing people notice
            instead of the map. */}
        <QRCode
          value={mobileUrl}
          size={96}
          level="M"
          bgColor="transparent"
          fgColor={dark ? "#f5f7fa" : "#1d1d1f"}
        />
      </a>

      <motion.button
        className="viewport-action"
        type="button"
        aria-label={themeLabel}
        aria-pressed={dark}
        title={themeLabel}
        onClick={toggleSidebarTheme}
        whileTap={reduceMotion ? {} : { scale: 0.94 }}
        transition={getPressTransition(reduceMotion)}
      >
        {dark ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3.5" />
            <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19.5 15.2A7.5 7.5 0 0 1 8.8 4.5 7.8 7.8 0 1 0 19.5 15.2Z" />
          </svg>
        )}
      </motion.button>
    </div>
  );
}
