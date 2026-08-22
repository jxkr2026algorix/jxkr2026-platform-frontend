import { useI18n } from "../../i18n";
import type { useMapBridge } from "../../use-map-bridge";

type MapBridge = ReturnType<typeof useMapBridge>;

export function MapCanvas({ map }: { readonly map: MapBridge }) {
  const { t } = useI18n();

  return (
    <div className="map-canvas">
      <iframe
        ref={map.frame.ref}
        src={map.frame.src}
        title={t("map.frameTitle")}
        allow="fullscreen"
      />
      {map.status.connection !== "ready" ? (
        <div
          className="map-feedback"
          role={map.status.connection === "error" ? "alert" : "status"}
        >
          <strong>
            {map.status.connection === "loading"
              ? t("map.loading")
              : t("map.unavailable")}
          </strong>
          <span>{map.status.errorMessage || t("map.reconnect")}</span>
        </div>
      ) : null}
    </div>
  );
}
