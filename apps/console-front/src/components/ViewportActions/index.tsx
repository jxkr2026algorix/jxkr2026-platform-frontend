import QRCode from "react-qr-code";
import { useI18n } from "../../i18n";
import { useSidebarTheme } from "../../theme";

/**
 * The address of the resident app, at the top of the right rail.
 *
 * It was a 42px tile in the corner of the left rail, where it read as part of
 * the branding. It is the one thing an audience is asked to act on, and it is
 * read across a room off a projected screen, so it takes the full width of the
 * rail it opens.
 */
export function ViewportActions({ mobileUrl }: { readonly mobileUrl: string }) {
  const { t } = useI18n();
  const { sidebarTheme } = useSidebarTheme();

  return (
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
          white tile punched into a dark rail is the thing people look at
          instead of the map. */}
      <QRCode
        value={mobileUrl}
        size={256}
        level="M"
        bgColor="transparent"
        fgColor={sidebarTheme === "dark" ? "#f5f7fa" : "#1d1d1f"}
        style={{ width: "100%", height: "auto" }}
      />
    </a>
  );
}
